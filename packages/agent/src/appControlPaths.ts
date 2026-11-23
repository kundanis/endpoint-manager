import fs from "node:fs";
import path from "node:path";
import { agentConfig } from "./config";

// Shared by the Application control enforcer and the desktop safety net.

// The launch blocker script (run as the user who started a blocked program, so users can read
// it): app\blocker in the locked install folder, which only SYSTEM and administrators can
// change. It reports what it stopped to the agent's local API (localApi.ts), not to a folder.
export const BLOCKER_DIR = path.join(__dirname, "..", "blocker");
export const BLOCKER_SCRIPT = path.join(BLOCKER_DIR, "blocked.ps1");

// The rules the process watcher enforces; "[]" stops it closing anything.
export const watcherRulesFile = () => path.join(agentConfig.stateDir, "app-control-rules.json");
// The Command blocking patterns the same watcher enforces (written by commandBlockEnforcer.ts).
export const commandRulesFile = () => path.join(agentConfig.stateDir, "command-block-rules.json");

// What advanced application control last put into AppLocker (appLockerEnforcer.ts); absent while
// the agent has no AppLocker rules in place.
export const appLockerStateFile = () => path.join(agentConfig.stateDir, "applocker-state.json");

export function appLockerRulesActive(): boolean {
  try {
    return ((JSON.parse(fs.readFileSync(appLockerStateFile(), "utf8")) as { ruleCount?: number }).ruleCount ?? 0) > 0;
  } catch {
    return false;
  }
}

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

// Every AppLocker rule this agent adds (advanced application control) carries this description;
// anything else in the device's AppLocker policy belongs to someone else and is never touched.
export const APPLOCKER_MARKER = "Endpoint IQ managed";

// PowerShell that removes this agent's AppLocker rules, and turns a rule collection back off when
// nothing else is left in it.
export const REMOVE_APPLOCKER_RULES_PS = `
try {
  $alx = [xml](Get-AppLockerPolicy -Local -Xml)
  $alChanged = $false
  foreach ($c in @($alx.AppLockerPolicy.RuleCollection)) {
    if (-not $c) { continue }
    $ours = @($c.ChildNodes | Where-Object { $_.Description -eq '${APPLOCKER_MARKER}' })
    foreach ($r in $ours) { [void]$c.RemoveChild($r); $alChanged = $true }
    if ($ours.Count -gt 0 -and @($c.ChildNodes | Where-Object { $_.LocalName -like '*Rule' }).Count -eq 0) { $c.SetAttribute('EnforcementMode', 'NotConfigured') }
  }
  if ($alChanged) {
    $alFile = Join-Path $env:TEMP ('eiq-applocker-' + [guid]::NewGuid().ToString('N') + '.xml')
    $alx.Save($alFile)
    Set-AppLockerPolicy -XmlPolicy $alFile
    Remove-Item -LiteralPath $alFile -Force
  }
} catch {}
`;

// PowerShell that removes every launch block this agent wrote (and the Software Restriction
// Policy rules agents before 0.2.18 wrote), and its AppLocker rules.
export const REMOVE_ALL_BLOCKS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
${REMOVE_APPLOCKER_RULES_PS}
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
