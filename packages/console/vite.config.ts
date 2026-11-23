import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same self-signed dev certificate the agent trusts (see packages/agent/src/config.ts
// and docs/tls-setup.md) — a custom https.Agent that trusts THIS specific certificate,
// not a blanket "skip validation" (`secure: false` would defeat the point of adding TLS
// at all). Falls back to undefined (default public-CA validation) if the file's absent,
// which is the normal case outside this one dev machine.
function devServerAgent(): https.Agent | undefined {
  const caPath = path.resolve(__dirname, "../agent/certs-trust/dev-server-public.pem");
  try {
    return new https.Agent({ ca: fs.readFileSync(caPath) });
  } catch {
    return undefined;
  }
}

// Loopback only by default. The dev proxy below makes every request reach the server from
// 127.0.0.1, which the server's IP allowlist and per-address rate limits trust - so exposing
// this port on the LAN would let anyone there skip them. Opt in deliberately with
// VITE_HOST=true (all interfaces) or VITE_HOST=<address>, e.g. for admins on the tailnet.
// 127.0.0.1 rather than "localhost": Node resolves that to ::1 only, and a local reverse
// proxy (Tailscale serve/funnel -> http://127.0.0.1:5173) then gets 502. Browsers on this
// machine reach http://localhost:5173 over IPv4 just the same.
const lanHost = process.env.VITE_HOST?.trim();
const host: string | boolean = !lanHost || lanHost === "false" ? "127.0.0.1" : lanHost === "true" ? true : lanHost;

export default defineConfig({
  plugins: [react()],
  server: {
    host,
    port: 5173,
    // Tailscale names (e.g. http://<machine>.<tailnet>.ts.net:5173), for admins on the tailnet
    // (only reachable when VITE_HOST opens the server beyond localhost).
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": {
        // Plain HTTP for now — TLS_PFX_PATH is unset in packages/server/.env, see
        // docs/tls-setup.md for how to switch both the server and this proxy back to HTTPS.
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
