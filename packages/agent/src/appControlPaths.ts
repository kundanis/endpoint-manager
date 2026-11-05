import fs from "node:fs";
import path from "node:path";
import { agentConfig } from "./config";

// Shared by the Application control enforcer and the desktop safety net.

// Folder that ordinary users can read (the launch blocker script) and write to (its events).
export const APP_CONTROL_DIR = path.join(process.env.ProgramData ?? "C:\\ProgramData", "EndpointPro", "AppControl");
export const BLOCKER_SCRIPT = path.join(APP_CONTROL_DIR, "blocked.ps1");
export const BLOCKER_EVENTS_DIR = path.join(APP_CONTROL_DIR, "events");

// The rules the process watcher enforces; "[]" stops it closing anything.
export const watcherRulesFile = () => path.join(agentConfig.stateDir, "app-control-rules.json");
// The Command blocking patterns the same watcher enforces (written by commandBlockEnforcer.ts).
export const commandRulesFile = () => path.join(agentConfig.stateDir, "command-block-rules.json");

export function appControlRulesActive(): boolean {
  try {
    return (JSON.parse(fs.readFileSync(watcherRulesFile(), "utf8")) as unknown[]).length > 0;
  } catch {
    return false;
  }
}

// Image File Execution Options: a "Debugger" value on a program's file name makes Windows start
// that command instead of the program. Each value this agent writes is tagged with IFEO_MARKER
// (holding the rule id), so only its own entries are ever changed or removed.
export const IFEO_ROOTS = [
  "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options",
  "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options",
];
export const IFEO_MARKER = "EndpointIQManaged";

// PowerShell that removes every launch block this agent wrote (and the Software Restriction
// Policy rules agents before 0.2.18 wrote).
export const REMOVE_ALL_BLOCKS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
Get-ChildItem -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Safer\\CodeIdentifiers\\0\\Paths' |
  Where-Object { (Get-ItemProperty -Path $_.PSPath -Name Description).Description -like 'EM-managed:*' } |
  ForEach-Object { Remove-Item -Path $_.PSPath -Recurse -Force }
foreach ($root in @(${IFEO_ROOTS.map((r) => `'${r}'`).join(", ")})) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  foreach ($key in @(Get-ChildItem -LiteralPath $root)) {
    $props = Get-ItemProperty -LiteralPath $key.PSPath
    if ($props.${IFEO_MARKER}) {
      Remove-ItemProperty -LiteralPath $key.PSPath -Name Debugger, ${IFEO_MARKER} -Force
      $k = Get-Item -LiteralPath $key.PSPath
      if ($k.ValueCount -eq 0 -and $k.SubKeyCount -eq 0) { Remove-Item -LiteralPath $key.PSPath -Force }
    }
  }
}
`;
