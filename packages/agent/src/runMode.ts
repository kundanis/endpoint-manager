import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { registerOneTimeTask } from "./selfUpdater";

const execFileAsync = promisify(execFile);

const SERVICE_NAME = "EndpointIQAgent";
const MIGRATION_TASK_NAME = "EndpointIQServiceSetup";

// From 0.2.23 the Windows agent runs under the "EndpointIQAgent" service, which sets
// EIQ_RUN_MODE=service. Agents before that ran as the scheduled task "EndpointProAgent", and an
// endpoint updated from one of those first starts this version under that old task. Returns
// false when this process should exit straight away:
//  - the service is installed, so it is the one that runs the agent (never two at once);
//  - otherwise register-service.ps1 is run once, from a separate one-time task (it stops the
//    old task, and with it this process, then starts the service). The watchdog does the same
//    within 5 minutes, so this only makes the move quicker. Not while Windows is known to block
//    the service program (service-blocked.txt from the last day): the agent then stays on the
//    task, and the watchdog retries the service the next day.
export async function checkRunMode(): Promise<boolean> {
  if (process.platform !== "win32" || process.env.EIQ_RUN_MODE === "service") return true;

  // Only a packaged install has the service files; local dev (tsx) runs as it is.
  const installDir = path.join(__dirname, "..", "..");
  const registerScript = path.join(installDir, "register-service.ps1");
  if (!fs.existsSync(path.join(installDir, "node", "node.exe")) || !fs.existsSync(registerScript)) return true;

  try {
    await execFileAsync("sc.exe", ["query", SERVICE_NAME]);
    console.log("The Endpoint IQ Agent service is installed and runs the agent - exiting this copy.");
    return false;
  } catch {
    // not installed yet
  }

  try {
    const blocked = fs.statSync(path.join(installDir, "app", ".state", "service-blocked.txt"));
    if (Date.now() - blocked.mtimeMs < 24 * 60 * 60_000) {
      console.log("Running as a scheduled task: Windows blocked the agent service program (see service-blocked.txt).");
      return true;
    }
  } catch {
    // no marker
  }

  try {
    const helper = path.join(process.env.TEMP ?? installDir, `${MIGRATION_TASK_NAME}.ps1`);
    fs.writeFileSync(
      helper,
      [
        `& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${registerScript}"`,
        `schtasks /delete /tn "${MIGRATION_TASK_NAME}" /f 2>$null | Out-Null`,
        `Remove-Item -Path "$PSCommandPath" -Force -ErrorAction SilentlyContinue`,
      ].join("\r\n"),
      "ascii",
    );
    await registerOneTimeTask(MIGRATION_TASK_NAME, helper, 15_000);
    console.log("Moving the agent to the Endpoint IQ Agent service in about 15 seconds.");
  } catch (err) {
    console.error("Couldn't schedule the move to the agent service (the watchdog will do it)", err);
  }
  return true;
}
