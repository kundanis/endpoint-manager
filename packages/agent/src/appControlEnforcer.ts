import { type ChildProcess, execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AppControlEventPayload, AppControlRuleWire, AppControlScanResultPayload, AssignedAppControlResponse } from "@em/shared";
import {
  appControlRuleProblem,
  COMMAND_BLOCK_KILLABLE_WINDOWS_TOOLS,
  COMMAND_BLOCK_PROTECTED_PROCESS_NAMES,
  CRITICAL_WINDOWS_PROCESSES,
} from "@em/shared";
import { APP_CONTROL_DIR, BLOCKER_EVENTS_DIR, BLOCKER_SCRIPT, commandRulesFile, IFEO_MARKER, IFEO_ROOTS, watcherRulesFile } from "./appControlPaths";
import { allowPattern, syncAppLocker } from "./appLockerEnforcer";
import { agentConfig } from "./config";
import { isEnforcementSuspended } from "./shellHealthGuard";

const execFileAsync = promisify(execFile);

// Application control, in two layers. (Windows 11 ignores the Software Restriction Policy rules
// agents before 0.2.18 wrote; they are removed on every sync.)
//
//  1. Launch block (Image File Execution Options) for plain program-name rules such as
//     "AnyDesk.exe": Windows starts blocked.ps1 instead of the program, which records the
//     attempt and tells the user. The program never runs. Name only, so a renamed copy gets past it.
//  2. Process watcher for every rule: a long-running PowerShell is told about each program start
//     (Win32_ProcessStartTrace) and closes it straight away when it matches - by file name, the
//     original file name stored inside the program (catches renamed copies), path, product name,
//     publisher / signer, or a blocked script type run by a script host. Programs already
//     running when a rule arrives are closed too.
//
// Neither layer ever touches the Windows folder (except script hosts, for script-type rules),
// Windows' core processes or the agent, whatever a rule says - on top of appControlRuleProblem.

const SCRIPT_HOSTS = ["wscript.exe", "cscript.exe", "mshta.exe", "msiexec.exe", "java.exe", "javaw.exe"];
const MAX_CLOSES_PER_MINUTE = 30;
const REPORT_EVERY_MS = 60_000; // one event per program path per minute (a restarting service would flood)

function psEscape(value: string): string {
  return value.replace(/'/g, "''");
}
const psList = (items: readonly string[]) => items.map((i) => `'${psEscape(i)}'`).join(", ");

// A plain program name ("AnyDesk.exe") can be blocked at launch; paths and wildcards can't.
function launchBlockName(rule: AppControlRuleWire): string | null {
  if (rule.ruleType !== "EXECUTABLE") return null;
  const v = rule.value.trim().toLowerCase();
  return /^[^\\/:*?"<>|]+\.exe$/.test(v) ? v : null;
}

/* ------------------------------------------------------------------------------------------
 * Layer 1: launch block
 * ---------------------------------------------------------------------------------------- */

export const BLOCKER_PS = `# Endpoint IQ: Windows starts this instead of a program blocked by Application control.
$ErrorActionPreference = 'SilentlyContinue'
$target = if ($args.Count -gt 0) { [string]$args[0] } else { '' }
for ($i = 1; $i -lt $args.Count -and -not $target.ToLowerInvariant().EndsWith('.exe'); $i++) { $target += ' ' + $args[$i] }
$name = [IO.Path]::GetFileName($target)
$sessionId = (Get-Process -Id $PID).SessionId
try {
  $evt = [pscustomobject]@{ path = $target; at = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path '${psEscape(BLOCKER_EVENTS_DIR)}' ([guid]::NewGuid().ToString('N') + '.json')), $evt)
} catch {}
if ($sessionId -ne 0) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("$name is blocked by your organisation's IT policy.\`n\`nContact your IT administrator if you need it.", 'Blocked by Endpoint IQ', 'OK', 'Warning') | Out-Null
}
`;

const BLOCKER_COMMAND = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${BLOCKER_SCRIPT}"`;

// Users must be able to write events (the blocker runs as whoever launched the program), but not
// change the blocker itself, which keeps the inherited read-only access.
async function ensureBlockerFiles(): Promise<void> {
  await fsp.mkdir(BLOCKER_EVENTS_DIR, { recursive: true });
  const current = await fsp.readFile(BLOCKER_SCRIPT, "utf8").catch(() => "");
  if (current !== BLOCKER_PS) {
    await fsp.writeFile(BLOCKER_SCRIPT, BLOCKER_PS, "utf8");
    await execFileAsync("icacls", [BLOCKER_EVENTS_DIR, "/grant", "*S-1-5-32-545:(OI)(CI)(W)"]).catch(() => undefined);
  }
}

export function buildLaunchBlockScript(names: Map<string, string>): string {
  const wanted = [...names].map(([name, ruleId]) => `'${psEscape(name)}' = '${psEscape(ruleId)}'`).join("; ");
  return `
$ErrorActionPreference = 'SilentlyContinue'
# Software Restriction Policy rules from agents before 0.2.18 (Windows 11 ignores them).
Get-ChildItem -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Safer\\CodeIdentifiers\\0\\Paths' |
  Where-Object { (Get-ItemProperty -Path $_.PSPath -Name Description).Description -like 'EM-managed:*' } |
  ForEach-Object { Remove-Item -Path $_.PSPath -Recurse -Force }

$wanted = @{ ${wanted} }
$debugger = '${psEscape(BLOCKER_COMMAND)}'
foreach ($root in @(${psList(IFEO_ROOTS)})) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  foreach ($key in @(Get-ChildItem -LiteralPath $root)) {
    $props = Get-ItemProperty -LiteralPath $key.PSPath
    if ($props.${IFEO_MARKER} -and -not $wanted.ContainsKey($key.PSChildName.ToLowerInvariant())) {
      Remove-ItemProperty -LiteralPath $key.PSPath -Name Debugger, ${IFEO_MARKER} -Force
      $k = Get-Item -LiteralPath $key.PSPath
      if ($k.ValueCount -eq 0 -and $k.SubKeyCount -eq 0) { Remove-Item -LiteralPath $key.PSPath -Force }
    }
  }
  foreach ($name in $wanted.Keys) {
    $path = Join-Path $root $name
    $props = Get-ItemProperty -LiteralPath $path
    # Never replace a Debugger someone else set (a real debugger or another product).
    if ($props -and $props.Debugger -and -not $props.${IFEO_MARKER}) { continue }
    if (-not $props) { New-Item -Path $path -Force | Out-Null }
    Set-ItemProperty -LiteralPath $path -Name Debugger -Value $debugger -Type String
    Set-ItemProperty -LiteralPath $path -Name ${IFEO_MARKER} -Value $wanted[$name] -Type String
  }
}
Write-Output 'APPLIED'
`;
}

// Events the blocker left behind since the last sync, matched to rules by file name.
async function collectBlockerEvents(names: Map<string, string>): Promise<RawEvent[]> {
  const files = (await fsp.readdir(BLOCKER_EVENTS_DIR).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).slice(0, 500);
  const out: RawEvent[] = [];
  for (const f of files) {
    const full = path.join(BLOCKER_EVENTS_DIR, f);
    try {
      const raw = (await fsp.readFile(full, "utf8")).replace(/^﻿/, "");
      const e = JSON.parse(raw) as { path?: string; at?: string };
      if (e.path) {
        const name = path.win32.basename(e.path).toLowerCase();
        out.push({ ruleId: names.get(name) ?? null, path: e.path, at: e.at ?? new Date().toISOString(), closed: false, sessionId: 0 });
      }
    } catch {
      // half-written or not ours: dropped
    }
    await fsp.rm(full, { force: true });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------
 * Layer 2: process watcher
 * ---------------------------------------------------------------------------------------- */

export interface RawEvent {
  kind?: "app" | "command";
  ruleId: string | null;
  path: string;
  commandLine?: string | null;
  at: string;
  closed: boolean;
  sessionId: number;
}

// sweepOnly: check the programs running now and exit - the fallback each sync runs while the
// long-running watcher isn't working. The watcher also enforces Command blocking (commandRulesFile,
// written by commandBlockEnforcer.ts): a matching command line is closed the moment it starts.
export function buildWatcherScript(rulesFile: string, agentPid: number, sweepOnly = false, commandRulesFile = ""): string {
  const main = sweepOnly
    ? `Load-Rules | Out-Null
Sweep`
    : `Register-CimIndicationEvent -ClassName Win32_ProcessStartTrace -SourceIdentifier 'emAppControl' -ErrorAction Stop | Out-Null
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
Load-Rules | Out-Null
Sweep
while ($true) {
  $e = Wait-Event -SourceIdentifier 'emAppControl' -Timeout 10
  if (Load-Rules) { Sweep }
  if (((Get-Date) - $lastAgentCheck).TotalSeconds -ge 30) {
    $lastAgentCheck = Get-Date
    if (-not (Get-Process -Id $agentPid)) { exit }
  }
  if (-not $e) { continue }
  Remove-Event -EventIdentifier $e.EventIdentifier
  $ne = $e.SourceEventArgs.NewEvent
  # The agent's own processes and everything they start (deployments, scripts) are never touched.
  if ($agentTree.Contains([int]$ne.ParentProcessID)) { [void]$agentTree.Add([int]$ne.ProcessID); continue }
  if ($script:rules.Count -eq 0 -and $script:cmdRules.Count -eq 0) { continue }
  Check ([int]$ne.ProcessID) ([int]$ne.SessionID) $null $null
}`;
  return `
$ErrorActionPreference = 'SilentlyContinue'
$rulesFile = '${psEscape(rulesFile)}'
$commandRulesFile = '${psEscape(commandRulesFile)}'
$agentPid = ${agentPid}
$agentTree = New-Object 'System.Collections.Generic.HashSet[int]'
[void]$agentTree.Add($agentPid)
$cmdProtected = @(${psList(COMMAND_BLOCK_PROTECTED_PROCESS_NAMES)})
$killableTools = @(${psList(COMMAND_BLOCK_KILLABLE_WINDOWS_TOOLS)})
$script:cmdRules = @()
$script:cmdStamp = -1
$windowsDir = ($env:SystemRoot.TrimEnd('\\') + '\\').ToLowerInvariant()
$protected = @(${psList(CRITICAL_WINDOWS_PROCESSES)})
$scriptHosts = @(${psList(SCRIPT_HOSTS)})
$script:rules = @()
$script:allows = @()
$script:rulesStamp = -1
$script:needSigner = $false
$script:closes = @()
$info = @{}
$recent = @{}
$lastAgentCheck = Get-Date

function Load-Rules {
  $changed = $false
  $item = Get-Item -LiteralPath $rulesFile
  $stamp = if ($item) { $item.LastWriteTimeUtc.Ticks } else { 0 }
  if ($stamp -ne $script:rulesStamp) {
    $script:rulesStamp = $stamp
    $loaded = if ($item) { Get-Content -LiteralPath $rulesFile -Raw | ConvertFrom-Json } else { $null }
    $all = @($loaded | Where-Object { $_ -and $_.ruleId })
    # Allow rules (advanced application control): exceptions to every block below.
    $script:allows = @($all | Where-Object { $_.ruleType -eq 'ALLOW_PATH' } | ForEach-Object { [Environment]::ExpandEnvironmentVariables([string]$_.value).ToLowerInvariant() })
    $script:rules = @($all | Where-Object { $_.ruleType -ne 'ALLOW_PATH' })
    $script:needSigner = @($script:rules | Where-Object { $_.ruleType -eq 'PUBLISHER' }).Count -gt 0
    $info.Clear()
    $changed = $true
  }
  $item = if ($commandRulesFile) { Get-Item -LiteralPath $commandRulesFile } else { $null }
  $stamp = if ($item) { $item.LastWriteTimeUtc.Ticks } else { 0 }
  if ($stamp -ne $script:cmdStamp) {
    $script:cmdStamp = $stamp
    $loaded = if ($item) { Get-Content -LiteralPath $commandRulesFile -Raw | ConvertFrom-Json } else { $null }
    $script:cmdRules = @($loaded | Where-Object { $_ -and $_.ruleId -and $_.pattern })
    $changed = $true
  }
  return $changed
}

# Command blocking: the same exclusions as the 20-second scan (commandBlockEnforcer.ts) - browsers
# and core Windows processes, anything in the Windows folder except script hosts and attack tools,
# and the agent's own scripts.
function Find-CommandRule($procId, $path, $cmd) {
  if ($script:cmdRules.Count -eq 0) { return $null }
  $lower = $path.ToLowerInvariant()
  $name = [IO.Path]::GetFileName($lower)
  if ($cmdProtected -contains $name) { return $null }
  if ($lower.StartsWith($windowsDir) -and ($killableTools -notcontains $name)) { return $null }
  if (-not $cmd) { $cmd = [string](Get-CimInstance Win32_Process -Filter "ProcessId=$procId").CommandLine }
  if (-not $cmd -or $cmd.ToLowerInvariant().Contains('endpointpro')) { return $null }
  foreach ($r in $script:cmdRules) {
    $hit = $false
    try {
      if ($r.ruleType -eq 'COMMAND_PATTERN') { $hit = [regex]::IsMatch($cmd, [string]$r.pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) }
      elseif ($r.ruleType -eq 'EXACT_COMMAND_LINE') { $hit = $cmd.Trim().Equals(([string]$r.pattern).Trim(), [StringComparison]::OrdinalIgnoreCase) }
      elseif ($r.ruleType -eq 'PROCESS_NAME') { $hit = $name -eq ([string]$r.pattern).ToLowerInvariant() }
    } catch { $hit = $false }
    if ($hit) { return [pscustomobject]@{ Rule = $r; CommandLine = $cmd } }
  }
  return $null
}

# What is stored inside / signed onto a program file - cached per path and modification time.
function Get-Details($path) {
  $f = Get-Item -LiteralPath $path
  if (-not $f) { return $null }
  $key = $path.ToLowerInvariant() + '|' + $f.LastWriteTimeUtc.Ticks
  if ($info.ContainsKey($key)) { return $info[$key] }
  $v = $f.VersionInfo
  $signer = $null
  if ($script:needSigner) {
    $sig = Get-AuthenticodeSignature -LiteralPath $path
    if ($sig -and $sig.SignerCertificate) { $signer = $sig.SignerCertificate.Subject }
  }
  $d = [pscustomobject]@{ Original = "$($v.OriginalFilename)".Trim(); Product = "$($v.ProductName)".Trim(); Description = "$($v.FileDescription)".Trim(); Company = "$($v.CompanyName)".Trim(); Signer = $signer }
  if ($info.Count -gt 2000) { $info.Clear() }
  $info[$key] = $d
  return $d
}

function Find-Rule($procId, $path, $sessionId) {
  $lower = $path.ToLowerInvariant()
  $name = [IO.Path]::GetFileName($lower)
  if ($lower.Contains('\\endpointpro\\')) { return $null }
  if ($protected -contains $name) { return $null }
  foreach ($a in $script:allows) { if ($lower -like $a) { return $null } }
  $inWindows = $lower.StartsWith($windowsDir)
  $isHost = $scriptHosts -contains $name
  if ($inWindows -and -not $isHost) { return $null }
  $d = $null
  $cmd = $null
  foreach ($r in $script:rules) {
    $v = [string]$r.value
    $hit = $false
    if ($r.ruleType -eq 'EXECUTABLE' -and -not $inWindows) {
      if ($v.Contains('\\') -or $v.Contains(':')) {
        $hit = $lower -like [Environment]::ExpandEnvironmentVariables($v).ToLowerInvariant()
      } elseif ($name -like $v) {
        $hit = $true
      } else {
        # A renamed copy: the original file name stored in the program, or - for programs that
        # store none (AnyDesk) - a product name or description that is the rule's name
        # ("AnyDesk.exe" -> "AnyDesk", "AnyDesk Remote Desktop").
        if (-not $d) { $d = Get-Details $path }
        $base = if ($v.ToLowerInvariant().EndsWith('.exe')) { $v.Substring(0, $v.Length - 4) } else { $v }
        $named = { param($s) $s -and ($s -eq $base -or $s.StartsWith($base + ' ', [StringComparison]::OrdinalIgnoreCase)) }
        $hit = [bool]($d -and (($d.Original -and ($d.Original -like $v)) -or (-not $base.Contains('*') -and -not $base.Contains('?') -and $base.Length -ge 3 -and ((& $named $d.Product) -or (& $named $d.Description)))))
      }
    } elseif ($r.ruleType -eq 'PRODUCT' -and -not $inWindows) {
      if (-not $d) { $d = Get-Details $path }
      $hit = [bool]($d -and $d.Product -and ($d.Product -like $v))
    } elseif ($r.ruleType -eq 'PUBLISHER' -and -not $inWindows) {
      if (-not $d) { $d = Get-Details $path }
      $pat = '*' + $v + '*'
      $hit = [bool]($d -and (($d.Signer -and $d.Signer -like $pat) -or ($d.Company -and $d.Company -like $pat)))
    } elseif ($r.ruleType -eq 'EXTENSION' -and $isHost -and -not ($name -eq 'msiexec.exe' -and $sessionId -eq 0)) {
      if ($null -eq $cmd) { $cmd = [string](Get-CimInstance Win32_Process -Filter "ProcessId=$procId").CommandLine }
      $ext = if ($v.StartsWith('.')) { $v } else { '.' + $v }
      $hit = $cmd -match ([regex]::Escape($ext) + '(["''\\s]|$)')
      # A script in an allowed folder runs.
      if ($hit) { $lc = $cmd.ToLowerInvariant(); foreach ($a in $script:allows) { if ($lc -like ('*' + $a + '*')) { $hit = $false; break } } }
    }
    if ($hit) { return $r }
  }
  return $null
}

function Check($procId, $sessionId, $path, $cmd) {
  if ($procId -le 4 -or $procId -eq $PID -or $agentTree.Contains([int]$procId)) { return }
  if (-not $path) { $p = Get-Process -Id $procId; if ($p) { $path = $p.Path } }
  if (-not $path) { $path = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId").ExecutablePath }
  if (-not $path) { return }
  $kind = 'app'
  $commandLine = $null
  $r = if ($script:rules.Count -gt 0) { Find-Rule $procId $path $sessionId } else { $null }
  if (-not $r) {
    $c = Find-CommandRule $procId $path $cmd
    if (-not $c) { return }
    $r = $c.Rule
    $kind = 'command'
    $commandLine = $c.CommandLine
    if ($commandLine.Length -gt 2000) { $commandLine = $commandLine.Substring(0, 2000) }
  }
  $now = Get-Date
  $script:closes = @($script:closes | Where-Object { ($now - $_).TotalSeconds -lt 60 })
  $closed = $false
  if ($script:closes.Count -lt ${MAX_CLOSES_PER_MINUTE}) {
    Stop-Process -Id $procId -Force
    $closed = $true
    $script:closes += $now
  }
  # Every blocked command is reported; a blocked program once a minute (a restarting service would flood).
  $key = $path.ToLowerInvariant()
  if ($kind -eq 'command' -or -not $recent.ContainsKey($key) -or ($now - $recent[$key]).TotalMilliseconds -ge ${REPORT_EVERY_MS}) {
    $recent[$key] = $now
    $line = [pscustomobject]@{ kind = $kind; ruleId = [string]$r.ruleId; path = $path; commandLine = $commandLine; closed = $closed; sessionId = [int]$sessionId; at = $now.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
  }
}

function Sweep {
  $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, SessionId, ExecutablePath, CommandLine)
  # Rebuild the set of the agent's own processes and their descendants.
  $agentTree.Clear()
  [void]$agentTree.Add($agentPid)
  do {
    $added = 0
    foreach ($p in $all) { if (-not $agentTree.Contains([int]$p.ProcessId) -and $agentTree.Contains([int]$p.ParentProcessId)) { [void]$agentTree.Add([int]$p.ProcessId); $added++ } }
  } while ($added -gt 0)
  if ($script:rules.Count -eq 0 -and $script:cmdRules.Count -eq 0) { return }
  foreach ($p in $all) {
    if ($p.ExecutablePath) { Check $p.ProcessId $p.SessionId $p.ExecutablePath $p.CommandLine }
  }
}

${main}
`;
}

let watcher: ChildProcess | null = null;
let watcherReady = false;
let watcherStartedAt = 0;
let watcherOutput = "";
let watcherStderr = "";
let watcherProblem: string | null = null; // why the watcher last stopped, for Sync status
const watcherEvents: RawEvent[] = [];
const commandWatcherEvents: RawEvent[] = [];
const watcherLog = () => path.join(agentConfig.stateDir, "app-control-watcher.log");

// Kept on the device for support: start, ready and stop, with whatever PowerShell printed.
function logWatcher(line: string): void {
  const file = watcherLog();
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    // logging must never break enforcement
  }
}

function parseEventLines(text: string, sink: RawEvent[], onReady?: () => void): void {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      const e = JSON.parse(line) as Partial<RawEvent> & { ready?: boolean };
      if (e.ready) onReady?.();
      else if (e.path && sink.length < 1000) sink.push(e as RawEvent);
    } catch {
      // partial or foreign line
    }
  }
}

function ensureWatcher(): void {
  if (watcher) return;
  watcherReady = false;
  watcherStderr = "";
  watcherStartedAt = Date.now();
  logWatcher(`starting (agent pid ${process.pid})`);
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", buildWatcherScript(watcherRulesFile(), process.pid, false, commandRulesFile())],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  watcher = child;
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    watcherOutput += chunk;
    const nl = watcherOutput.lastIndexOf("\n");
    if (nl < 0) return;
    const complete = watcherOutput.slice(0, nl);
    watcherOutput = watcherOutput.slice(nl + 1);
    const parsed: RawEvent[] = [];
    parseEventLines(complete, parsed, () => {
      watcherReady = true;
      watcherProblem = null;
      console.log("App Control: process watcher running");
      logWatcher("ready");
    });
    for (const e of parsed) (e.kind === "command" ? commandWatcherEvents : watcherEvents).push(e);
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    watcherStderr = (watcherStderr + chunk).slice(-2000);
  });
  child.on("exit", (code, signal) => {
    const why = watcherStderr.replace(/\s+/g, " ").trim().slice(0, 600);
    watcherProblem = `The process watcher stopped (exit ${code ?? signal})${why ? `: ${why}` : ""}`;
    console.warn(`App Control: ${watcherProblem}; restarting at the next sync`);
    logWatcher(`stopped: exit ${code ?? signal}${why ? ` - ${why}` : ""}`);
    if (watcher === child) {
      watcher = null;
      watcherReady = false;
    }
  });
  child.on("error", (err) => {
    watcherProblem = `The process watcher couldn't start: ${err.message}`;
    console.error(`App Control: ${watcherProblem}`);
    logWatcher(`couldn't start - ${err.message}`);
    if (watcher === child) {
      watcher = null;
      watcherReady = false;
    }
  });
}

// Used by Command blocking (commandBlockEnforcer.ts), which shares the watcher.
export function ensureProcessWatcher(): void {
  ensureWatcher();
}

export function drainCommandWatcherEvents(): RawEvent[] {
  return commandWatcherEvents.splice(0);
}

// Why the watcher isn't closing things the moment they start, or null while it is (a freshly
// started watcher gets 30 seconds to say it's ready).
export function processWatcherProblem(): string | null {
  if (watcherReady) return null;
  if (watcherProblem) return watcherProblem;
  return watcher && Date.now() - watcherStartedAt <= 30_000 ? null : "The process watcher hasn't started";
}

// While the watcher isn't working, each sync checks the programs running now instead, so
// renamed copies are still closed within one sync interval.
async function sweepOnce(): Promise<RawEvent[]> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", buildWatcherScript(watcherRulesFile(), process.pid, true)],
    { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 },
  );
  const events: RawEvent[] = [];
  parseEventLines(stdout, events);
  return events;
}

process.on("exit", () => watcher?.kill());

async function writeWatcherRules(rules: AppControlRuleWire[]): Promise<void> {
  const file = watcherRulesFile();
  const next = JSON.stringify(rules);
  const current = await fsp.readFile(file, "utf8").catch(() => null);
  if (current === next) return;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, next, "utf8");
}

/* ------------------------------------------------------------------------------------------
 * Sync (every 20 seconds)
 * ---------------------------------------------------------------------------------------- */

const lastReported = new Map<string, number>();

async function notifyClosed(events: RawEvent[]): Promise<void> {
  for (const e of events) {
    if (!e.closed || !e.sessionId) continue;
    const name = path.win32.basename(e.path);
    await execFileAsync("msg.exe", [String(e.sessionId), "/TIME:60", `${name} was closed: it is blocked by your organisation's IT policy.`]).catch(() => undefined);
  }
}

// Never throws — any failure is caught and reported as a FAILED scan result rather than left silent.
export async function runAppControlScan(client: AxiosInstance): Promise<void> {
  let payload: AppControlScanResultPayload;

  try {
    const { data } = await client.get<AssignedAppControlResponse>("/api/agent/app-control/assigned");
    const safe = data.rules.filter((r) => {
      const problem = appControlRuleProblem(r.ruleType, r.value);
      if (problem) console.warn(`App Control: not applying rule ${r.ruleId} (${r.value}): ${problem}`);
      return !problem;
    });
    // While the desktop safety net has suspended enforcement, nothing is blocked.
    const suspended = isEnforcementSuspended();
    const rules = suspended ? [] : safe;
    // Advanced application control (AppLocker), when the server offers it: DLL and Allow rules.
    const advanced = suspended ? undefined : data.advanced?.rules;
    const allows = (advanced ?? []).filter((r) => r.ruleType === "ALLOW_PATH" && !appControlRuleProblem(r.ruleType, r.value));
    const launchBlocks = new Map<string, string>();
    // A launch block stops a program by name wherever it is, so it can't honour Allow rules:
    // with any Allow rule in force, the process watcher alone closes blocked programs.
    for (const r of allows.length > 0 ? [] : rules) {
      const name = launchBlockName(r);
      if (name && !CRITICAL_WINDOWS_PROCESSES.includes(name) && !launchBlocks.has(name)) launchBlocks.set(name, r.ruleId);
    }

    await fsp.mkdir(APP_CONTROL_DIR, { recursive: true });
    await ensureBlockerFiles();
    await writeWatcherRules(rules.length > 0 ? [...rules, ...allows.map((a) => ({ ...a, value: allowPattern(a.value) }))] : []);
    if (rules.length > 0 || watcher) ensureWatcher();

    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", buildLaunchBlockScript(launchBlocks)],
      { maxBuffer: 1024 * 1024 },
    );
    if (!stdout.includes("APPLIED")) throw new Error(`Unexpected launch-block output: ${stdout.trim()}`);

    // The watcher counts as not working once it has stopped, or hasn't said "ready" within 30s.
    const watcherDown = rules.length > 0 && !watcherReady && (watcherProblem !== null || Date.now() - watcherStartedAt > 30_000);
    let fallback: RawEvent[] = [];
    if (watcherDown) {
      fallback = await sweepOnce().catch((err) => {
        console.error("App Control: fallback check failed", err);
        return [];
      });
    }

    const appLocker = await syncAppLocker(advanced, rules);
    const raw = [...watcherEvents.splice(0), ...fallback, ...(await collectBlockerEvents(launchBlocks)), ...appLocker.events];
    void notifyClosed(raw);
    const now = Date.now();
    const events: AppControlEventPayload[] = [];
    for (const e of raw) {
      const key = e.path.toLowerCase();
      if (now - (lastReported.get(key) ?? 0) < REPORT_EVERY_MS && !e.closed) continue; // a launch retried in a loop
      lastReported.set(key, now);
      events.push({
        ruleId: e.ruleId,
        matchedPath: e.path.slice(0, 1000),
        processName: path.win32.basename(e.path).slice(0, 300),
        occurredAt: e.at,
      });
    }
    if (lastReported.size > 5000) lastReported.clear();

    // Launch blocks are in place either way; a watcher that isn't working shows as Failed on the
    // Sync status tab with its reason, since renamed copies are then only caught every sync.
    const problems = [
      ...(watcherDown
        ? [`${watcherProblem ?? "The process watcher hasn't started"}. Programs named in rules are still stopped at launch; renamed copies are closed at each sync (about every 20 seconds) instead of at once.`]
        : []),
      ...(appLocker.problem ? [`Advanced (AppLocker): ${appLocker.problem}.`] : []),
    ];
    payload = problems.length
      ? { status: "FAILED", errorMessage: problems.join(" ").slice(0, 1000), events: events.slice(-200) }
      : { status: "APPLIED", errorMessage: null, events: events.slice(-200) };
    if (events.length) console.log(`App Control: ${events.length} blocked program(s)`);
  } catch (err) {
    console.error("App Control scan failed", err);
    payload = { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err), events: [] };
  }

  try {
    await client.post("/api/agent/app-control/scan-result", payload);
    console.log(`Reported App Control scan: ${payload.status}`);
  } catch (err) {
    console.error("Failed to report App Control scan result", err);
  }
}

