import { startFileLog } from "./fileLog";
import { ensureEnrolled } from "./enrollment";
import { startCheckinLoop } from "./checkinLoop";

async function main() {
  startFileLog();
  console.log(`Endpoint One agent starting (pid ${process.pid})`);
  const { agentId, apiKey } = await ensureEnrolled();
  startCheckinLoop(agentId, apiKey);
}

main().catch((err) => {
  console.error("Agent failed to start", err);
  process.exit(1);
});
