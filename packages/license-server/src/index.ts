import fs from "node:fs";
import https from "node:https";
import { createApp } from "./app";
import { config } from "./config";
import { logger } from "./logger";

const app = createApp();

if (config.tlsPfxPath && config.tlsPfxPassphrase) {
  const pfx = fs.readFileSync(config.tlsPfxPath);
  https.createServer({ pfx, passphrase: config.tlsPfxPassphrase }, app).listen(config.port, () => {
    logger.info(`License Server listening on https://localhost:${config.port}`);
  });
} else {
  app.listen(config.port, () => {
    logger.info(`License Server listening on http://localhost:${config.port}`);
  });
}
