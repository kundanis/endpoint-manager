import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { logger } from "./logger";
import { authRouter } from "./routes/auth.routes";
import { agentEnrollRouter } from "./routes/agentEnroll.routes";
import { agentRouter } from "./routes/agent.routes";
import { adminRouter } from "./routes/admin.routes";
import { commandsRouter } from "./routes/commands.routes";
import { commandTemplatesRouter } from "./routes/commandTemplates.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
import { packagesRouter } from "./routes/packages.routes";
import { deploymentsRouter } from "./routes/deployments.routes";
import { patchesRouter } from "./routes/patches.routes";
import { vulnerabilitiesRouter } from "./routes/vulnerabilities.routes";
import { assetGroupsRouter } from "./routes/assetGroups.routes";
import { customFieldsRouter } from "./routes/customFields.routes";
import { softwareLicensesRouter } from "./routes/softwareLicenses.routes";
import { networkScanRouter } from "./routes/networkScan.routes";
import { networkVlanRouter } from "./routes/networkVlan.routes";
import { securityConfigRouter } from "./routes/securityConfig.routes";
import { zeroTrustRouter } from "./routes/zeroTrust.routes";
import { dataDiscoveryRouter } from "./routes/dataDiscovery.routes";
import { dlpRouter } from "./routes/dlp.routes";
import { dataMovementRouter } from "./routes/dataMovement.routes";
import { appControlRouter } from "./routes/appControl.routes";
import { webBlockRouter } from "./routes/webBlock.routes";
import { commandBlockRouter } from "./routes/commandBlock.routes";
import { ipBlockRouter } from "./routes/ipBlock.routes";
import { usbControlRouter } from "./routes/usbControl.routes";
import { policyAccessExceptionRouter } from "./routes/policyAccessException.routes";
import { agentSecurityRouter } from "./routes/agentSecurity.routes";
import { userProductivityRouter } from "./routes/userProductivity.routes";
import { edrRouter } from "./routes/edr.routes";
import { licenseActivationRouter } from "./routes/licenseActivation.routes";
import { agentAuthMiddleware } from "./middleware/agentAuth";
import { adminAuthMiddleware } from "./middleware/adminAuth";
import { requireModule } from "./middleware/requireModule";
import { errorHandler } from "./middleware/errorHandler";

// Set by the packaged deployment (packages/server/scripts/package-server.ps1 copies the
// built console's dist/ to this exact path alongside the compiled server). Absent in the
// dev workflow, where the console is served by its own Vite dev server instead — checked
// at startup, not per-request, so a missing folder costs nothing on every request.
const CONSOLE_DIST_PATH = path.resolve(__dirname, "..", "console-dist");
const consoleDistExists = fs.existsSync(path.join(CONSOLE_DIST_PATH, "index.html"));

export function createApp() {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "5mb" }));

  if (consoleDistExists) {
    app.use(express.static(CONSOLE_DIST_PATH));
  }

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);

  // Enrollment is the one agent-facing endpoint mounted before agentAuthMiddleware —
  // a not-yet-enrolled agent has no API key to authenticate with.
  app.use("/api/agent/enroll", agentEnrollRouter);
  app.use("/api/agent", agentAuthMiddleware, agentRouter);

  // More specific /api/admin/commands mount registered before the broader /api/admin
  // mount — Express matches app.use prefixes in registration order, so this avoids
  // commands requests falling through adminRouter (and re-running adminAuthMiddleware) first.
  //
  // requireModule(...) sits after adminAuthMiddleware on every module-specific mount —
  // Dashboard and Licensing are deliberately the only two admin routers with no module
  // gate at all, since both must stay reachable regardless of which modules a license
  // includes (Dashboard for a fleet overview, Licensing so the admin can even see/fix
  // their license in the first place).
  app.use("/api/admin/dashboard", adminAuthMiddleware, dashboardRouter);
  app.use("/api/admin/commands", adminAuthMiddleware, requireModule("ENDPOINT_MANAGER"), commandsRouter);
  app.use("/api/admin/command-templates", adminAuthMiddleware, requireModule("ENDPOINT_MANAGER"), commandTemplatesRouter);
  app.use("/api/admin/packages", adminAuthMiddleware, requireModule("ENDPOINT_MANAGER"), packagesRouter);
  app.use("/api/admin/deployments", adminAuthMiddleware, requireModule("ENDPOINT_MANAGER"), deploymentsRouter);
  app.use("/api/admin/patches", adminAuthMiddleware, requireModule("SECURITY_MANAGER"), patchesRouter);
  app.use("/api/admin/vulnerabilities", adminAuthMiddleware, requireModule("SECURITY_MANAGER"), vulnerabilitiesRouter);
  app.use("/api/admin/asset-groups", adminAuthMiddleware, requireModule("ENDPOINT_MANAGER"), assetGroupsRouter);
  app.use("/api/admin/custom-fields", adminAuthMiddleware, requireModule("ENDPOINT_MANAGER"), customFieldsRouter);
  app.use("/api/admin/software-licenses", adminAuthMiddleware, requireModule("SOFTWARE_MANAGER"), softwareLicensesRouter);
  app.use("/api/admin/network-scans", adminAuthMiddleware, requireModule("NETWORK_MANAGER"), networkScanRouter);
  app.use("/api/admin/network-vlans", adminAuthMiddleware, requireModule("NETWORK_MANAGER"), networkVlanRouter);
  app.use("/api/admin/security-config", adminAuthMiddleware, requireModule("SECURITY_MANAGER"), securityConfigRouter);
  app.use("/api/admin/zero-trust", adminAuthMiddleware, requireModule("SECURITY_MANAGER"), zeroTrustRouter);
  app.use("/api/admin/data-discovery", adminAuthMiddleware, requireModule("DATA_MANAGER"), dataDiscoveryRouter);
  app.use("/api/admin/dlp", adminAuthMiddleware, requireModule("DATA_MANAGER"), dlpRouter);
  app.use("/api/admin/data-movement", adminAuthMiddleware, requireModule("DATA_MANAGER"), dataMovementRouter);
  app.use("/api/admin/app-control", adminAuthMiddleware, requireModule("DATA_MANAGER"), appControlRouter);
  app.use("/api/admin/web-block", adminAuthMiddleware, requireModule("DATA_MANAGER"), webBlockRouter);
  app.use("/api/admin/command-block", adminAuthMiddleware, requireModule("DATA_MANAGER"), commandBlockRouter);
  app.use("/api/admin/ip-block", adminAuthMiddleware, requireModule("DATA_MANAGER"), ipBlockRouter);
  app.use("/api/admin/usb-control", adminAuthMiddleware, requireModule("DATA_MANAGER"), usbControlRouter);
  app.use("/api/admin/policy-exceptions", adminAuthMiddleware, requireModule("DATA_MANAGER"), policyAccessExceptionRouter);
  app.use("/api/admin/agent-security", adminAuthMiddleware, requireModule("ENDPOINT_MANAGER"), agentSecurityRouter);
  app.use("/api/admin/user-productivity", adminAuthMiddleware, requireModule("USER_MANAGER"), userProductivityRouter);
  app.use("/api/admin/edr", adminAuthMiddleware, requireModule("SECURITY_MANAGER"), edrRouter);
  app.use("/api/admin/license", adminAuthMiddleware, licenseActivationRouter);
  app.use("/api/admin", adminAuthMiddleware, requireModule("ENDPOINT_MANAGER"), adminRouter);

  // SPA fallback — any GET that isn't /api/* or /health and didn't match a static asset
  // above falls through to the console's index.html so client-side routing (react-router)
  // resolves a deep link like /endpoints/:id on a hard refresh instead of 404ing.
  if (consoleDistExists) {
    app.get(/^\/(?!api\/|health$).*/, (_req, res) => {
      res.sendFile(path.join(CONSOLE_DIST_PATH, "index.html"));
    });
  }

  app.use(errorHandler);

  return app;
}
