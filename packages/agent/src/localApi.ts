import { currentScreenshotBlockSettings, queueScreenshotBlockEvents } from "./screenshotBlockEnforcer";
import http from "node:http";
import os from "node:os";
import type { AxiosInstance } from "axios";
import { agentConfig } from "./config";
import { getServerUrl } from "./httpClient";

// Local channel for the Endpoint IQ tray app (EndpointIQTray.exe), which runs in each signed-in
// user's session and can't talk to the server itself (it has no agent credentials). Listens on
// the loopback address only. Anything it asks of the server goes through this agent's own
// authenticated client, so the tray can only read this endpoint's policies and send pause
// requests that an admin must still approve.
//
// Guarded against web pages: the tray sends a custom header (which a browser can't add to a
// cross-site request without a CORS preflight this server never answers), requests carrying an
// Origin header are refused, and the Host header must be the loopback address (no DNS rebinding).
export const LOCAL_API_PORT = 47613;
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

export function startLocalApi(client: AxiosInstance, source: AgentStatusSource): void {
  if (process.platform !== "win32") return;

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
          const body = await readBody(req);
          const { data } = await client.post("/api/agent/pause-requests", body);
          return send(res, 201, data);
        }
        case "GET /screenshot-block":
          // What the tray app blocks in this user's session (EPM screenshot blocking).
          return send(res, 200, currentScreenshotBlockSettings());
        case "POST /screenshot-block/events": {
          const body = (await readBody(req)) as { events?: unknown } | undefined;
          queueScreenshotBlockEvents(body?.events);
          return send(res, 204);
        }
        case "POST /usage": {
          // Time per application and website from the tray (user productivity).
          await client.post("/api/agent/user-productivity/app-usage", await readBody(req));
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
