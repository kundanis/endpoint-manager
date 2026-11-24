import { startFileLog } from "./fileLog";
import { ensureEnrolled } from "./enrollment";
import { startCheckinLoop } from "./checkinLoop";
import { checkRunMode } from "./runMode";
import { prepareAgentFolders } from "./secureFs";
import { describeConnectionError, setConnectionProblem } from "./connectionProblem";
import { startStatusOnlyApi } from "./localApi";

const ENROLL_RETRY_MS = 60_000;

// Enrolls, retrying every minute while the server refuses (the licence's endpoint limit reached,
// licence not active, token rejected) or can't be reached. Meanwhile the tray app is told why the
// PC isn't connected, instead of the agent exiting and Windows restarting it over and over.
async function enrollUntilAccepted(): Promise<{ agentId: string; apiKey: string }> {
  let stopStatusApi: (() => Promise<void>) | null = null;
  for (;;) {
    try {
      const identity = await ensureEnrolled();
      setConnectionProblem(null);
      if (stopStatusApi) await stopStatusApi();
      return identity;
    } catch (err) {
      const problem = describeConnectionError(err, "enroll");
      setConnectionProblem(problem);
      console.error(`Enrollment failed - retrying in a minute. ${problem}`, err instanceof Error ? err.message : err);
      if (!stopStatusApi) stopStatusApi = startStatusOnlyApi();
      await new Promise((resolve) => setTimeout(resolve, ENROLL_RETRY_MS));
    }
  }
}

async function main() {
  startFileLog();
  console.log(`Endpoint IQ agent starting (pid ${process.pid})`);
  // Before anything writes a file: puts back folder permissions users could change (never fails).
  await prepareAgentFolders();
  if (!(await checkRunMode())) process.exit(0);
  const { agentId, apiKey } = await enrollUntilAccepted();
  startCheckinLoop(agentId, apiKey);
}

main().catch((err) => {
  console.error("Agent failed to start", err);
  process.exit(1);
});
