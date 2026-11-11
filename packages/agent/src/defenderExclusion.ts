import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { agentConfig } from "./config";

const execFileAsync = promisify(execFile);

// Microsoft Defender's machine-learning detections ("...!ml") can flag the agent's own data
// files - e.g. app-control-rules.json, a list of the remote-access and hacking tools an admin
// chose to block - as a trojan and quarantine them, which silently stops enforcement until the
// next sync rewrites the file (and Defender flags it again). The agent therefore excludes its
// .state folder (data files only, never its programs) from Defender scanning. The folder sits
// in the install directory, which only SYSTEM and administrators can write to.
//
// Only for a real install (the folder lives under the install dir); a failure (Defender off,
// another antivirus, exclusions locked by Intune/Group Policy) is logged and retried an hour later.
// Checked again every 6 hours, so an exclusion someone removed comes back. uninstall.ps1
// removes it.
const RECHECK_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
let nextCheck = 0;

export async function ensureDefenderExclusion(): Promise<void> {
  if (process.platform !== "win32" || Date.now() < nextCheck) return;
  const installDir = path.join(__dirname, "..", "..");
  if (!fs.existsSync(path.join(installDir, "watchdog.ps1"))) return; // local dev: not installed

  const dir = path.resolve(agentConfig.stateDir);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$dir = $env:EIQ_EXCLUDE_DIR",
    "$p = Get-MpPreference",
    "if ($p.ExclusionPath -and ($p.ExclusionPath -contains $dir)) { 'present'; exit 0 }",
    "Add-MpPreference -ExclusionPath $dir",
    "'added'",
  ].join("; ");
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      env: { ...process.env, EIQ_EXCLUDE_DIR: dir },
      timeout: 60_000,
      windowsHide: true,
    });
    if (stdout.trim() === "added") console.log(`Defender: excluded the agent's data folder ${dir} from scanning`);
    nextCheck = Date.now() + RECHECK_MS;
  } catch (err) {
    nextCheck = Date.now() + RETRY_MS;
    console.warn(`Defender: couldn't exclude ${dir} (Defender off, another antivirus, or exclusions managed centrally)`, (err as Error).message);
  }
}
