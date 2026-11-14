import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type {
  AssignedThreatProtectionWire,
  DefenderMode,
  EndpointProtectionStatusPayload,
  ThreatActionTaskWire,
  ThreatDetectionPayload,
  ThreatProtectionReport,
  ThreatProtectionSettingsWire,
  ThreatScanTaskWire,
  ThreatSeverity,
  ThreatStatus,
  ThreatTaskResult,
} from "@em/shared";
import { agentConfig } from "./config";

const execFileAsync = promisify(execFile);

// Threat Protection: Microsoft Defender managed from the console (runs as SYSTEM).
//  - reports Defender's state and the threats it found (every 5 minutes, and straight after a
//    scan or action);
//  - applies the assigned policy's Defender settings and reads them back, so a setting Windows
//    refused (Tamper Protection, Group Policy, Intune) shows on the policy's Sync status. Policy
//    switches only turn protection ON - a policy never switches Defender protection off;
//  - adds the policy's exclusions with Add-MpPreference and remembers which ones it added, so it
//    only ever removes its own (never the agent's data folder or the company's own exclusions);
//  - runs scans and actions an admin requested, one at a time, and reports each result.
// Nothing happens unless the server says this deployment includes Threat Protection.

export const THREAT_PROTECTION_INTERVAL_MS = 5 * 60 * 1000;
const REAPPLY_MS = 60 * 60 * 1000; // re-assert settings hourly even when unchanged
const SCAN_TIMEOUT_MS = 12 * 60 * 60 * 1000;

interface SavedState {
  hash: string | null;
  appliedAt: number;
  problems: string[];
  added: { paths: string[]; extensions: string[]; processes: string[] };
}

const EMPTY_ADDED = { paths: [], extensions: [], processes: [] };
const stateFile = () => path.join(agentConfig.stateDir, "threat-protection-state.json");

async function readState(): Promise<SavedState> {
  try {
    const s = JSON.parse(await fsp.readFile(stateFile(), "utf8")) as SavedState;
    return { hash: s.hash ?? null, appliedAt: s.appliedAt ?? 0, problems: s.problems ?? [], added: { ...EMPTY_ADDED, ...s.added } };
  } catch {
    return { hash: null, appliedAt: 0, problems: [], added: { ...EMPTY_ADDED } };
  }
}

async function writeState(s: SavedState): Promise<void> {
  await fsp.mkdir(agentConfig.stateDir, { recursive: true });
  await fsp.writeFile(stateFile(), JSON.stringify(s), "utf8");
}

async function runPs(script: string, env: Record<string, string> = {}, timeout = 120_000): Promise<string> {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: { ...process.env, ...env },
    maxBuffer: 8 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
  return stdout;
}

const lastJsonLine = (out: string) => out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).pop() ?? "{}";

// ---- Status and threats -------------------------------------------------------------------

const STATUS_PS = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
function Iso($d) { if ($d -and ($d -is [datetime]) -and $d.Year -gt 2000) { $d.ToUniversalTime().ToString('o') } else { $null } }
$r = [ordered]@{ products = @(); mode = 'UNKNOWN'; detections = @() }
foreach ($a in @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct)) {
  if ($a) { $st = [int]$a.productState; $r.products += [ordered]@{ name = [string]$a.displayName; enabled = (($st -band 0x1000) -ne 0); upToDate = (($st -band 0x10) -eq 0) } }
}
$s = Get-MpComputerStatus
$p = Get-MpPreference
if (-not $s) {
  $r.mode = if (Get-Service WinDefend) { 'DISABLED' } else { 'NOT_INSTALLED' }
} else {
  $m = [string]$s.AMRunningMode
  $r.mode = if ($m -match 'EDR') { 'EDR_BLOCK' } elseif ($m -match 'Passive') { 'PASSIVE' } elseif (-not $s.AntivirusEnabled) { 'DISABLED' } else { 'ACTIVE' }
  $r.realTimeOn = [bool]$s.RealTimeProtectionEnabled
  $r.behaviorMonitorOn = [bool]$s.BehaviorMonitorEnabled
  $r.tamperProtected = if ($null -ne $s.IsTamperProtected) { [bool]$s.IsTamperProtected } else { $null }
  $r.productVersion = [string]$s.AMProductVersion
  $r.engineVersion = [string]$s.AMEngineVersion
  $r.signatureVersion = [string]$s.AntivirusSignatureVersion
  $r.signatureUpdatedAt = Iso $s.AntivirusSignatureLastUpdated
  $r.lastQuickScanAt = Iso $s.QuickScanEndTime
  $r.lastFullScanAt = Iso $s.FullScanEndTime
}
if ($p) { $r.cloudProtectionOn = ([int]$p.MAPSReporting -gt 0); $r.puaProtectionOn = ([int]$p.PUAProtection -eq 1) }
$ext = $false
foreach ($k in 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender', 'HKLM:\SOFTWARE\Microsoft\PolicyManager\current\device\Defender') {
  $item = Get-Item $k
  if ($item) { if ($item.ValueCount -gt 0 -or @(Get-ChildItem $k -Recurse | Where-Object { $_.ValueCount -gt 0 }).Count -gt 0) { $ext = $true } }
}
$r.externallyManaged = $ext
if ($s) {
  $threats = @{}
  foreach ($t in @(Get-MpThreat)) { if ($t) { $threats[[string]$t.ThreatID] = $t } }
  $since = (Get-Date).AddDays(-90)
  foreach ($d in @(Get-MpThreatDetection | Sort-Object InitialDetectionTime -Descending | Select-Object -First 300)) {
    if (-not $d) { continue }
    $last = $d.LastThreatStatusChangeTime; if (-not $last) { $last = $d.InitialDetectionTime }
    if ($last -and $last -lt $since) { continue }
    $t = $threats[[string]$d.ThreatID]
    $r.detections += [ordered]@{
      id = [string]$d.DetectionID; threatId = [string]$d.ThreatID
      name = $(if ($t) { [string]$t.ThreatName } else { $null }); severity = $(if ($t) { [int]$t.SeverityID } else { 0 })
      active = $(if ($t) { [bool]$t.IsActive } else { $false })
      status = [int]$d.ThreatStatusID; actionSuccess = [bool]$d.ActionSuccess
      resources = @($d.Resources | ForEach-Object { [string]$_ }); process = [string]$d.ProcessName; user = [string]$d.DomainUser
      first = Iso $d.InitialDetectionTime; last = Iso $last
    }
  }
}
$r | ConvertTo-Json -Depth 6 -Compress
`;

interface RawDetection {
  id: string;
  threatId: string;
  name: string | null;
  severity: number;
  active: boolean;
  status: number;
  actionSuccess: boolean;
  resources: string[] | string | null;
  process: string;
  user: string;
  first: string | null;
  last: string | null;
}

interface RawStatus {
  products?: { name: string; enabled: boolean; upToDate: boolean }[] | { name: string; enabled: boolean; upToDate: boolean };
  mode?: DefenderMode;
  realTimeOn?: boolean;
  behaviorMonitorOn?: boolean;
  cloudProtectionOn?: boolean;
  puaProtectionOn?: boolean;
  tamperProtected?: boolean | null;
  externallyManaged?: boolean;
  productVersion?: string;
  engineVersion?: string;
  signatureVersion?: string;
  signatureUpdatedAt?: string | null;
  lastQuickScanAt?: string | null;
  lastFullScanAt?: string | null;
  detections?: RawDetection[] | RawDetection;
}

const SEVERITY: Record<number, ThreatSeverity> = { 1: "LOW", 2: "MODERATE", 4: "HIGH", 5: "SEVERE" };

// Defender's ThreatStatusID, as a status and the words shown in the console.
function detectionStatus(d: RawDetection): { status: ThreatStatus; detail: string } {
  switch (d.status) {
    case 1:
      return { status: "ACTIVE", detail: "Detected, not yet cleaned" };
    case 2:
      return { status: "REMOVED", detail: "Cleaned by Defender" };
    case 3:
      return { status: "QUARANTINED", detail: "Quarantined by Defender" };
    case 4:
      return { status: "REMOVED", detail: "Removed by Defender" };
    case 5:
      return { status: "ALLOWED", detail: "Allowed" };
    case 6:
      return { status: "RESOLVED", detail: "Blocked by Defender" };
    case 102:
      return { status: "FAILED", detail: "Defender couldn't quarantine it" };
    case 103:
      return { status: "FAILED", detail: "Defender couldn't remove it" };
    case 104:
      return { status: "FAILED", detail: "Defender couldn't allow it" };
    case 105:
      return { status: "FAILED", detail: "Defender gave up on it" };
    case 107:
      return { status: "FAILED", detail: "Defender couldn't block it" };
    default:
      return d.active ? { status: "ACTIVE", detail: "Detected" } : { status: "RESOLVED", detail: "No longer active" };
  }
}

const arr = <T>(v: T[] | T | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: string | null | undefined, max: number) => (v && v.trim() && v.trim().toLowerCase() !== "unknown" ? v.trim().slice(0, max) : null);

function toDetection(d: RawDetection): ThreatDetectionPayload {
  const resources = arr(d.resources).map(String).filter(Boolean);
  const file = resources.find((r) => r.toLowerCase().startsWith("file:_"));
  const { status, detail } = detectionStatus(d);
  const name = d.name?.trim() || `Unknown threat (ID ${d.threatId})`;
  return {
    externalKey: d.id.slice(0, 200),
    threatName: name.slice(0, 300),
    defenderThreatId: /^\d+$/.test(d.threatId) ? d.threatId : null,
    severity: SEVERITY[d.severity] ?? "UNKNOWN",
    category: name.includes(":") ? name.slice(0, name.indexOf(":")).slice(0, 100) : null, // "Trojan:Win32/..." -> Trojan
    filePath: file ? file.slice(6).slice(0, 1000) : null,
    resources: resources.slice(0, 50).map((r) => r.slice(0, 1000)),
    username: str(d.user, 200),
    processName: str(d.process, 300),
    status,
    actionDetail: detail,
    detectedAt: d.first ?? d.last ?? new Date().toISOString(),
    lastSeenAt: d.last ?? d.first ?? new Date().toISOString(),
  };
}

async function collectStatus(): Promise<{ status: EndpointProtectionStatusPayload; detections: ThreatDetectionPayload[] } | null> {
  const raw = JSON.parse(lastJsonLine(await runPs(STATUS_PS, {}, 180_000))) as RawStatus;
  if (!raw.mode) return null;
  return {
    status: {
      antivirusProducts: arr(raw.products).slice(0, 10).map((p) => ({ name: String(p.name ?? "").slice(0, 200), enabled: p.enabled ?? null, upToDate: p.upToDate ?? null })),
      defenderMode: raw.mode,
      realTimeOn: raw.realTimeOn ?? null,
      behaviorMonitorOn: raw.behaviorMonitorOn ?? null,
      cloudProtectionOn: raw.cloudProtectionOn ?? null,
      puaProtectionOn: raw.puaProtectionOn ?? null,
      tamperProtected: raw.tamperProtected ?? null,
      externallyManaged: !!raw.externallyManaged,
      productVersion: str(raw.productVersion, 50),
      engineVersion: str(raw.engineVersion, 50),
      signatureVersion: str(raw.signatureVersion, 50),
      signatureUpdatedAt: raw.signatureUpdatedAt ?? null,
      lastQuickScanAt: raw.lastQuickScanAt ?? null,
      lastFullScanAt: raw.lastFullScanAt ?? null,
    },
    detections: arr(raw.detections).filter((d) => d && d.id).map(toDetection),
  };
}

// ---- Settings -----------------------------------------------------------------------------

// $env:EIQ_TP_SETTINGS: the settings to apply, or "null" to only take our exclusions back out.
// $env:EIQ_TP_ADDED: the exclusions this agent added before. Prints { problems, added }.
const APPLY_PS = String.raw`
$ErrorActionPreference = 'Stop'
$want = $env:EIQ_TP_SETTINGS | ConvertFrom-Json
$prev = $env:EIQ_TP_ADDED | ConvertFrom-Json
$problems = New-Object System.Collections.Generic.List[string]
function Step([string]$what, [scriptblock]$do) { try { & $do } catch { $problems.Add("$($what): $($_.Exception.Message)") } }
if ($want) {
  if ($want.realTimeProtection) { Step 'Real-time protection' { Set-MpPreference -DisableRealtimeMonitoring $false -DisableBehaviorMonitoring $false -DisableIOAVProtection $false } }
  if ($want.cloudProtection) { Step 'Cloud protection' { Set-MpPreference -MAPSReporting 2 -DisableBlockAtFirstSeen $false } }
  Step 'Sample submission' { Set-MpPreference -SubmitSamplesConsent $(if ($want.submitSamples) { 1 } else { 2 }) }
  if ($want.puaProtection) { Step 'Potentially unwanted apps' { Set-MpPreference -PUAProtection 1 } }
  Step 'Scheduled scan' { Set-MpPreference -ScanParameters $(if ($want.scanType -eq 'FULL') { 2 } else { 1 }) -ScanScheduleDay ([int]$want.scanScheduleDay) -ScanScheduleTime "$($want.scanScheduleTime):00" }
  Step 'Signature updates' { Set-MpPreference -SignatureUpdateInterval ([int]$want.signatureUpdateHours) }
}
$p = Get-MpPreference
$added = [ordered]@{}
foreach ($spec in @(@('paths', 'ExclusionPath', 'excludedPaths'), @('extensions', 'ExclusionExtension', 'excludedExtensions'), @('processes', 'ExclusionProcess', 'excludedProcesses'))) {
  $key = $spec[0]; $param = $spec[1]
  $wanted = @(); if ($want) { $wanted = @($want.($spec[2]) | Where-Object { $_ } | ForEach-Object { [string]$_ }) }
  $before = @($prev.$key | Where-Object { $_ } | ForEach-Object { [string]$_ })
  $current = @($p.$param | Where-Object { $_ } | ForEach-Object { [string]$_ })
  $mine = @()
  foreach ($w in $wanted) {
    $ours = $before -contains $w
    if (-not $ours -and ($current -contains $w)) { continue }  # already there and not ours: leave it alone, never remove it later
    if ($current -notcontains $w) {
      try { $h = @{ $param = $w }; Add-MpPreference @h } catch { $problems.Add("Exclusion $($w): $($_.Exception.Message)"); if (-not $ours) { continue } }
    }
    $mine += $w
  }
  foreach ($b in $before) {
    if ($wanted -notcontains $b) { try { $h = @{ $param = $b }; Remove-MpPreference @h } catch { $problems.Add("Removing exclusion $($b): $($_.Exception.Message)"); $mine += $b } }
  }
  $added[$key] = @($mine)
}
if ($want) {
  $p = Get-MpPreference
  $held = 'Windows kept its own setting (Tamper Protection, Group Policy or Intune controls it)'
  if ($want.realTimeProtection -and $p.DisableRealtimeMonitoring) { $problems.Add("Real-time protection is still off: $held") }
  if ($want.cloudProtection -and [int]$p.MAPSReporting -eq 0) { $problems.Add("Cloud protection is still off: $held") }
  if ($want.puaProtection -and [int]$p.PUAProtection -ne 1) { $problems.Add("Potentially unwanted app blocking is still off: $held") }
  if ([int]$p.SignatureUpdateInterval -ne [int]$want.signatureUpdateHours) { $problems.Add("Signature update interval is $($p.SignatureUpdateInterval) hours: $held") }
}
[ordered]@{ problems = @($problems); added = $added } | ConvertTo-Json -Depth 4 -Compress
`;

async function applySettings(settings: ThreatProtectionSettingsWire | null, state: SavedState): Promise<SavedState> {
  const out = await runPs(APPLY_PS, { EIQ_TP_SETTINGS: JSON.stringify(settings), EIQ_TP_ADDED: JSON.stringify(state.added) });
  const res = JSON.parse(lastJsonLine(out)) as { problems?: string[] | string; added?: Partial<Record<"paths" | "extensions" | "processes", string[] | string>> };
  return {
    hash: settings ? createHash("sha256").update(JSON.stringify(settings)).digest("hex") : null,
    appliedAt: Date.now(),
    problems: arr(res.problems).map(String),
    added: { paths: arr(res.added?.paths).map(String), extensions: arr(res.added?.extensions).map(String), processes: arr(res.added?.processes).map(String) },
  };
}

const hasAdded = (s: SavedState) => s.added.paths.length + s.added.extensions.length + s.added.processes.length > 0;

// ---- Scans and actions --------------------------------------------------------------------

const SCAN_PS = String.raw`
$ErrorActionPreference = 'Stop'
if ($env:EIQ_SCAN_TYPE -eq 'CUSTOM') {
  foreach ($path in @($env:EIQ_SCAN_PATHS | ConvertFrom-Json)) { if (Test-Path -LiteralPath $path) { Start-MpScan -ScanType CustomScan -ScanPath $path } else { Write-Output "Skipped (not found): $path" } }
} elseif ($env:EIQ_SCAN_TYPE -eq 'FULL') { Start-MpScan -ScanType FullScan } else { Start-MpScan -ScanType QuickScan }
'Scan finished'
`;

const RESTORE_PS = String.raw`
$mp = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
$o = & $mp -Restore -Name $env:EIQ_THREAT_NAME 2>&1
$text = (@($o) | ForEach-Object { [string]$_ } | Where-Object { $_.Trim() }) -join ' '
if ($LASTEXITCODE -ne 0) { throw "MpCmdRun exit code $($LASTEXITCODE): $text" }
"Restored. $text"
`;

const ACTION_PS: Record<ThreatActionTaskWire["action"], string> = {
  REMOVE: "$ErrorActionPreference = 'Stop'; Remove-MpThreat; 'Defender removed the active threats on this endpoint'",
  UPDATE_SIGNATURES: "$ErrorActionPreference = 'Stop'; Update-MpSignature; 'Signatures updated to ' + (Get-MpComputerStatus).AntivirusSignatureVersion",
  RESTORE: RESTORE_PS,
  ALLOW: String.raw`
$ErrorActionPreference = 'Stop'
Add-MpPreference -ThreatIDDefaultAction_Ids ([int64]$env:EIQ_THREAT_ID) -ThreatIDDefaultAction_Actions Allow
try { ${RESTORE_PS} } catch { 'Allowed on this endpoint (nothing in quarantine to restore)' }
`,
};

async function reportTask(client: AxiosInstance, result: ThreatTaskResult): Promise<void> {
  await client.post("/api/agent/threat-protection/task-result", result).catch((err) => console.error("Threat Protection: reporting a task result failed", (err as Error).message));
}

const tail = (err: unknown) => {
  const e = err as { stderr?: string; message?: string };
  return (e.stderr?.trim() || e.message || String(err)).replace(/\s+/g, " ").slice(-900);
};

let taskChain: Promise<void> = Promise.resolve();
const queued = new Set<string>();

function enqueueTasks(client: AxiosInstance, scans: ThreatScanTaskWire[], actions: ThreatActionTaskWire[]): void {
  for (const a of actions) {
    if (queued.has(a.id)) continue;
    queued.add(a.id);
    taskChain = taskChain.then(async () => {
      try {
        if ((a.action === "RESTORE" || a.action === "ALLOW") && (!a.threatName || !a.defenderThreatId)) throw new Error("The threat's name or ID is missing");
        const out = await runPs(ACTION_PS[a.action], { EIQ_THREAT_NAME: a.threatName ?? "", EIQ_THREAT_ID: a.defenderThreatId ?? "" }, a.action === "UPDATE_SIGNATURES" ? 20 * 60_000 : 10 * 60_000);
        await reportTask(client, { kind: "ACTION", id: a.id, status: "DONE", message: out.trim().replace(/\s+/g, " ").slice(0, 1000) || "Done" });
      } catch (err) {
        await reportTask(client, { kind: "ACTION", id: a.id, status: "FAILED", message: tail(err) });
      }
      void runThreatProtectionSync(client, { reportOnly: true });
    });
  }
  for (const s of scans) {
    if (queued.has(s.id)) continue;
    queued.add(s.id);
    taskChain = taskChain.then(async () => {
      console.log(`Threat Protection: ${s.scanType.toLowerCase()} scan started`);
      try {
        const out = await runPs(SCAN_PS, { EIQ_SCAN_TYPE: s.scanType, EIQ_SCAN_PATHS: JSON.stringify(s.paths) }, SCAN_TIMEOUT_MS);
        await reportTask(client, { kind: "SCAN", id: s.id, status: "DONE", message: out.trim().replace(/\s+/g, " ").slice(0, 1000) || "Scan finished" });
      } catch (err) {
        await reportTask(client, { kind: "SCAN", id: s.id, status: "FAILED", message: tail(err) });
      }
      void runThreatProtectionSync(client, { reportOnly: true });
    });
  }
}

// ---- Sync ---------------------------------------------------------------------------------

let syncing = false;

export async function runThreatProtectionSync(client: AxiosInstance, opts: { reportOnly?: boolean } = {}): Promise<void> {
  if (process.platform !== "win32" || syncing) return;
  syncing = true;
  try {
    let assigned: AssignedThreatProtectionWire;
    try {
      assigned = (await client.get<AssignedThreatProtectionWire>("/api/agent/threat-protection/assigned")).data;
    } catch (err) {
      // An older server has no such endpoint: nothing to do.
      if ((err as { response?: { status?: number } }).response?.status === 404) return;
      throw err;
    }
    let state = await readState();

    if (!assigned.available) {
      // Not (or no longer) part of this deployment: take back only what this agent added.
      if (hasAdded(state)) {
        state = await applySettings(null, state);
        await writeState(state);
      }
      return;
    }

    const collected = await collectStatus();
    const defenderActive = collected?.status.defenderMode === "ACTIVE";
    let syncStatus: ThreatProtectionReport["syncStatus"] = null;
    let syncError: string | null = null;

    if (!opts.reportOnly) {
      if (assigned.settings && defenderActive) {
        const hash = createHash("sha256").update(JSON.stringify(assigned.settings)).digest("hex");
        if (state.hash !== hash || Date.now() - state.appliedAt > REAPPLY_MS) {
          state = await applySettings(assigned.settings, state);
          await writeState(state);
          console.log(`Threat Protection: Defender settings applied${state.problems.length ? ` with ${state.problems.length} problem(s)` : ""}`);
        }
      } else if (!assigned.settings && (hasAdded(state) || state.hash)) {
        state = await applySettings(null, state);
        await writeState(state);
      }
    }

    if (assigned.policyIds.length > 0) {
      if (!collected) {
        syncStatus = "FAILED";
        syncError = "Couldn't read Microsoft Defender's status on this endpoint.";
      } else if (!defenderActive) {
        const other = collected.status.antivirusProducts.filter((p) => !/defender/i.test(p.name) && p.enabled).map((p) => p.name);
        syncStatus = "FAILED";
        syncError =
          collected.status.defenderMode === "PASSIVE" || collected.status.defenderMode === "EDR_BLOCK"
            ? `Another antivirus is protecting this endpoint${other.length ? ` (${other.join(", ")})` : ""}, so Microsoft Defender is passive and its settings aren't applied.`
            : collected.status.defenderMode === "NOT_INSTALLED"
              ? "Microsoft Defender isn't installed on this endpoint."
              : "Microsoft Defender is turned off on this endpoint, so its settings aren't applied.";
      } else {
        syncStatus = state.problems.length > 0 ? "FAILED" : "SUCCESS";
        syncError = state.problems.length > 0 ? state.problems.join("; ").slice(0, 2000) : null;
      }
    }

    const report: ThreatProtectionReport = {
      status: collected?.status ?? null,
      detections: collected?.detections.slice(0, 500) ?? [],
      policyIds: assigned.policyIds,
      syncStatus,
      syncError,
    };
    await client.post("/api/agent/threat-protection/report", report);

    if (!opts.reportOnly && (assigned.scanTasks.length > 0 || assigned.actionTasks.length > 0)) {
      if (!collected || collected.status.defenderMode === "NOT_INSTALLED") {
        for (const s of assigned.scanTasks) await reportTask(client, { kind: "SCAN", id: s.id, status: "FAILED", message: "Microsoft Defender isn't available on this endpoint." });
        for (const a of assigned.actionTasks) await reportTask(client, { kind: "ACTION", id: a.id, status: "FAILED", message: "Microsoft Defender isn't available on this endpoint." });
      } else {
        enqueueTasks(client, assigned.scanTasks, assigned.actionTasks);
      }
    }
  } finally {
    syncing = false;
  }
}
