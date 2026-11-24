import { getServerUrl } from "./httpClient";

// Why this agent isn't connected to the Endpoint IQ server, in words the person at the PC (and the
// IT team they call) can act on. Shown by the tray app (GET /status on the local API).

let current: { text: string; since: Date } | null = null;

export function setConnectionProblem(text: string | null): void {
  if (!text) {
    current = null;
    return;
  }
  if (current?.text !== text) current = { text, since: new Date() };
}

export function connectionProblem(): { text: string; since: string } | null {
  return current ? { text: current.text, since: current.since.toISOString() } : null;
}

type HttpError = {
  code?: string;
  message?: string;
  response?: { status?: number; data?: { error?: string } };
};

export function describeConnectionError(err: unknown, phase: "enroll" | "checkin"): string {
  const e = (err ?? {}) as HttpError;
  const status = e.response?.status;
  const serverText = e.response?.data?.error ?? "";
  if (phase === "enroll" && status === 403 && /agent limit/i.test(serverText)) {
    return "Not connected: the organisation's Endpoint IQ licence has no endpoints left (its limit has been reached). Ask your IT administrator to free a licence or add more; this PC connects by itself as soon as one is available.";
  }
  if (phase === "enroll" && status === 403 && /not licensed/i.test(serverText)) {
    return "Not connected: the Endpoint IQ server's licence isn't active (not activated, expired or revoked), so new endpoints can't join. Ask your IT administrator; this PC connects by itself once the licence is active.";
  }
  if (phase === "enroll" && (status === 400 || status === 401 || status === 404)) {
    return `Not connected: the server didn't accept this PC's enrollment token (${serverText || "expired, revoked or used up"}). Ask your IT administrator for a new installer.`;
  }
  if (phase === "checkin" && status === 401) {
    return "Not connected: this PC was removed from the Endpoint IQ console, so the server no longer accepts it. Ask your IT administrator to reinstall the agent if it should be managed.";
  }
  if (e.code === "ERR_BAD_SIGNATURE") {
    return "Not connected: the server's replies couldn't be verified as coming from your organisation's Endpoint IQ server. Ask your IT administrator to check the server address.";
  }
  if (/certificate|self[- ]signed|unable to verify|CERT_|SSL|TLS/i.test(`${e.code ?? ""} ${e.message ?? ""}`)) {
    return `Not connected: the server's security certificate isn't trusted (${getServerUrl()}). Ask your IT administrator.`;
  }
  if (!e.response) {
    return `Not connected: can't reach the Endpoint IQ server at ${getServerUrl()}. Check the network, Wi-Fi or VPN; the agent keeps trying every minute.`;
  }
  return `Not connected: the server answered ${status}${serverText ? ` (${serverText})` : ""}. The agent keeps trying; ask your IT administrator if it continues.`;
}
