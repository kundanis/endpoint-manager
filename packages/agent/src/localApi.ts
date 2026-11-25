import { currentScreenshotBlockSettings, queueScreenshotBlockEvents } from "./screenshotBlockEnforcer";
import { currentAiClipboardSettings } from "./aiGuardAgent";
import { consentForUser, recordConsent } from "./consent";
import http from "node:http";
import { executeCommand } from "./commandExecutor";
import { connectionProblem } from "./connectionProblem";
import os from "node:os";
import type { AxiosInstance } from "axios";
import { queueBlockerEvent } from "./appControlEnforcer";
import { agentConfig } from "./config";
import { getServerUrl } from "./httpClient";
import { LOCAL_API_PORT, startTrayAuth, TRAY_TOKEN_HEADER, userForToken } from "./trayAuth";

// Local channel for the Endpoint IQ tray app (EndpointIQTray.exe), which runs in each signed-in
// user's session and can't talk to the server itself (it has no agent credentials). Listens on
// the loopback address only. Anything it asks of the server goes through this agent's own
// authenticated client, so the tray can only read this endpoint's policies and send pause
// requests that an admin must still approve.
//
// Guarded against web pages: the tray sends a custom header (which a browser can't add to a
// cross-site request without a CORS preflight this server never answers), requests carrying an
// Origin header are refused, and the Host header must be the loopback address (no DNS rebinding).
//
// Guarded against other users on the same PC: every request except the status ping carries the
// calling user's own key (trayAuth.ts), and the user it was issued to is the one the request is
// made as - any user name in the request body is replaced, never trusted.
export { LOCAL_API_PORT };
const TRAY_HEADER = "x-endpoint-iq-tray";
const MAX_BODY_BYTES = 16 * 1024;

export interface AgentStatusSource {
  lastCheckinOkAt(): Date | null;
  syncNow(): boolean; // false when a sync was started too recently
}

function send(res: http.ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// The server's error message, for the tray to show the user.
function serverError(err: unknown): { status: number; message: string } {
  const e = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
  if (e.response) return { status: e.response.status ?? 502, message: e.response.data?.error ?? `Server answered ${e.response.status}` };
  return { status: 503, message: "Can't reach the Endpoint IQ server right now." };
}

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function isTrayRequest(req: http.IncomingMessage): boolean {
  const host = (req.headers.host ?? "").toLowerCase();
  return (
    req.headers[TRAY_HEADER] === "1" &&
    req.headers.origin === undefined &&
    (host === `127.0.0.1:${LOCAL_API_PORT}` || host === `localhost:${LOCAL_API_PORT}`)
  );
}

// The port can still be held for a moment by an agent process that is shutting down (after an
// update, for example): keep trying instead of leaving the tray app without its channel.
function listenWithRetry(server: http.Server, what: string): void {
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`${what} couldn't open 127.0.0.1:${LOCAL_API_PORT} - retrying in 30 seconds`, err.code ?? err.message);
    setTimeout(() => {
      if (!server.listening) server.listen(LOCAL_API_PORT, "127.0.0.1");
    }, 30_000).unref();
  });
  server.on("listening", () => console.log(`${what} listening on 127.0.0.1:${LOCAL_API_PORT}`));
  server.listen(LOCAL_API_PORT, "127.0.0.1");
}

// Before the agent has been accepted by the server (enrollment refused or server unreachable):
// only the status ping, saying why - so the tray app shows the reason instead of "not running".
export function startStatusOnlyApi(): () => Promise<void> {
  if (process.platform !== "win32") return async () => {};
  const server = http.createServer((req, res) => {
    if (!isTrayRequest(req)) return send(res, 403, { error: "Forbidden" });
    const route = `${req.method} ${(req.url ?? "").split("?")[0]}`;
    const problem = connectionProblem();
    if (route === "GET /status") {
      return send(res, 200, { version: agentConfig.agentVersion, hostname: os.hostname(), serverUrl: getServerUrl(), connected: false, lastCheckinAt: null, problem });
    }
    return send(res, 503, { error: problem?.text ?? "The Endpoint IQ agent isn't connected to the server yet." });
  });
  listenWithRetry(server, "Tray channel (not connected yet)");
  return () => new Promise<void>((resolve) => (server.listening ? server.close(() => resolve()) : resolve()));
}

export function startLocalApi(client: AxiosInstance, source: AgentStatusSource): void {
  if (process.platform !== "win32") return;
  startTrayAuth();

  const server = http.createServer(async (req, res) => {
    if (!isTrayRequest(req)) {
      return send(res, 403, { error: "Forbidden" });
    }

    const route = `${req.method} ${(req.url ?? "").split("?")[0]}`;
    // Only the status ping (version, connection state - nothing about any user) works without a key.
    const user = userForToken(req.headers[TRAY_TOKEN_HEADER]);
    if (!user && route !== "GET /status") return send(res, 401, { error: "The Endpoint IQ agent hasn't recognised this user yet. Try again in a minute." });
    try {
      switch (route) {
        case "GET /status": {
          const last = source.lastCheckinOkAt();
          const connected = !!last && Date.now() - last.getTime() < 5 * 60_000;
          return send(res, 200, {
            version: agentConfig.agentVersion,
            hostname: os.hostname(),
            serverUrl: getServerUrl(),
            connected,
            lastCheckinAt: last?.toISOString() ?? null,
            // Why it isn't connected (licence, removed from the console, network...).
            problem: connected ? null : connectionProblem(),
          });
        }
        case "GET /consent":
          // The organisation's notice and this user's answer (endpoint user consent, consent.ts).
          return send(res, 200, await consentForUser(client, user!.account));
        case "POST /consent": {
          const b = asObject(await readBody(req));
          const decision = b.decision === "AGREED" || b.decision === "DECLINED" ? b.decision : null;
          if (!decision || typeof b.version !== "number") return send(res, 400, { error: "Choose I agree or Decline." });
          // Recorded for the user the key was issued to - never a name from the request.
          return send(res, 200, await recordConsent(client, user!.account, decision, b.version));
        }
        case "GET /info":
          // This endpoint's groups (and other details the tray app shows).
          return send(res, 200, (await client.get("/api/agent/info")).data);
        case "POST /uninstall": {
          // Uninstall from the PC: the server checks the uninstall password (and refuses when
          // none is set), then hands over the same uninstall script the console uses.
          const b = asObject(await readBody(req));
          if (typeof b.password !== "string" || !b.password) return send(res, 400, { error: "Enter the uninstall password." });
          const { data } = await client.post<{ script: string }>("/api/agent/self-uninstall", { password: b.password, requestedBy: user!.account });
          console.log(`Uninstall requested from this PC by ${user!.account} - the password was accepted, uninstalling`);
          // The script only sets up a separate scheduled task that does the removal (so it survives
          // the agent stopping) and finishes in a few seconds, so wait for it and say if it failed.
          // Not a detached launch: powershell.exe started detached has no console and exits
          // without running anything.
          const result = await executeCommand({ id: "tray-uninstall", jobId: "tray-uninstall", shell: "powershell", script: data.script, timeoutSec: 15 });
          if (result.status !== "SUCCESS") {
            const detail = (result.stderr || result.stdout).trim().slice(0, 1000);
            console.error(`Uninstall from this PC couldn't start (${result.status}, exit ${result.exitCode}): ${detail}`);
            return send(res, 500, { error: "The password was accepted, but the uninstall couldn't start on this PC. Ask your IT administrator to uninstall it from the console." });
          }
          return send(res, 202, { started: true });
        }
        case "POST /sync":
          return send(res, 202, { started: source.syncNow() });
        case "GET /policies":
          return send(res, 200, (await client.get("/api/agent/policies")).data);
        case "GET /pause-requests":
          return send(res, 200, (await client.get("/api/agent/pause-requests")).data);
        case "POST /pause-requests": {
          const body = { ...asObject(await readBody(req)), requestedBy: user!.account };
          const { data } = await client.post("/api/agent/pause-requests", body);
          return send(res, 201, data);
        }
        case "GET /screenshot-block":
          // What the tray app blocks in this user's session (EPM screenshot blocking).
          return send(res, 200, currentScreenshotBlockSettings());
        case "POST /screenshot-block/events": {
          const events = asObject(await readBody(req)).events;
          queueScreenshotBlockEvents(Array.isArray(events) ? events.map((e) => ({ ...asObject(e), username: user!.userName })) : undefined);
          return send(res, 204);
        }
        case "GET /ai-guard/clipboard":
          // AI Guard: what the tray's clipboard check looks for, and in which AI desktop apps.
          return send(res, 200, currentAiClipboardSettings());
        case "POST /ai-guard/clipboard-events": {
          // Sensitive data the tray kept out of an AI desktop app (masked sample only).
          const b = asObject(await readBody(req));
          await client.post("/api/agent/ai-guard/clipboard-events", {
            process: b.process,
            action: b.action,
            dataTypes: b.dataTypes,
            maskedSample: b.maskedSample,
          });
          return send(res, 204);
        }
        case "POST /usage": {
          // Time per application and website from the tray (user productivity).
          await client.post("/api/agent/user-productivity/app-usage", { ...asObject(await readBody(req)), username: user!.userName });
          return send(res, 204);
        }
        case "POST /app-control/blocked": {
          // A launch the blocker (blocked.ps1, run as the user instead of a blocked program) stopped.
          const body = asObject(await readBody(req));
          if (typeof body.path === "string" && body.path) queueBlockerEvent(body.path, typeof body.at === "string" ? body.at : null);
          return send(res, 204);
        }
        default:
          return send(res, 404, { error: "Not found" });
      }
    } catch (err) {
      const { status, message } = serverError(err);
      return send(res, status, { error: message });
    }
  });

  listenWithRetry(server, "Tray channel");
}
