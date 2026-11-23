import { installLogSanitizer } from "./logSanitizer";
import { ensureEnrolled } from "./enrollment";
import { startCheckinLoop } from "./checkinLoop";
import { cleanupPreviousVersion } from "./selfUpdater";

// Before anything can log: keeps the agent key and enrollment token out of agent.log.
installLogSanitizer();

async function main() {
  // Leftovers from a self-update swap; safe now that the previous process has exited. Also
  // tightens the log folder/file and app/ permissions left open by older installs.
  cleanupPreviousVersion();
  const { agentId, apiKey } = await ensureEnrolled();
  startCheckinLoop(agentId, apiKey);
}

main().catch((err) => {
  console.error("Agent failed to start", err);
  process.exit(1);
});
