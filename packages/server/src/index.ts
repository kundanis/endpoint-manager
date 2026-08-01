import fs from "node:fs";
import https from "node:https";
import { createApp } from "./app";
import { config } from "./config";
import { logger } from "./logger";
import { getStatus, revalidate } from "./services/licenseActivation.service";

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
  https.createServer({ pfx, passphrase: config.tlsPfxPassphrase }, app).listen(config.port, () => {
    logger.info(`Server listening on https://localhost:${config.port}`);
  });
} else {
  app.listen(config.port, () => {
    logger.info(`Server listening on http://localhost:${config.port}`);
  });
}

scheduleLicenseRevalidation();

// Re-validates roughly once a day against the License Server, not on a fixed wall-clock
// time — scheduled off lastRevalidatedAt so a fleet of separate customer installs doesn't
// all hammer the License Server at once. A per-process random jitter (rolled once at
// startup, not re-rolled every tick) spreads that further without making the interval
// drift across restarts within the same day. Checking hourly rather than scheduling one
// precise timer is deliberate: it's simple, survives process restarts with no saved timer
// state, and being an hour late to revalidate is inconsequential.
function scheduleLicenseRevalidation() {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000;
  const REVALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const JITTER_MS = 2 * 60 * 60 * 1000;
  const jitterMs = Math.floor(Math.random() * JITTER_MS);

  async function tick() {
    try {
      const status = await getStatus();
      if (!status.activated || !status.activatedAt) return;

      const lastKnownGoodAt = status.lastRevalidatedAt ?? status.activatedAt;
      const dueAt = lastKnownGoodAt.getTime() + REVALIDATION_INTERVAL_MS + jitterMs;
      if (Date.now() >= dueAt) {
        logger.info("Revalidating license with License Server");
        await revalidate();
      }
    } catch (err) {
      logger.error({ err }, "License revalidation tick failed");
    }
  }

  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
}
