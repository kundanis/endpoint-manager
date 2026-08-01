import { ensureEnrolled } from "./enrollment";
import { startCheckinLoop } from "./checkinLoop";

async function main() {
  const { agentId, apiKey } = await ensureEnrolled();
  startCheckinLoop(agentId, apiKey);
}

main().catch((err) => {
  console.error("Agent failed to start", err);
  process.exit(1);
});
