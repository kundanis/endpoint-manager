import { startFileLog } from "./fileLog";
import { ensureEnrolled } from "./enrollment";
import { startCheckinLoop } from "./checkinLoop";
import { checkRunMode } from "./runMode";

async function main() {
  startFileLog();
  console.log(`Endpoint IQ agent starting (pid ${process.pid})`);
  if (!(await checkRunMode())) process.exit(0);
  const { agentId, apiKey } = await ensureEnrolled();
  startCheckinLoop(agentId, apiKey);
}

main().catch((err) => {
  console.error("Agent failed to start", err);
  process.exit(1);
});
