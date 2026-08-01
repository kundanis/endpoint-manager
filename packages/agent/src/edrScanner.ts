import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import {
  EDR_COMMAND_LINE_RULES,
  EDR_PROCESS_TREE_RULES,
  type EdrDetection,
  type EdrEnabledResponse,
  type EdrPersistenceItem,
  type EdrScanResultPayload,
} from "@em/shared";

const execFileAsync = promisify(execFile);

// Only collects raw data — no rule matching happens here. Matching against
// EDR_PROCESS_TREE_RULES/EDR_COMMAND_LINE_RULES happens in plain TypeScript below,
// which avoids ever having to embed a regex pattern inside a PowerShell string literal
// (fragile escaping, learned the hard way elsewhere in this codebase).
// Same self-protection guard as commandBlockEnforcer.ts: excludes this agent's own
// process id AND anything it directly parents (e.g. this very scan's own PowerShell
// child) so a rule can never end up matching — let alone killing — the agent itself.
function buildDumpScript(ownPid: number): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$ownPid = ${ownPid}

$processes = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $ownPid -and $_.ProcessId -ne $PID -and $_.ParentProcessId -ne $ownPid -and $_.ParentProcessId -ne $PID
} | ForEach-Object {
  $cmd = $_.CommandLine
  if ($cmd -and $cmd.Length -gt 2000) { $cmd = $cmd.Substring(0, 2000) }
  [PSCustomObject]@{
    ProcessId = $_.ProcessId
    ParentProcessId = $_.ParentProcessId
    Name = $_.Name
    CommandLine = $cmd
  }
})

$persistence = @()

$runKeyPaths = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce'
)
foreach ($path in $runKeyPaths) {
  $item = Get-Item -Path $path -ErrorAction SilentlyContinue
  if ($item) {
    foreach ($prop in $item.Property) {
      try {
        $value = (Get-ItemProperty -Path $path -Name $prop -ErrorAction SilentlyContinue).$prop
        $persistence += [PSCustomObject]@{ Location = "RegistryRun:$path"; Name = $prop; Command = "$value" }
      } catch {}
    }
  }
}

Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.StartMode -eq 'Auto' } | ForEach-Object {
  $persistence += [PSCustomObject]@{ Location = 'Service'; Name = $_.Name; Command = $_.PathName }
}

try {
  Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.State -ne 'Disabled' } | ForEach-Object {
    $actionCmd = (($_.Actions | ForEach-Object { $_.Execute }) -join '; ')
    $persistence += [PSCustomObject]@{ Location = 'ScheduledTask'; Name = "$($_.TaskPath)$($_.TaskName)"; Command = $actionCmd }
  }
} catch {}

$result = [PSCustomObject]@{
  Processes = $processes
  Persistence = @($persistence)
}
ConvertTo-Json -InputObject $result -Compress -Depth 4
`;
}

interface RawProcess {
  ProcessId: number;
  ParentProcessId: number | null;
  Name: string;
  CommandLine: string | null;
}

interface RawPersistenceItem {
  Location: string;
  Name: string;
  Command: string | null;
}

interface RawDumpResult {
  Processes?: RawProcess[] | RawProcess | null;
  Persistence?: RawPersistenceItem[] | RawPersistenceItem | null;
}

// PowerShell 5.1's ConvertTo-Json unwraps a single-element array into a bare object —
// the same quirk documented (and worked around) elsewhere in this codebase.
function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function matchDetection(
  p: RawProcess,
  parent: RawProcess | undefined,
): { key: string; label: string; severity: "HIGH" | "MEDIUM" } | null {
  const name = p.Name?.toLowerCase() ?? "";
  const parentName = parent?.Name?.toLowerCase() ?? null;

  if (parentName) {
    for (const rule of EDR_PROCESS_TREE_RULES) {
      if (rule.parentNames.includes(parentName) && rule.childNames.includes(name)) {
        return { key: rule.key, label: rule.label, severity: rule.severity };
      }
    }
  }

  if (p.CommandLine) {
    for (const rule of EDR_COMMAND_LINE_RULES) {
      if (!rule.processNames.includes(name)) continue;
      try {
        if (new RegExp(rule.pattern, "i").test(p.CommandLine)) {
          return { key: rule.key, label: rule.label, severity: rule.severity };
        }
      } catch {
        // Malformed pattern shouldn't happen for built-in content — never let a bad
        // regex crash the whole scan.
      }
    }
  }

  return null;
}

function detectFromProcesses(processes: RawProcess[]): EdrDetection[] {
  const byPid = new Map<number, RawProcess>();
  for (const p of processes) byPid.set(p.ProcessId, p);

  const detections: EdrDetection[] = [];
  for (const p of processes) {
    const parent = p.ParentProcessId != null ? byPid.get(p.ParentProcessId) : undefined;
    const matched = matchDetection(p, parent);
    if (!matched) continue;

    detections.push({
      ruleKey: matched.key,
      ruleLabel: matched.label,
      severity: matched.severity,
      processName: p.Name,
      processId: p.ProcessId,
      parentProcessName: parent?.Name ?? null,
      parentProcessId: p.ParentProcessId,
      commandLine: p.CommandLine,
      killed: matched.severity === "HIGH",
    });
  }
  return detections;
}

// A short window exists between the dump script reading these PIDs and this kill
// running — same best-effort tradeoff already accepted by Command Block's identical
// "catch it running and kill it" model, not a new risk introduced here.
async function killProcesses(pids: number[]): Promise<void> {
  if (pids.length === 0) return;
  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Stop-Process -Id ${pids.join(",")} -Force -ErrorAction SilentlyContinue`,
      ],
      { maxBuffer: 1024 * 1024 },
    );
  } catch (err) {
    console.error("Failed to kill EDR-flagged process(es)", err);
  }
}

export async function runEdrScan(client: AxiosInstance): Promise<void> {
  if (process.platform !== "win32") return;

  try {
    const { data } = await client.get<EdrEnabledResponse>("/api/agent/edr/enabled");
    if (!data.enabled) return;
  } catch (err) {
    console.error("Failed to check EDR enabled status", err);
    return;
  }

  let raw: RawDumpResult;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", buildDumpScript(process.pid)],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    raw = stdout.trim() ? (JSON.parse(stdout.trim()) as RawDumpResult) : {};
  } catch (err) {
    console.error("EDR scan failed", err);
    return;
  }

  const processes = asArray(raw.Processes);
  const detections = detectFromProcesses(processes);

  const highPids = detections.filter((d) => d.killed).map((d) => d.processId);
  await killProcesses(highPids);

  const persistenceSnapshot: EdrPersistenceItem[] = asArray(raw.Persistence)
    .filter((i) => i && i.Name)
    .slice(0, 500)
    .map((i) => ({ location: i.Location, name: i.Name, command: i.Command ?? null }));

  const payload: EdrScanResultPayload = {
    scannedAt: new Date().toISOString(),
    detections,
    persistenceSnapshot,
  };

  try {
    await client.post("/api/agent/edr/scan-result", payload);
    if (detections.length > 0) {
      console.log(`EDR scan reported ${detections.length} detection(s)`);
    }
  } catch (err) {
    console.error("Failed to report EDR scan result", err);
  }
}
