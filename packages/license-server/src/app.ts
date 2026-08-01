import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { logger } from "./logger";
import { authRouter } from "./routes/auth.routes";
import { entitiesRouter } from "./routes/entities.routes";
import { licenseKeysRouter } from "./routes/licenseKeys.routes";
import { unlockRequestsRouter } from "./routes/unlockRequests.routes";
import { activationRouter } from "./routes/activation.routes";
import { adminAuthMiddleware } from "./middleware/adminAuth";
import { errorHandler } from "./middleware/errorHandler";

// Set by the packaged deployment (scripts/package-license-server.ps1 copies the built
// license-console's dist/ to this exact path alongside the compiled server). Absent in
// the dev workflow, where license-console is served by its own Vite dev server instead —
// mirrors the identical pattern already proven in packages/server/src/app.ts.
const CONSOLE_DIST_PATH = path.resolve(__dirname, "..", "console-dist");
const consoleDistExists = fs.existsSync(path.join(CONSOLE_DIST_PATH, "index.html"));

export function createApp() {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  if (consoleDistExists) {
    app.use(express.static(CONSOLE_DIST_PATH));
  }

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);

  // Public, unauthenticated, rate-limited — called by Endpoint Manager deployments
  // that have no prior relationship with this server yet.
  app.use("/api", activationRouter);

  app.use("/api/admin/entities", adminAuthMiddleware, entitiesRouter);
  app.use("/api/admin/license-keys", adminAuthMiddleware, licenseKeysRouter);
  app.use("/api/admin/unlock-requests", adminAuthMiddleware, unlockRequestsRouter);

  // SPA fallback — any GET that isn't /api/* or /health and didn't match a static asset
  // above falls through to the console's index.html, same as packages/server/src/app.ts.
  if (consoleDistExists) {
    app.get(/^\/(?!api\/|health$).*/, (_req, res) => {
      res.sendFile(path.join(CONSOLE_DIST_PATH, "index.html"));
    });
  }

  app.use(errorHandler);

  return app;
}
