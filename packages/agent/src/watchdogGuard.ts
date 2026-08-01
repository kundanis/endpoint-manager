import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WATCHDOG_TASK_NAME = "EndpointProWatchdog";

// Mirror image of watchdog.ps1's own check on the main task: this runs from inside the main
// agent process, checking the watchdog task exists and is enabled, and re-registering it if
// not. Together, disabling or deleting either task alone gets restored by the other within
// one check cycle - only removing both within the same window defeats task-based tamper
// resistance entirely.
export async function ensureWatchdogTaskRegistered(): Promise<void> {
  if (process.platform !== "win32") return;

  // installDir is __dirname/../.. from the compiled dist/ location (app/dist/../.. =
  // the install root, sibling of node/) - only meaningful for a real installed agent; in
  // local dev there is no watchdog.ps1 on disk at all, so this is a deliberate no-op guard
  // rather than trying to synthesize one.
  const installDir = path.join(__dirname, "..", "..");
  const watchdogScript = path.join(installDir, "watchdog.ps1");
  if (!fs.existsSync(watchdogScript)) return;

  try {
    let taskExists = true;
    try {
      await execFileAsync("schtasks", ["/query", "/tn", WATCHDOG_TASK_NAME]);
    } catch {
      taskExists = false;
    }

    if (!taskExists) {
      const taskXmlPath = path.join(process.env.TEMP ?? installDir, `EndpointProWatchdogTask_restore_${Date.now()}.xml`);
      const taskXml = buildWatchdogTaskXml(watchdogScript, installDir);
      // schtasks requires a BOM to correctly detect this as UTF-16LE (matching the XML's own
      // <?xml encoding="UTF-16"?> declaration) - Node's "utf16le" encoding writes raw
      // UTF-16LE bytes with no BOM, unlike PowerShell's "Unicode" encoding (which install.ps1
      // and watchdog.ps1 rely on for their own task XML writes). Without it, schtasks
      // misparses the file entirely ("ERROR: The task XML is malformed... one root element").
      fs.writeFileSync(taskXmlPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(taskXml, "utf16le")]));
      try {
        await execFileAsync("schtasks", ["/create", "/tn", WATCHDOG_TASK_NAME, "/xml", taskXmlPath, "/f"]);
      } finally {
        fs.unlinkSync(taskXmlPath);
      }
    } else {
      await execFileAsync("schtasks", ["/change", "/tn", WATCHDOG_TASK_NAME, "/enable"]).catch(() => {});
    }
  } catch (err) {
    console.error("Failed to verify/restore the watchdog task", err);
  }
}

// The watchdog task runs powershell.exe directly (not through node.exe), so it keeps
// working even if node.exe itself is what's missing/corrupted - it only needs
// powershell.exe, which is part of Windows itself.
function buildWatchdogTaskXml(watchdogScript: string, installDir: string): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT5M</Interval>
      </Repetition>
      <StartBoundary>2020-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -File "${watchdogScript}"</Arguments>
      <WorkingDirectory>${installDir}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}
