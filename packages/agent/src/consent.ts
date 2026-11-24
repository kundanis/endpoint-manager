import { promises as fs } from "node:fs";
import path from "node:path";
import type { AxiosInstance, AxiosResponse } from "axios";
import { endpointConsentState, type AgentConsentWire, type EndpointConsentState } from "@em/shared";
import { agentConfig } from "./config";
import { signedInUsers } from "./trayAuth";

// Endpoint user consent (DPDP, Windows). The tray app shows each signed-in user the organisation's
// notice; this module keeps the notice and the answers (cached in .state/consent.json so the rule
// holds while the server is unreachable) and decides whether monitoring data may leave the PC.
//
// Until every user signed in to the PC has agreed to the notice in force, the requests listed in
// MONITORING_PATHS are dropped here - answered as if sent, so nothing is queued and sent later.
// Check-ins, policy downloads and the blocking modules' own sync reports go on as usual.

const REFRESH_MS = 60 * 1000;

// Monitoring data about users and their activity.
const MONITORING_PATHS = [
  "/api/agent/inventory",
  "/api/agent/user-productivity/",
  "/api/agent/screen-capture/report",
  "/api/agent/screen-capture/image",
  "/api/agent/dlp/events",
  "/api/agent/data-discovery/",
  "/api/agent/data-movement/",
  "/api/agent/usb-control/events",
  "/api/agent/command-block/events",
  "/api/agent/screenshot-block/report",
  "/api/agent/security-signals",
  "/api/agent/ai-guard/components",
  "/api/agent/ai-guard/clipboard-events",
];

let notice: AgentConsentWire | null = null; // null: not known yet
let loaded = false;
const stateFile = () => path.join(agentConfig.stateDir, "consent.json");

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    notice = JSON.parse(await fs.readFile(stateFile(), "utf8")) as AgentConsentWire;
  } catch {
    notice = null;
  }
}

async function store(next: AgentConsentWire): Promise<void> {
  notice = next;
  await fs.writeFile(stateFile(), JSON.stringify(next), "utf8").catch(() => {});
}

function answersOf(account: string) {
  return notice?.answers.find((a) => a.account.toLowerCase() === account.toLowerCase()) ?? null;
}

// The state for the users signed in now. Not known yet (a fresh install that hasn't reached the
// server) counts as PENDING: nothing is sent until the server says consent isn't required.
export function currentConsentState(): EndpointConsentState {
  if (process.platform !== "win32") return "NOT_REQUIRED";
  if (!notice) return "PENDING";
  if (!notice.required) return "NOT_REQUIRED";
  const users = signedInUsers();
  if (users.length === 0) return lastSignedInState;
  const state = endpointConsentState(
    true,
    notice.version,
    users.map((u) => answersOf(u.account) ?? { account: u.account, decision: "PENDING" as const, noticeVersion: null }),
  );
  lastSignedInState = state;
  return state;
}
// With nobody signed in, what applied to the last users.
let lastSignedInState: EndpointConsentState = "PENDING";

export function monitoringAllowed(): boolean {
  const s = currentConsentState();
  return s === "NOT_REQUIRED" || s === "ACTIVE";
}

export function isMonitoringPath(url: string): boolean {
  const p = url.split("?")[0];
  return MONITORING_PATHS.some((m) => (m.endsWith("/") ? p.startsWith(m) : p === m));
}

// Wraps the agent's client so monitoring data is dropped while consent is missing.
export function withConsentGate(client: AxiosInstance): AxiosInstance {
  const post = client.post.bind(client);
  client.post = ((url: string, data?: unknown, config?: unknown) => {
    if (isMonitoringPath(url) && !monitoringAllowed()) {
      const dropped = { data: {}, status: 204, statusText: "Not sent (no user consent)", headers: {}, config: config ?? {} } as unknown as AxiosResponse;
      return Promise.resolve(dropped);
    }
    return post(url, data as never, config as never);
  }) as typeof client.post;
  return client;
}

// ---- Server side ------------------------------------------------------------------------------------

export async function refreshConsent(client: AxiosInstance): Promise<void> {
  try {
    const { data } = await client.get<AgentConsentWire>("/api/agent/consent");
    await store(data);
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    // A server from before the consent feature: nothing to ask.
    if (status === 404) await store({ required: false, version: 0, title: "", body: "", grievanceContact: "", answers: [] });
  }
}

export function startConsent(client: AxiosInstance): void {
  if (process.platform !== "win32") return;
  void load().then(() => refreshConsent(client));
  setInterval(() => void refreshConsent(client), REFRESH_MS);
}

// What the tray app shows one user (GET /consent on the local API).
export async function consentForUser(client: AxiosInstance, account: string) {
  await load();
  if (!notice) await refreshConsent(client);
  const mine = answersOf(account);
  return {
    required: !!notice?.required,
    version: notice?.version ?? 0,
    title: notice?.title ?? "",
    body: notice?.body ?? "",
    grievanceContact: notice?.grievanceContact ?? "",
    // The user's answer to the notice in force: PENDING if they haven't answered it.
    decision: mine && notice && mine.noticeVersion === notice.version ? mine.decision : "PENDING",
    endpointState: currentConsentState(),
  };
}

// The user answered in the tray app.
export async function recordConsent(client: AxiosInstance, account: string, decision: "AGREED" | "DECLINED", version: number) {
  const { data } = await client.post<AgentConsentWire>("/api/agent/consent", { account, decision, version });
  await store(data);
  return consentForUser(client, account);
}

// Windows users signed in now, for the check-in.
export function signedInAccounts(): string[] {
  return signedInUsers().map((u) => u.account);
}
