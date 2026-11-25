import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { UNINSTALL_GUARD_DIR_NAME, UNINSTALL_GUARD_PS, UNINSTALL_GUARD_STATE_FILES, UNINSTALL_GUARD_TASK_NAME } from "@em/shared";
import { agentConfig } from "./config";
import { getServerUrl } from "./httpClient";
import { ENDPOINTPRO_DIR, ensureSecureDir, isPackagedInstall, writeWorkFile } from "./secureFs";
import { loadState } from "./state";

const execFileAsync = promisify(execFile);

// Keeps the uninstall guard ready (see packages/shared/src/agentRelease.ts): guard.ps1 in
// ProgramData\EndpointPro\UninstallGuard (SYSTEM and administrators only), this endpoint's identity
// so the guard can tell the server once the agent is gone, copies of the state files the release
// reads, and the scheduled task that runs it. If the agent's files are deleted by hand, the guard
// still takes back the policies and frees the licence. Checked with the watchdog, every 5 minutes.

const GUARD_DIR = path.join(ENDPOINTPRO_DIR, UNINSTALL_GUARD_DIR_NAME);

function writeIfChanged(file: string, content: string | Buffer): void {
  try {
    const now = fs.readFileSync(file);
    if (now.equals(Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"))) return;
  } catch {
    // not there yet
  }
  fs.writeFileSync(file, content, { mode: 0o600 });
}

export async function ensureUninstallGuard(): Promise<void> {
  if (!isPackagedInstall()) return;
  const identity = loadState();
  if (!identity) return;
  try {
    await ensureSecureDir(GUARD_DIR, { resetChildren: true });
    writeIfChanged(path.join(GUARD_DIR, "guard.ps1"), UNINSTALL_GUARD_PS);
    const serverUrls = [...new Set([getServerUrl(), ...agentConfig.serverUrls])];
    writeIfChanged(path.join(GUARD_DIR, "current.json"), JSON.stringify({ agentId: identity.agentId, apiKey: identity.apiKey, serverUrls }));
    if (agentConfig.serverCaPem) writeIfChanged(path.join(GUARD_DIR, "server-ca.pem"), agentConfig.serverCaPem);

    const stateCopy = path.join(GUARD_DIR, "state");
    fs.mkdirSync(stateCopy, { recursive: true });
    for (const name of UNINSTALL_GUARD_STATE_FILES) {
      const target = path.join(stateCopy, name);
      try {
        writeIfChanged(target, fs.readFileSync(path.join(agentConfig.stateDir, name)));
      } catch {
        fs.rmSync(target, { force: true }); // nothing of that kind in place now
      }
    }

    let taskExists = true;
    try {
      await execFileAsync("schtasks", ["/query", "/tn", UNINSTALL_GUARD_TASK_NAME]);
    } catch {
      taskExists = false;
    }
    if (!taskExists) {
      // Same task as the guard registers for itself (Register-GuardTask in agentRelease.ts).
      const xmlPath = await writeWorkFile("UninstallGuardTask", ".xml", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(guardTaskXml(path.join(GUARD_DIR, "guard.ps1")), "utf16le")]));
      try {
        await execFileAsync("schtasks", ["/create", "/tn", UNINSTALL_GUARD_TASK_NAME, "/xml", xmlPath, "/f"]);
      } finally {
        fs.rmSync(xmlPath, { force: true });
      }
    } else {
      await execFileAsync("schtasks", ["/change", "/tn", UNINSTALL_GUARD_TASK_NAME, "/enable"]).catch(() => undefined);
    }
  } catch (err) {
    console.error("Couldn't set up the uninstall guard", err instanceof Error ? err.message : err);
  }
}

function guardTaskXml(script: string): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger><Repetition><Interval>PT30M</Interval></Repetition><StartBoundary>2020-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger>
    <BootTrigger><Delay>PT2M</Delay><Enabled>true</Enabled></BootTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${script}"</Arguments></Exec></Actions>
</Task>
`;
}
