import { ensureEnrolled } from "./enrollment";
import { startCheckinLoop } from "./checkinLoop";
import { cleanupPreviousVersion } from "./selfUpdater";

async function main() {
  // Leftovers from a self-update swap; safe now that the previous process has exited.
  cleanupPreviousVersion();
  const { agentId, apiKey } = await ensureEnrolled();
  startCheckinLoop(agentId, apiKey);
}

main().catch((err) => {
  console.error("Agent failed to start", err);
  process.exit(1);
});
