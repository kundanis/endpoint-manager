import { installLogSanitizer } from "./logSanitizer";
import { ensureEnrolled } from "./enrollment";
import { startCheckinLoop } from "./checkinLoop";
import { hardenInstallDir } from "./installHardening";

// Before anything can log: keeps the agent key and enrollment token out of journald.
installLogSanitizer();

async function main() {
  await hardenInstallDir();
  const { agentId, apiKey } = await ensureEnrolled();
  startCheckinLoop(agentId, apiKey);
}

main().catch((err) => {
  console.error("Agent failed to start", err);
  process.exit(1);
});
