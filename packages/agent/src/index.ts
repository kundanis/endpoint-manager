import { startFileLog } from "./fileLog";
import { ensureEnrolled } from "./enrollment";
import { startCheckinLoop } from "./checkinLoop";
import { checkRunMode } from "./runMode";
import { prepareAgentFolders } from "./secureFs";

async function main() {
  startFileLog();
  console.log(`Endpoint IQ agent starting (pid ${process.pid})`);
  // Before anything writes a file: puts back folder permissions users could change (never fails).
  await prepareAgentFolders();
  if (!(await checkRunMode())) process.exit(0);
  const { agentId, apiKey } = await ensureEnrolled();
  startCheckinLoop(agentId, apiKey);
}

main().catch((err) => {
  console.error("Agent failed to start", err);
  process.exit(1);
});
