import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AppControlRuleWire } from "@em/shared";
import { APPLOCKER_MSI_EXTENSIONS, APPLOCKER_SCRIPT_EXTENSIONS, appControlRuleProblem } from "@em/shared";
import { APPLOCKER_MARKER, appLockerStateFile, REMOVE_APPLOCKER_RULES_PS } from "./appControlPaths";
import type { RawEvent } from "./appControlEnforcer";

const execFileAsync = promisify(execFile);

// Advanced application control: Windows AppLocker, for what the process watcher can't see -
// DLLs loaded into a program, and scripts (.ps1, .bat, .cmd, .vbs, .js) or installers run from an
// already-open PowerShell or Command Prompt or by a scheduled task. Switched on per server
// (ADVANCED_APP_CONTROL); the server then sends AssignedAppControlResponse.advanced.
//
// How the rules are laid out, so nothing else on the device changes:
//  - Only the Script, Windows Installer (Msi) and Dll collections are used; programs (.exe)
//    stay with the process watcher.
//  - A collection the device wasn't using gets one "allow everything" rule, so only what a
//    rule names is blocked. A collection that already has someone else's rules (a company
//    AppLocker policy) is left as it is - our block rules are just added to it.
//  - Each block is a Deny rule for Everyone, with exceptions for the agent's own folder and every
//    Allow rule. AppLocker applies only to programs users start (unless "services enforcement"
//    is switched on, which this never does), so the agent, running as SYSTEM, is unaffected.
//  - Every rule we add carries APPLOCKER_MARKER, so it can be removed exactly (sync, desktop
//    safety net, uninstall) without touching anyone else's.
//
// Needs the Application Identity service (AppIDSvc), which the agent starts. Windows 10/11 Pro,
// Enterprise and Education all enforce AppLocker (edition checks were removed in 2022, KB5024351).

const AGENT_FOLDER = path.join(process.env.ProgramData ?? "C:\\ProgramData", "EndpointPro");
const PROBE_DIR = path.join(process.env.SystemRoot ?? "C:\\Windows", "Temp", "EndpointIQ-AppLockerProbe");
const REAPPLY_EVERY_MS = 30 * 60_000; // repair the policy if something else rewrote it
const ALLOW_ALL_IDS: Record<Collection, string> = {
  Script: "e1d0a11c-0000-4000-8000-000000000001",
  Msi: "e1d0a11c-0000-4000-8000-000000000002",
  Dll: "e1d0a11c-0000-4000-8000-000000000003",
};
// AppLocker understands only these variables; any other %VAR% is expanded on the device.
const APPLOCKER_VARIABLES = ["%WINDIR%", "%SYSTEM32%", "%OSDRIVE%", "%PROGRAMFILES%", "%REMOVABLE%", "%HOT%"];

type Collection = "Script" | "Msi" | "Dll";

interface DenyRule {
  id: string;
  collection: Collection;
  name: string;
  path: string;
}

interface Desired {
  denies: DenyRule[];
  allows: string[];
}

interface SavedState {
  hash: string;
  appliedAt: number;
  ruleCount: number;
  eventsSince: string;
}

export interface AppLockerResult {
  problem: string | null; // shown on the Sync status tab; null while everything is in force
  events: RawEvent[];
}

function psEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function expandVariables(value: string): string {
  return value.replace(/%([^%\\]+)%/g, (whole, name: string) => {
    if (APPLOCKER_VARIABLES.includes(whole.toUpperCase())) return whole.toUpperCase();
    const hit = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
    return hit ? (process.env[hit] ?? whole) : whole;
  });
}

// "C:\Tools" and "C:\Tools\" mean everything in that folder; "C:\Tools\app.exe" one file.
export function allowPattern(value: string): string {
  let v = expandVariables(value.trim().replace(/\//g, "\\"));
  if (v.endsWith("\\")) return `${v}*`;
  const last = v.slice(v.lastIndexOf("\\") + 1);
  if (!last.includes(".") && !last.includes("*") && !last.includes("?")) v = `${v}\\*`;
  return v;
}

// A DLL named without a folder is blocked wherever it is.
export function dllPattern(value: string): string {
  const v = expandVariables(value.trim().replace(/\//g, "\\"));
  return v.includes("\\") ? v : `*\\${v}`;
}

export function desiredAppLocker(advancedRules: AppControlRuleWire[], rules: AppControlRuleWire[]): Desired {
  const denies: DenyRule[] = [];
  for (const r of rules) {
    if (r.ruleType !== "EXTENSION") continue;
    const ext = (r.value.trim().startsWith(".") ? r.value.trim() : `.${r.value.trim()}`).toLowerCase();
    const collection: Collection | null = APPLOCKER_SCRIPT_EXTENSIONS.includes(ext) ? "Script" : APPLOCKER_MSI_EXTENSIONS.includes(ext) ? "Msi" : null;
    if (collection) denies.push({ id: r.ruleId, collection, name: `Block ${ext} files`, path: `*${ext}` });
  }
  const allows = [`${AGENT_FOLDER}\\*`];
  for (const r of advancedRules) {
    if (appControlRuleProblem(r.ruleType, r.value)) {
      console.warn(`App Control: not applying rule ${r.ruleId} (${r.value}): ${appControlRuleProblem(r.ruleType, r.value)}`);
      continue;
    }
    if (r.ruleType === "DLL") denies.push({ id: r.ruleId, collection: "Dll", name: `Block ${r.value.trim()}`, path: dllPattern(r.value) });
    else if (r.ruleType === "ALLOW_PATH") allows.push(allowPattern(r.value));
  }
  return { denies, allows: [...new Set(allows)] };
}

// Where a probe file for a rule can be made, to ask AppLocker whether the rule really blocks:
// only for rules that match anywhere ("*.ps1", "*\evil.dll") - a probe never goes outside PROBE_DIR.
function probeFor(rule: DenyRule): string | null {
  if (!rule.path.startsWith("*")) return null;
  const rest = rule.path.slice(1).replace(/[*?]/g, "x");
  return rest.startsWith("\\") ? path.join(PROBE_DIR, "probe", rest.slice(1)) : path.join(PROBE_DIR, `probe${rest}`);
}

function xmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The rules to add, as XML fragments per collection (inserted by the PowerShell below).
function ruleFragments(d: Desired): Record<Collection, string[]> {
  const out: Record<Collection, string[]> = { Script: [], Msi: [], Dll: [] };
  const exceptions = d.allows.map((a) => `<FilePathCondition Path="${xmlAttr(a)}" />`).join("");
  for (const r of d.denies) {
    out[r.collection].push(
      `<FilePathRule Id="${xmlAttr(r.id)}" Name="${xmlAttr(`Endpoint IQ: ${r.name}`.slice(0, 200))}" Description="${APPLOCKER_MARKER}" UserOrGroupSid="S-1-1-0" Action="Deny">` +
        `<Conditions><FilePathCondition Path="${xmlAttr(r.path)}" /></Conditions><Exceptions>${exceptions}</Exceptions></FilePathRule>`,
    );
  }
  return out;
}

export function buildApplyScript(d: Desired, probes: { id: string; path: string }[]): string {
  const fragments = ruleFragments(d);
  const collections = (Object.keys(fragments) as Collection[]).filter((c) => fragments[c].length > 0);
  const perCollection = collections
    .map((c) => {
      const allowAll =
        `<FilePathRule Id="${ALLOW_ALL_IDS[c]}" Name="Endpoint IQ: allow everything not blocked" Description="${APPLOCKER_MARKER}" UserOrGroupSid="S-1-1-0" Action="Allow">` +
        `<Conditions><FilePathCondition Path="*" /></Conditions></FilePathRule>`;
      return `Add-Rules '${c}' '${psEscape(allowAll)}' '${psEscape(`<r>${fragments[c].join("")}</r>`)}'`;
    })
    .join("\n");
  const probeList = probes.map((p) => `@{ id = '${psEscape(p.id)}'; path = '${psEscape(p.path)}' }`).join(", ");
  return `
$ErrorActionPreference = 'Stop'
$result = @{ applied = $false; service = ''; notDenied = @(); testError = $null; foreignAudit = @() }

# The Application Identity service enforces AppLocker.
try {
  $svc = Get-Service -Name AppIDSvc
  if ($svc.Status -ne 'Running') {
    & sc.exe config AppIDSvc start= auto 2>$null | Out-Null
    try { Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\AppIDSvc' -Name Start -Value 2 -Type DWord } catch {}
    Start-Service -Name AppIDSvc
    $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(15))
  }
  $result.service = [string](Get-Service -Name AppIDSvc).Status
} catch { $result.service = 'NotRunning: ' + $_.Exception.Message }

$xml = [xml](Get-AppLockerPolicy -Local -Xml)
$root = $xml.AppLockerPolicy
# Our earlier rules come out first; everything else stays.
foreach ($c in @($root.RuleCollection)) {
  if (-not $c) { continue }
  $ours = @($c.ChildNodes | Where-Object { $_.Description -eq '${APPLOCKER_MARKER}' })
  foreach ($r in $ours) { [void]$c.RemoveChild($r) }
  if ($ours.Count -gt 0 -and @($c.ChildNodes | Where-Object { $_.LocalName -like '*Rule' }).Count -eq 0) { $c.SetAttribute('EnforcementMode', 'NotConfigured') }
}

function Add-Rules($type, $allowAll, $denies) {
  $c = @($root.RuleCollection) | Where-Object { $_ -and $_.Type -eq $type } | Select-Object -First 1
  if (-not $c) {
    $c = $xml.CreateElement('RuleCollection')
    $c.SetAttribute('Type', $type)
    $c.SetAttribute('EnforcementMode', 'NotConfigured')
    [void]$root.AppendChild($c)
  }
  $foreign = @($c.ChildNodes | Where-Object { $_.LocalName -like '*Rule' }).Count
  if ($foreign -eq 0) {
    # A collection only we use: allow everything, block only what our rules name.
    $frag = $xml.CreateDocumentFragment(); $frag.InnerXml = $allowAll
    [void]$c.PrependChild($frag)
    $c.SetAttribute('EnforcementMode', 'Enabled')
  } elseif ($c.EnforcementMode -ne 'Enabled') {
    $script:result.foreignAudit += $type
  }
  $doc = [xml]$denies
  foreach ($n in @($doc.r.ChildNodes)) { [void]$c.AppendChild($xml.ImportNode($n, $true)) }
}

${perCollection}

$file = Join-Path $env:TEMP ('eiq-applocker-' + [guid]::NewGuid().ToString('N') + '.xml')
$xml.Save($file)
try {
  Set-AppLockerPolicy -XmlPolicy $file
  $result.applied = $true

  # Ask AppLocker whether each wildcard rule really blocks a matching file.
  $probes = @(${probeList})
  if ($probes.Count -gt 0) {
    try {
      foreach ($p in $probes) {
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($p.path)) -Force | Out-Null
        # Not empty: AppLocker can't evaluate a zero-byte file.
        [IO.File]::WriteAllText($p.path, "rem Endpoint IQ AppLocker probe")
      }
      $tests = @(Test-AppLockerPolicy -XmlPolicy $file -Path @($probes | ForEach-Object { $_.path }) -User Everyone)
      foreach ($p in $probes) {
        $t = $tests | Where-Object { $_.FilePath -eq $p.path } | Select-Object -First 1
        if (-not $t -or [string]$t.PolicyDecision -notlike 'Denied*') { $result.notDenied += $p.id }
      }
    } catch { $result.testError = $_.Exception.Message }
    Remove-Item -LiteralPath '${psEscape(PROBE_DIR)}' -Recurse -Force -ErrorAction SilentlyContinue
  }
} finally {
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
}
[Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
`;
}

// AppLocker's own record of what it blocked (8004: program or DLL, 8007: script or installer).
function buildEventsScript(since: string): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$since = [datetime]::Parse('${psEscape(since)}').ToUniversalTime().ToLocalTime()
$out = @(Get-WinEvent -FilterHashtable @{ LogName = @('Microsoft-Windows-AppLocker/EXE and DLL', 'Microsoft-Windows-AppLocker/MSI and Script'); Id = @(8004, 8007); StartTime = $since } -MaxEvents 500 | ForEach-Object {
  $d = ([xml]$_.ToXml()).Event.UserData.RuleAndFileData
  $p = if ($d.FullFilePath) { [string]$d.FullFilePath } else { [string]$d.FilePath }
  [pscustomobject]@{ ruleId = ([string]$d.RuleId).Trim('{', '}').ToLowerInvariant(); path = $p.Replace('%OSDRIVE%', $env:SystemDrive); at = $_.TimeCreated.ToUniversalTime().ToString('o') }
})
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $out -Compress))
`;
}

async function runPs(script: string, timeout = 120_000): Promise<string> {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    maxBuffer: 4 * 1024 * 1024,
    timeout,
  });
  return stdout;
}

async function readState(): Promise<SavedState | null> {
  try {
    return JSON.parse(await fsp.readFile(appLockerStateFile(), "utf8")) as SavedState;
  } catch {
    return null;
  }
}

async function writeState(s: SavedState): Promise<void> {
  await fsp.mkdir(path.dirname(appLockerStateFile()), { recursive: true });
  await fsp.writeFile(appLockerStateFile(), JSON.stringify(s), "utf8");
}

let lastProblem: string | null = null;

// advanced: undefined while the server doesn't offer advanced application control (or the agent
// is paused / suspended by the desktop safety net) - every AppLocker rule we added comes out.
export async function syncAppLocker(advanced: AppControlRuleWire[] | undefined, rules: AppControlRuleWire[]): Promise<AppLockerResult> {
  const state = await readState();
  const desired = advanced ? desiredAppLocker(advanced, rules) : { denies: [], allows: [] };

  if (desired.denies.length === 0) {
    if (state) {
      await runPs(`$ErrorActionPreference = 'SilentlyContinue'\n${REMOVE_APPLOCKER_RULES_PS}`, 60_000).catch((err) => console.error("App Control: removing AppLocker rules failed", err));
      await fsp.rm(appLockerStateFile(), { force: true });
      console.log("App Control: AppLocker rules removed");
    }
    lastProblem = null;
    return { problem: null, events: [] };
  }

  const hash = createHash("sha256").update(JSON.stringify(desired)).digest("hex");
  const now = Date.now();
  let eventsSince = state?.eventsSince ?? new Date(now).toISOString();

  if (!state || state.hash !== hash || now - state.appliedAt > REAPPLY_EVERY_MS) {
    const probes = desired.denies.map((r) => ({ id: r.id, path: probeFor(r) })).filter((p): p is { id: string; path: string } => Boolean(p.path));
    try {
      const out = await runPs(buildApplyScript(desired, probes));
      const line = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).pop();
      const res = JSON.parse(line ?? "{}") as { applied?: boolean; service?: string; notDenied?: string[] | string; testError?: string | null; foreignAudit?: string[] | string };
      if (!res.applied) throw new Error(`AppLocker policy wasn't applied: ${out.trim().slice(0, 300)}`);
      const notDenied = ([] as string[]).concat(res.notDenied ?? []);
      const audit = ([] as string[]).concat(res.foreignAudit ?? []);
      const problems: string[] = [];
      if (res.service !== "Running") problems.push(`The Application Identity service (AppIDSvc) isn't running (${res.service}), so Windows isn't enforcing DLL and script rules`);
      if (notDenied.length) {
        const names = desired.denies.filter((r) => notDenied.includes(r.id)).map((r) => r.path);
        problems.push(`Windows didn't confirm these AppLocker rules block anything: ${names.join(", ")}`);
      }
      if (audit.length) problems.push(`This device's own AppLocker policy has ${audit.join(", ")} rules in audit-only mode, so blocks there are only logged`);
      if (res.testError) console.warn(`App Control: couldn't test the AppLocker rules: ${res.testError}`);
      lastProblem = problems.length ? problems.join(". ") : null;
      if (!state) eventsSince = new Date(now - 5_000).toISOString();
      await writeState({ hash, appliedAt: now, ruleCount: desired.denies.length, eventsSince });
      console.log(`App Control: AppLocker rules applied (${desired.denies.length} block, ${desired.allows.length} allow)`);
    } catch (err) {
      lastProblem = `AppLocker rules couldn't be applied: ${err instanceof Error ? err.message : String(err)}`.slice(0, 600);
      console.error(`App Control: ${lastProblem}`);
      return { problem: lastProblem, events: [] };
    }
  }

  // Blocks AppLocker recorded since the last sync, matched to our rules by rule id.
  const ours = new Set(desired.denies.map((r) => r.id.toLowerCase()));
  const events: RawEvent[] = [];
  let newest = eventsSince;
  try {
    const out = await runPs(buildEventsScript(eventsSince), 60_000);
    const line = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("[") || l.startsWith("{")).pop();
    const parsed = line ? (JSON.parse(line) as { ruleId: string; path: string; at: string }[] | { ruleId: string; path: string; at: string }) : [];
    for (const e of ([] as { ruleId: string; path: string; at: string }[]).concat(parsed)) {
      if (e.at > newest) newest = e.at;
      if (!ours.has(e.ruleId) || !e.path) continue;
      events.push({ kind: "app", ruleId: e.ruleId, path: e.path, at: e.at, closed: true, sessionId: 0 });
    }
  } catch (err) {
    console.warn("App Control: reading AppLocker events failed", err);
  }
  if (newest !== eventsSince) {
    const s = await readState();
    // One millisecond on, so the newest event isn't read twice.
    if (s) await writeState({ ...s, eventsSince: new Date(new Date(newest).getTime() + 1).toISOString() });
  }
  return { problem: lastProblem, events };
}
