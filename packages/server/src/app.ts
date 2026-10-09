import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { logger } from "./logger";
import { authRouter } from "./routes/auth.routes";
import { agentEnrollRouter } from "./routes/agentEnroll.routes";
import { emailAddinRouter } from "./routes/emailAddin.routes";
import { renderEmailAddinManifest } from "./emailAddinManifest";
import { renderEmailAddinScript } from "./emailAddinScript";
import { agentRouter } from "./routes/agent.routes";
import { adminRouter } from "./routes/admin.routes";
import { commandsRouter } from "./routes/commands.routes";
import { commandTemplatesRouter } from "./routes/commandTemplates.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
import { packagesRouter } from "./routes/packages.routes";
import { deploymentsRouter } from "./routes/deployments.routes";
import { agentUpdatesRouter } from "./routes/agentUpdates.routes";
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
import { piiBlockRouter } from "./routes/piiBlock.routes";
import { piiEmailBlockRouter } from "./routes/piiEmailBlock.routes";
import { commandBlockRouter } from "./routes/commandBlock.routes";
import { ipBlockRouter } from "./routes/ipBlock.routes";
import { usbControlRouter } from "./routes/usbControl.routes";
import { policyAccessExceptionRouter } from "./routes/policyAccessException.routes";
import { agentSecurityRouter } from "./routes/agentSecurity.routes";
import { userProductivityRouter } from "./routes/userProductivity.routes";
import { edrRouter } from "./routes/edr.routes";
import { licenseActivationRouter } from "./routes/licenseActivation.routes";
import { adminUsersRouter } from "./routes/adminUsers.routes";
import { moduleVisibilityRouter } from "./routes/moduleVisibility.routes";
import { agentAuthMiddleware } from "./middleware/agentAuth";
import { adminAuthMiddleware } from "./middleware/adminAuth";
import { requireModule } from "./middleware/requireModule";
import { requireModuleAccess, requireModuleVisible, requireSuperAdmin } from "./middleware/requireAdminRole";
import { errorHandler } from "./middleware/errorHandler";
import { publicAccessAllowlist } from "./middleware/publicAccessAllowlist";

// Set by the packaged deployment (packages/server/scripts/package-server.ps1 copies the
// built console's dist/ to this exact path alongside the compiled server). Absent in the
// dev workflow, where the console is served by its own Vite dev server instead — checked
// at startup, not per-request, so a missing folder costs nothing on every request.
const CONSOLE_DIST_PATH = path.resolve(__dirname, "..", "console-dist");
const consoleDistExists = fs.existsSync(path.join(CONSOLE_DIST_PATH, "index.html"));

export function createApp() {
  const app = express();

  app.use(pinoHttp({ logger }));
  // Internet-facing (NAT on 443): public addresses only reach the Outlook add-in paths.
  app.use(publicAccessAllowlist);
  // The console is served from this same origin (and in dev, Vite proxies /api), so the
  // admin API needs no cross-origin access at all — it used to reflect ANY origin with
  // credentials, letting any other *.systematixgroup.in site act as a logged-in admin's
  // browser. Only the Outlook add-in endpoints stay open cross-origin, credential-less
  // (classic Outlook's JavaScript runtime calls them without a page origin of its own).
  app.use(
    cors((req, callback) => {
      const isAddinApi = (req.url ?? "").startsWith("/api/email-addin/");
      callback(null, isAddinApi ? { origin: "*", credentials: false } : { origin: false });
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "5mb" }));

  if (consoleDistExists) {
    app.use(express.static(CONSOLE_DIST_PATH));
  }

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Outlook add-in hosting — public, unauthenticated, reachable from any Outlook client
  // (desktop/web/mobile) across the internet, not just this deployment's admins/agents.
  // The manifest and commands.js routes are registered before the static mount below so
  // they win for those exact paths; everything else under /outlook-addin/ (commands.html,
  // icons) is served as-is from packages/server/public/outlook-addin/.
  app.get("/outlook-addin/manifest.xml", (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.type("application/xml").send(renderEmailAddinManifest(baseUrl));
  });
  app.get("/outlook-addin/commands.js", (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.type("application/javascript").send(renderEmailAddinScript(baseUrl));
  });
  app.use("/outlook-addin", express.static(path.resolve(__dirname, "..", "public", "outlook-addin")));

  app.use("/api/auth", authRouter);

  // Enrollment is the one agent-facing endpoint mounted before agentAuthMiddleware —
  // a not-yet-enrolled agent has no API key to authenticate with.
  app.use("/api/agent/enroll", agentEnrollRouter);
  // Outlook add-in only — never behind agentAuthMiddleware/adminAuthMiddleware, see
  // emailAddin.routes.ts for why (the add-in's sandboxed runtime can't hold either kind of
  // credential this app otherwise requires).
  app.use("/api/email-addin", emailAddinRouter);
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
  app.use("/api/admin/commands", adminAuthMiddleware, requireModuleVisible("ENDPOINT_MANAGER"), requireModule("ENDPOINT_MANAGER"), requireModuleAccess("ENDPOINT_MANAGER"), commandsRouter);
  app.use("/api/admin/command-templates", adminAuthMiddleware, requireModuleVisible("ENDPOINT_MANAGER"), requireModule("ENDPOINT_MANAGER"), requireModuleAccess("ENDPOINT_MANAGER"), commandTemplatesRouter);
  app.use("/api/admin/packages", adminAuthMiddleware, requireModuleVisible("ENDPOINT_MANAGER"), requireModule("ENDPOINT_MANAGER"), requireModuleAccess("ENDPOINT_MANAGER"), packagesRouter);
  app.use("/api/admin/deployments", adminAuthMiddleware, requireModuleVisible("ENDPOINT_MANAGER"), requireModule("ENDPOINT_MANAGER"), requireModuleAccess("ENDPOINT_MANAGER"), deploymentsRouter);
  app.use("/api/admin/agent-updates", adminAuthMiddleware, requireModuleVisible("ENDPOINT_MANAGER"), requireModule("ENDPOINT_MANAGER"), requireModuleAccess("ENDPOINT_MANAGER"), agentUpdatesRouter);
  app.use("/api/admin/patches", adminAuthMiddleware, requireModuleVisible("SECURITY_MANAGER"), requireModule("SECURITY_MANAGER"), requireModuleAccess("SECURITY_MANAGER"), patchesRouter);
  app.use("/api/admin/vulnerabilities", adminAuthMiddleware, requireModuleVisible("SECURITY_MANAGER"), requireModule("SECURITY_MANAGER"), requireModuleAccess("SECURITY_MANAGER"), vulnerabilitiesRouter);
  app.use("/api/admin/asset-groups", adminAuthMiddleware, requireModuleVisible("ENDPOINT_MANAGER"), requireModule("ENDPOINT_MANAGER"), requireModuleAccess("ENDPOINT_MANAGER"), assetGroupsRouter);
  app.use("/api/admin/custom-fields", adminAuthMiddleware, requireModuleVisible("ENDPOINT_MANAGER"), requireModule("ENDPOINT_MANAGER"), requireModuleAccess("ENDPOINT_MANAGER"), customFieldsRouter);
  app.use("/api/admin/software-licenses", adminAuthMiddleware, requireModuleVisible("SOFTWARE_MANAGER"), requireModule("SOFTWARE_MANAGER"), requireModuleAccess("SOFTWARE_MANAGER"), softwareLicensesRouter);
  app.use("/api/admin/network-scans", adminAuthMiddleware, requireModuleVisible("NETWORK_MANAGER"), requireModule("NETWORK_MANAGER"), requireModuleAccess("NETWORK_MANAGER"), networkScanRouter);
  app.use("/api/admin/network-vlans", adminAuthMiddleware, requireModuleVisible("NETWORK_MANAGER"), requireModule("NETWORK_MANAGER"), requireModuleAccess("NETWORK_MANAGER"), networkVlanRouter);
  app.use("/api/admin/security-config", adminAuthMiddleware, requireModuleVisible("SECURITY_MANAGER"), requireModule("SECURITY_MANAGER"), requireModuleAccess("SECURITY_MANAGER"), securityConfigRouter);
  app.use("/api/admin/zero-trust", adminAuthMiddleware, requireModuleVisible("SECURITY_MANAGER"), requireModule("SECURITY_MANAGER"), requireModuleAccess("SECURITY_MANAGER"), zeroTrustRouter);
  app.use("/api/admin/data-discovery", adminAuthMiddleware, requireModuleVisible("DATA_MANAGER"), requireModule("DATA_MANAGER"), requireModuleAccess("DATA_MANAGER"), dataDiscoveryRouter);
  app.use("/api/admin/dlp", adminAuthMiddleware, requireModuleVisible("DATA_MANAGER"), requireModule("DATA_MANAGER"), requireModuleAccess("DATA_MANAGER"), dlpRouter);
  app.use("/api/admin/data-movement", adminAuthMiddleware, requireModuleVisible("DATA_MANAGER"), requireModule("DATA_MANAGER"), requireModuleAccess("DATA_MANAGER"), dataMovementRouter);
  app.use("/api/admin/app-control", adminAuthMiddleware, requireModuleVisible("DATA_MANAGER"), requireModule("DATA_MANAGER"), requireModuleAccess("DATA_MANAGER"), appControlRouter);
  app.use("/api/admin/web-block", adminAuthMiddleware, requireModuleVisible("DATA_MANAGER"), requireModule("DATA_MANAGER"), requireModuleAccess("DATA_MANAGER"), webBlockRouter);
  app.use("/api/admin/pii-block", adminAuthMiddleware, requireModuleVisible("DATA_MANAGER"), requireModule("DATA_MANAGER"), requireModuleAccess("DATA_MANAGER"), piiBlockRouter);
  app.use("/api/admin/pii-email-block", adminAuthMiddleware, requireModuleVisible("DATA_MANAGER"), requireModule("DATA_MANAGER"), requireModuleAccess("DATA_MANAGER"), piiEmailBlockRouter);
  app.use("/api/admin/command-block", adminAuthMiddleware, requireModuleVisible("DATA_MANAGER"), requireModule("DATA_MANAGER"), requireModuleAccess("DATA_MANAGER"), commandBlockRouter);
  app.use("/api/admin/ip-block", adminAuthMiddleware, requireModuleVisible("DATA_MANAGER"), requireModule("DATA_MANAGER"), requireModuleAccess("DATA_MANAGER"), ipBlockRouter);
  app.use("/api/admin/usb-control", adminAuthMiddleware, requireModuleVisible("DATA_MANAGER"), requireModule("DATA_MANAGER"), requireModuleAccess("DATA_MANAGER"), usbControlRouter);
  app.use("/api/admin/policy-exceptions", adminAuthMiddleware, requireModuleVisible("DATA_MANAGER"), requireModule("DATA_MANAGER"), requireModuleAccess("DATA_MANAGER"), policyAccessExceptionRouter);
  app.use("/api/admin/agent-security", adminAuthMiddleware, requireModuleVisible("ENDPOINT_MANAGER"), requireModule("ENDPOINT_MANAGER"), requireModuleAccess("ENDPOINT_MANAGER"), agentSecurityRouter);
  app.use("/api/admin/user-productivity", adminAuthMiddleware, requireModuleVisible("USER_MANAGER"), requireModule("USER_MANAGER"), requireModuleAccess("USER_MANAGER"), userProductivityRouter);
  app.use("/api/admin/edr", adminAuthMiddleware, requireModuleVisible("SECURITY_MANAGER"), requireModule("SECURITY_MANAGER"), requireModuleAccess("SECURITY_MANAGER"), edrRouter);
  app.use("/api/admin/license", adminAuthMiddleware, licenseActivationRouter);
  // Readable by any admin (nav filtering needs it regardless of role); the PUT inside this
  // router gates itself with requireSuperAdmin - see moduleVisibility.routes.ts.
  app.use("/api/admin/module-visibility", adminAuthMiddleware, moduleVisibilityRouter);
  // Admin-user management is a role gate (requireSuperAdmin), not a module grant - a plain
  // ADMIN can never be given access to this regardless of their other module grants.
  app.use("/api/admin/admin-users", adminAuthMiddleware, requireSuperAdmin, adminUsersRouter);
  app.use("/api/admin", adminAuthMiddleware, requireModuleVisible("ENDPOINT_MANAGER"), requireModule("ENDPOINT_MANAGER"), requireModuleAccess("ENDPOINT_MANAGER"), adminRouter);

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
