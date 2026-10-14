import https from "node:https";
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
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

let serverUrls = agentConfig.serverUrls;
let currentUrl = agentConfig.initialServerUrl;
const clients: AxiosInstance[] = [];
let selecting: Promise<void> | null = null;

export function getServerUrl(): string {
  return currentUrl;
}

async function isReachable(url: string): Promise<boolean> {
  try {
    await axios.get(`${url}/health`, { timeout: PROBE_TIMEOUT_MS, httpsAgent });
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
  axios.create({
    baseURL: currentUrl,
    timeout: 15_000,
    httpsAgent,
  }),
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
  const client = axios.create({
    baseURL: currentUrl,
    timeout: 15_000,
    httpsAgent,
    headers: {
      "X-Agent-Id": agentId,
      "X-Agent-Key": apiKey,
    },
  });

  let credentialsAccepted = false;
  let reenrolling: Promise<boolean> | null = null;

  // Concurrent rejected requests share one enrollment attempt.
  function reenrollOnce(): Promise<boolean> {
    if (!reenrolling) {
      reenrolling = (async () => {
        try {
          console.log("Server rejected this agent's saved identity - re-enrolling with the enrollment token");
          const next = await reenroll!();
          client.defaults.headers.common["X-Agent-Id"] = next.agentId;
          client.defaults.headers.common["X-Agent-Key"] = next.apiKey;
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
      config.headers["X-Agent-Id"] = client.defaults.headers.common["X-Agent-Id"];
      config.headers["X-Agent-Key"] = client.defaults.headers.common["X-Agent-Key"];
      return client.request(config);
    },
  );

  return withFailover(client);
}
