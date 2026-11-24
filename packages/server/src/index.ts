import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { createApp } from "./app";
import { config } from "./config";
import { logger } from "./logger";
import { plainHttpListener } from "./middleware/plainHttpListener";
import { registerCallback } from "./services/licenseActivation.service";
import { promoteScheduledPatchTasks } from "./services/patch.service";
import { runAutoPatchPolicies } from "./services/autoPatchPolicy.service";
import { reconcileStaleAgentUpdateTasks } from "./services/agentUpdate.service";
import { removeRemotelyUninstalledAgents } from "./services/agent.service";
import { failInterruptedSyncRuns } from "./services/vulnerability.service";
import { startFleetCache } from "./cache/fleetCache";
import { schedulePostureSnapshots } from "./services/posture.service";
import { startPresenceFlush } from "./presence/presence";
import { scheduleUserRisk } from "./services/userRisk/userRisk.service";
import { scheduleAuditRetention } from "./services/adminAudit.service";
import { scheduleScreenCaptureImageRetention } from "./services/screenCaptureImage.service";
import { scheduleLicenseReductionAutoApply } from "./services/licenseChange.service";
import { scheduleAiGuardAlerts } from "./services/aiGuardAlerts.service";

// Last-resort safety net: without this, an unhandled rejection anywhere the request/response
// try/catch chain doesn't reach (e.g. a future bug shaped like the one just fixed in
// agentAuthMiddleware/requireModule) crashes the process with whatever Node's default
// unhandled-rejection output is, which may not even be captured when launched via the
// Scheduled Task/Start-Server.bat. Logging through the app's own logger first, then exiting,
// guarantees a diagnosable line lands wherever this app's logs actually go, and hands off to
// the Scheduled Task's own RestartOnFailure to bring it back up immediately.
process.on("unhandledRejection", (err) => {
  logger.error({ err }, "Unhandled promise rejection - exiting for restart");
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception - exiting for restart");
  process.exit(1);
});

const app = createApp();

if (config.tlsPfxPath && config.tlsPfxPassphrase) {
  const pfx = fs.readFileSync(config.tlsPfxPath);
  const ca = config.tlsCaChainPath ? fs.readFileSync(config.tlsCaChainPath) : undefined;
  const httpsPort = config.tlsPort ?? config.port;
  https.createServer({ pfx, passphrase: config.tlsPfxPassphrase, ca }, app).listen(httpsPort, () => {
    logger.info(`Server listening on https://localhost:${httpsPort}`);
  });
  if (config.tlsPort && config.tlsPort !== config.port) {
    // Agents only on plain HTTP: browser requests are redirected to HTTPS (see
    // plainHttpListener.ts), so the console, login and admin API are never served unencrypted.
    const redirectPort = config.httpsPublicPort ?? config.tlsPort;
    http.createServer(plainHttpListener(app, redirectPort)).listen(config.port, () => {
      logger.info(`Server also listening on http://localhost:${config.port} (agents only; browsers are sent to HTTPS port ${redirectPort})`);
    });
  }
} else {
  app.listen(config.port, () => {
    logger.info(`Server listening on http://localhost:${config.port}`);
  });
}

failInterruptedSyncRuns()
  .then((count) => {
    if (count > 0) logger.warn({ count }, "Marked vulnerability sync run(s) interrupted by the previous shutdown as FAILED");
  })
  .catch((err) => logger.error({ err }, "Failed to reconcile interrupted vulnerability sync runs"));

scheduleLicenseCallbackRegistration();
scheduleLicenseReductionAutoApply();
scheduleAiGuardAlerts();
schedulePatchAutomation();
scheduleStaleAgentUpdateReconciliation();
scheduleUninstalledAgentCleanup();
scheduleUserRisk();
scheduleAuditRetention();
scheduleScreenCaptureImageRetention();
startFleetCache();
startPresenceFlush();
schedulePostureSnapshots();

// Once activated, the license is never re-checked against the License Server - it stays
// valid offline, and a revoke arrives as a notice pushed to this server instead. This loop
// only keeps the License Server told where to send that notice: registerCallback is a
// no-op once registered, and runs again if registration failed or the server's addresses
// (Agent connection settings) changed. Hourly is plenty for that.
function scheduleLicenseCallbackRegistration() {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000;

  async function tick() {
    try {
      await registerCallback();
    } catch (err) {
      logger.error({ err }, "License callback registration tick failed");
    }
  }

  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
}

// Promotes due SCHEDULED patch tasks to PENDING and runs "Automatic Mode" policies. A
// 2-minute cadence is deliberate: frequent enough that a scheduled deployment or a newly
// qualifying auto-policy patch feels responsive, infrequent enough not to matter for load -
// same "polling beats precise timers" reasoning as the other schedulers here.
function schedulePatchAutomation() {
  const INTERVAL_MS = 2 * 60 * 1000;

  async function tick() {
    try {
      const promoted = await promoteScheduledPatchTasks();
      if (promoted > 0) logger.info({ promoted }, "Promoted scheduled patch tasks to pending");
      await runAutoPatchPolicies();
    } catch (err) {
      logger.error({ err }, "Patch automation tick failed");
    }
  }

  tick();
  setInterval(tick, INTERVAL_MS);
}

// Endpoints remotely uninstalled whose "uninstalled" confirmation was lost - see
// removeRemotelyUninstalledAgents. Every 10 minutes.
function scheduleUninstalledAgentCleanup() {
  async function tick() {
    try {
      await removeRemotelyUninstalledAgents();
    } catch (err) {
      logger.error({ err }, "Uninstalled endpoint clean-up failed");
    }
  }
  tick();
  setInterval(tick, 10 * 60 * 1000);
}

// See reconcileStaleAgentUpdateTasks's own comment for why this exists at all. A 5-minute
// cadence against a 15-minute staleness threshold means a stuck task is caught within
// 15-20 minutes of going quiet, not immediately — fine here, since the failure mode this
// guards against is "silently stuck forever", not "slightly slow".
function scheduleStaleAgentUpdateReconciliation() {
  const INTERVAL_MS = 5 * 60 * 1000;

  async function tick() {
    try {
      const count = await reconcileStaleAgentUpdateTasks();
      if (count > 0) logger.warn({ count }, "Marked stale agent update task(s) as FAILED after timing out");
    } catch (err) {
      logger.error({ err }, "Stale agent update reconciliation tick failed");
    }
  }

  tick();
  setInterval(tick, INTERVAL_MS);
}
