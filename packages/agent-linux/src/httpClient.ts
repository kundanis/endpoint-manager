import crypto from "node:crypto";
import https from "node:https";
import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { agentConfig, parseServerUrls, updateInstallConfig } from "./config";

// Only set when a dev/test self-signed cert is configured (see config.ts's
// readServerCaPem) — trusts that one specific certificate in addition to the OS's public
// CA store. undefined here just means "rely on the default trust store", exactly as before.
const httpsAgent = agentConfig.serverCaPem ? new https.Agent({ ca: agentConfig.serverCaPem }) : undefined;

// --- Server address failover -------------------------------------------------------------
// The server may be reachable on several addresses (LAN IP, web URL, NAT'd public IP - in
// that preference order, see the server's agentConnection.service.ts). An endpoint on the
// office network uses the LAN address; the same laptop at home can only reach the web URL or
// public IP. Rather than guess from the local network, the agent just tries them: whenever a
// request fails without any HTTP response (unreachable, refused, timed out, DNS failure) it
// re-probes the list in order and retries once on the first address that answers /health.
// Every few minutes it also checks whether a more-preferred address has become reachable
// again (e.g. back in the office) and moves back to it.

const PROBE_TIMEOUT_MS = 5_000;
const PREFERRED_RECHECK_MS = 5 * 60 * 1000;

// --- Signed server replies ----------------------------------------------------------------
// The server signs every reply to an agent with its own Ed25519 key (server
// utils/agentResponseSigning.ts). This is what stops someone on the same network - the
// preferred server address is often plain-HTTP on the LAN - from answering in the server's
// place and handing out commands, scripts or updates that this agent would run as
// SYSTEM/root. The key is remembered from the first signed reply (enrollment, or the first
// check-in after upgrading to a version that checks); after that any reply that isn't
// signed by it is treated like an unreachable server: it is never acted on, and the failover
// below moves on to the next address. Each request carries a fresh nonce that the signature
// covers, so an old reply can't be replayed. Streamed downloads aren't signed - those are
// checked against the SHA-256 given in the (signed) task.

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function publicKeyFromRaw(base64: string): crypto.KeyObject | null {
  try {
    const raw = Buffer.from(base64, "base64");
    if (raw.length !== 32) return null;
    return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
  } catch {
    return null;
  }
}

let pinnedKey: crypto.KeyObject | null = agentConfig.serverPublicKey ? publicKeyFromRaw(agentConfig.serverPublicKey) : null;
if (agentConfig.serverPublicKey && !pinnedKey) console.error("config.json has an unreadable serverPublicKey - it will be learned again");

type SignedConfig = InternalAxiosRequestConfig & { emNonce?: string; emRawBody?: unknown };

function headerValue(headers: unknown, name: string): string | undefined {
  const h = headers as { get?: (n: string) => unknown } & Record<string, unknown>;
  const value = typeof h?.get === "function" ? h.get(name) : h?.[name];
  return typeof value === "string" ? value : undefined;
}

// True when the reply may be used. Learns the server's key from the first validly signed
// reply; until one has been seen (an older server), unsigned replies are still accepted.
function replyIsAuthentic(config: SignedConfig | undefined, status: number, headers: unknown): boolean {
  if (!config || config.responseType === "stream") return true;
  const signature = headerValue(headers, "x-em-signature");
  const offeredKey = headerValue(headers, "x-em-server-key");
  if (!signature || !config.emNonce) return pinnedKey === null;
  const key = pinnedKey ?? (offeredKey ? publicKeyFromRaw(offeredKey) : null);
  if (!key) return false;
  const raw = config.emRawBody;
  const body = typeof raw === "string" ? Buffer.from(raw, "utf8") : Buffer.isBuffer(raw) ? raw : Buffer.alloc(0);
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const message = Buffer.from(`EMSIG1\n${config.emNonce}\n${status}\n${bodyHash}`, "utf8");
  let valid = false;
  try {
    valid = crypto.verify(null, message, key, Buffer.from(signature, "base64"));
  } catch {
    valid = false;
  }
  if (valid && !pinnedKey) {
    pinnedKey = key;
    updateInstallConfig({ serverPublicKey: offeredKey });
    console.log("Learned the server's signing key - replies from now on must be signed by it");
  }
  return valid;
}

function rejectedReply(config: SignedConfig | undefined): AxiosError {
  // No `response` on purpose: callers and the failover below treat it like an unreachable
  // server, so nothing in it is acted on.
  return new AxiosError("Reply not signed by this agent's server - ignored", "ERR_BAD_SIGNATURE", config);
}

// Must be applied straight after axios.create, before any other response interceptor, so
// nothing else ever sees an unverified reply.
function withSignedReplies(client: AxiosInstance): AxiosInstance {
  client.defaults.transformResponse = [
    function keepRawBody(this: SignedConfig, data: unknown) {
      this.emRawBody = data;
      return data;
    },
    ...(Array.isArray(axios.defaults.transformResponse) ? axios.defaults.transformResponse : []),
  ];
  client.interceptors.request.use((config) => {
    const signed = config as SignedConfig;
    signed.emNonce = crypto.randomBytes(16).toString("hex");
    signed.emRawBody = undefined;
    config.headers["X-EM-Nonce"] = signed.emNonce;
    return config;
  });
  client.interceptors.response.use(
    (response) => {
      if (!replyIsAuthentic(response.config as SignedConfig, response.status, response.headers)) throw rejectedReply(response.config as SignedConfig);
      return response;
    },
    (error) => {
      const response = error?.response;
      if (response && !replyIsAuthentic(error.config as SignedConfig, response.status, response.headers)) throw rejectedReply(error.config);
      throw error;
    },
  );
  return client;
}

const probeClient = withSignedReplies(axios.create({ timeout: PROBE_TIMEOUT_MS, httpsAgent }));

let serverUrls = agentConfig.serverUrls;
let currentUrl = agentConfig.initialServerUrl;
const clients: AxiosInstance[] = [];
let selecting: Promise<void> | null = null;

export function getServerUrl(): string {
  return currentUrl;
}

async function isReachable(url: string): Promise<boolean> {
  try {
    await probeClient.get(`${url}/health`);
    return true;
  } catch {
    return false;
  }
}

function switchTo(url: string) {
  if (url === currentUrl) return;
  console.log(`Server address changed: ${currentUrl} -> ${url}`);
  currentUrl = url;
  for (const client of clients) client.defaults.baseURL = url;
  updateInstallConfig({ serverUrl: url });
}

// Moves to the first address in preference order that answers. Concurrent callers share one
// probe run. Leaves the current address alone if none answer (the network is just down).
function selectServer(): Promise<void> {
  if (!selecting) {
    selecting = (async () => {
      for (const url of serverUrls) {
        if (await isReachable(url)) {
          switchTo(url);
          return;
        }
      }
    })().finally(() => {
      selecting = null;
    });
  }
  return selecting;
}

// Called with the list the server sends on check-in. Persisted so a restart (or a reinstall
// that keeps config.json) starts from the admin's current list.
export function setServerUrls(urls: string[]): void {
  const next = parseServerUrls(urls);
  if (next.length === 0 || process.env.UEM_SERVER_URL) return;
  if (next.join(",") === serverUrls.join(",")) return;
  console.log(`Server address list updated: ${next.join(", ")}`);
  serverUrls = next;
  updateInstallConfig({ serverUrls: next });
  // Re-pick if the address in use was dropped, or a more-preferred one was added ahead of it.
  if (serverUrls.indexOf(currentUrl) !== 0) void selectServer();
}

type RetryableConfig = InternalAxiosRequestConfig & { serverFailoverRetried?: boolean };

function withFailover(client: AxiosInstance): AxiosInstance {
  clients.push(client);
  client.interceptors.response.use(undefined, async (error) => {
    const config = error?.config as RetryableConfig | undefined;
    // An HTTP response means the server was reached - auth/validation errors are not a
    // reason to switch addresses.
    if (!config || error.response || config.serverFailoverRetried || serverUrls.length < 2) throw error;
    config.serverFailoverRetried = true;
    const before = currentUrl;
    await selectServer();
    // Only retry on a different address - re-sending to the same one could duplicate a
    // request the server did receive but answered too slowly.
    if (currentUrl === before) throw error;
    config.baseURL = currentUrl;
    return client.request(config);
  });
  return client;
}

setInterval(() => {
  if (serverUrls.indexOf(currentUrl) !== 0) void selectServer();
}, PREFERRED_RECHECK_MS).unref();

// ------------------------------------------------------------------------------------------

export const publicClient = withFailover(
  withSignedReplies(
    axios.create({
      baseURL: currentUrl,
      timeout: 15_000,
      httpsAgent,
    }),
  ),
);

type ReenrollConfig = InternalAxiosRequestConfig & { reenrollRetried?: boolean };

// The server's answer for an agent id/key it doesn't recognise (server agentAuth.ts).
const INVALID_CREDENTIALS = "Invalid agent credentials";

// `reenroll` (optional) recovers from a stale saved identity: if the server rejects the
// credentials before they have ever been accepted in this run, the agent enrolls again with
// its token, swaps in the new identity and retries the request once. Once any request has
// succeeded, a later rejection means the record was removed on purpose (admin Delete, or
// the uninstall flow's own confirm call) - the agent must NOT resurrect itself then, so it
// keeps failing exactly as before.
export function agentClient(
  agentId: string,
  apiKey: string,
  reenroll?: () => Promise<{ agentId: string; apiKey: string }>,
) {
  const client = withSignedReplies(
    axios.create({
      baseURL: currentUrl,
      timeout: 15_000,
      httpsAgent,
    }),
  );

  // Stamped onto every request rather than set as instance headers, so a re-enrollment
  // takes effect for all later requests (instance headers given to axios.create would
  // outrank anything set on defaults.headers.common afterwards).
  let identity = { agentId, apiKey };
  client.interceptors.request.use((config) => {
    config.headers["X-Agent-Id"] = identity.agentId;
    config.headers["X-Agent-Key"] = identity.apiKey;
    return config;
  });

  let credentialsAccepted = false;
  let reenrolling: Promise<boolean> | null = null;

  // Concurrent rejected requests share one enrollment attempt.
  function reenrollOnce(): Promise<boolean> {
    if (!reenrolling) {
      reenrolling = (async () => {
        try {
          console.log("Server rejected this agent's saved identity - re-enrolling with the enrollment token");
          identity = await reenroll!();
          return true;
        } catch (err) {
          console.error("Re-enrollment failed (check the enrollment token)", err instanceof Error ? err.message : err);
          return false;
        }
      })().finally(() => {
        // Allow a later retry (e.g. after an admin fixes the token) on the next rejection.
        setTimeout(() => {
          reenrolling = null;
        }, 60_000).unref();
      });
    }
    return reenrolling;
  }

  client.interceptors.response.use(
    (response) => {
      credentialsAccepted = true;
      return response;
    },
    async (error) => {
      const config = error?.config as ReenrollConfig | undefined;
      const rejected = error?.response?.status === 401 && error.response.data?.error === INVALID_CREDENTIALS;
      if (!reenroll || !rejected || credentialsAccepted || !config || config.reenrollRetried) throw error;
      if (!(await reenrollOnce())) throw error;
      config.reenrollRetried = true;
      return client.request(config);
    },
  );

  return withFailover(client);
}
