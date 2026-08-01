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

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "https://SSSIL-LAP-92:4000",
        changeOrigin: true,
        agent: devServerAgent(),
      },
    },
  },
});
