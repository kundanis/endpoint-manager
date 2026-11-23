import { currentScreenshotBlockSettings, queueScreenshotBlockEvents } from "./screenshotBlockEnforcer";
import http from "node:http";
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

export function startLocalApi(client: AxiosInstance, source: AgentStatusSource): void {
  if (process.platform !== "win32") return;
  startTrayAuth();

  const server = http.createServer(async (req, res) => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (
      req.headers[TRAY_HEADER] !== "1" ||
      req.headers.origin !== undefined ||
      (host !== `127.0.0.1:${LOCAL_API_PORT}` && host !== `localhost:${LOCAL_API_PORT}`)
    ) {
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
          });
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

  server.on("error", (err) => console.error("Tray channel (local API) stopped", err));
  server.listen(LOCAL_API_PORT, "127.0.0.1", () => console.log(`Tray channel listening on 127.0.0.1:${LOCAL_API_PORT}`));
}
