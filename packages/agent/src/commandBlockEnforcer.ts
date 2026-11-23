import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AssignedCommandBlockResponse, CommandBlockEventPayload, CommandBlockRuleWire, CommandBlockSyncResultPayload } from "@em/shared";
import { COMMAND_BLOCK_KILLABLE_WINDOWS_TOOLS, COMMAND_BLOCK_MAX_KILLS_PER_SCAN, COMMAND_BLOCK_PROTECTED_PROCESS_NAMES, commandBlockRuleProblem } from "@em/shared";
import { commandRulesFile } from "./appControlPaths";
import { drainCommandWatcherEvents, ensureProcessWatcher, processWatcherProblem } from "./appControlEnforcer";
import { AGENT_INSTALL_DIR, psEscape } from "./secureFs";

const execFileAsync = promisify(execFile);

interface RawMatch {
  RuleId: string;
  MatchedCommandLine: string;
  ProcessName: string | null;
  Action: "ALERTED" | "BLOCKED";
  OccurredAt: string;
}

// Explicit safety guards, in order of evaluation: (1) excludes this agent's own process id
// AND any process parented by it (e.g. the short-lived PowerShell child this very scan
// spawns) — a broad or careless rule can never kill the endpoint-manager agent itself; (2)
// excludes any process whose name is in COMMAND_BLOCK_PROTECTED_PROCESS_NAMES regardless of
// rule content — browsers and core OS/shell processes can never be matched at all, closing
// off the "endpoint hangs / browser won't open" failure mode even from an overly broad regex
// or a mistaken exact-name rule. $PID inside the script is that PowerShell child's own id.
//
// Match semantics branch on ruleType: COMMAND_PATTERN is a regex against the full command
// line (most powerful, most false-positive risk); EXACT_COMMAND_LINE and PROCESS_NAME are
// precise case-insensitive exact-string comparisons against the command line / bare exe name
// respectively, for admins who want to avoid regex risk entirely.
//
// enforcementMode gates the kill, not the detection: a match is always recorded as an event
// (ALERTED or BLOCKED), but Stop-Process only runs when the rule's resolved mode is BLOCK —
// so ALERT_ONLY policies can be safely tested against real traffic before being flipped live.
function buildScanScript(rules: CommandBlockRuleWire[], ownPid: number): string {
  const rulesLiteral = rules
    .map(
      (r) =>
        `  @{ RuleId = '${psEscape(r.ruleId)}'; RuleType = '${psEscape(r.ruleType)}'; Pattern = '${psEscape(r.pattern)}'; EnforcementMode = '${psEscape(r.enforcementMode)}' }`,
    )
    .join(",\n");
  const protectedNamesLiteral = COMMAND_BLOCK_PROTECTED_PROCESS_NAMES.map((n) => `'${psEscape(n)}'`).join(", ");
  const killableToolsLiteral = COMMAND_BLOCK_KILLABLE_WINDOWS_TOOLS.map((n) => `'${psEscape(n)}'`).join(", ");

  return `
$ErrorActionPreference = 'SilentlyContinue'
$ownPid = ${ownPid}
$protectedNames = @(${protectedNamesLiteral})
$maxKills = ${COMMAND_BLOCK_MAX_KILLS_PER_SCAN}
$kills = 0
# Anything running from the Windows folder (System32, SysWOW64, SystemApps, WinSxS...) is part of
# Windows and is never matched, whatever the rule says.
$windowsDir = ($env:SystemRoot.TrimEnd('\\') + '\\').ToLowerInvariant()
$killableTools = @(${killableToolsLiteral}) # script hosts and attack tools may still be matched
$rules = @(
${rulesLiteral}
)
# The agent's own scripts: PowerShell running a script file from the locked install folder, with
# no command of its own on the command line (anyone can type the folder's name into a command).
$agentScript = '-file "${psEscape(AGENT_INSTALL_DIR.toLowerCase())}\\'
function Test-AgentScript($p) {
  if (-not $p.CommandLine -or $p.Name -ne 'powershell.exe') { return $false }
  $lc = $p.CommandLine.ToLowerInvariant()
  return $lc.Contains($agentScript) -and -not [regex]::IsMatch($lc, '\\s[-/](c\\w*|e|ec|en\\w*)(\\s|$)')
}

$matches = @()
$all = @(Get-CimInstance Win32_Process)
# The agent, this scan and everything they started (deployments, scripts) are never matched.
$agentTree = New-Object 'System.Collections.Generic.HashSet[int]'
[void]$agentTree.Add($ownPid)
[void]$agentTree.Add($PID)
do {
  $added = 0
  foreach ($p in $all) { if (-not $agentTree.Contains([int]$p.ProcessId) -and $agentTree.Contains([int]$p.ParentProcessId)) { [void]$agentTree.Add([int]$p.ProcessId); $added++ } }
} while ($added -gt 0)
$processes = $all | Where-Object {
  -not $agentTree.Contains([int]$_.ProcessId) -and ($protectedNames -notcontains $_.Name.ToLowerInvariant()) -and -not ($_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant().StartsWith($windowsDir) -and ($killableTools -notcontains $_.Name.ToLowerInvariant())) -and -not (Test-AgentScript $_)
}

foreach ($proc in $processes) {
  if ([string]::IsNullOrEmpty($proc.CommandLine)) { continue }
  foreach ($rule in $rules) {
    $isMatch = $false
    try {
      switch ($rule.RuleType) {
        'COMMAND_PATTERN' {
          $isMatch = [regex]::IsMatch($proc.CommandLine, $rule.Pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        }
        'EXACT_COMMAND_LINE' {
          $isMatch = $proc.CommandLine.Trim().Equals($rule.Pattern.Trim(), [System.StringComparison]::OrdinalIgnoreCase)
        }
        'PROCESS_NAME' {
          $isMatch = $proc.Name.Equals($rule.Pattern, [System.StringComparison]::OrdinalIgnoreCase)
        }
      }
    } catch {
      $isMatch = $false
    }
    if ($isMatch) {
      $cmdLine = $proc.CommandLine
      if ($cmdLine.Length -gt 2000) { $cmdLine = $cmdLine.Substring(0, 2000) }
      $action = if ($rule.EnforcementMode -eq 'BLOCK') { 'BLOCKED' } else { 'ALERTED' }
      $matches += [PSCustomObject]@{
        RuleId = $rule.RuleId
        MatchedCommandLine = $cmdLine
        ProcessName = $proc.Name
        Action = $action
        OccurredAt = (Get-Date).ToUniversalTime().ToString('o')
      }
      if ($rule.EnforcementMode -eq 'BLOCK') {
        if ($kills -lt $maxKills) {
          Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
          $kills++
        } else {
          $matches[-1].Action = 'ALERTED' # over the per-scan cap: reported, not killed
        }
      }
      break
    }
  }
}

if ($matches.Count -eq 0) {
  Write-Output '[]'
} else {
  Write-Output (ConvertTo-Json -InputObject $matches -Compress -Depth 3)
}
`;
}

// The policy's Sync status tab: whether this device scanned with the current rules.
async function reportSync(client: AxiosInstance, status: "SUCCESS" | "FAILED", errorMessage: string | null): Promise<void> {
  const payload: CommandBlockSyncResultPayload = { status, errorMessage: errorMessage?.slice(0, 1000) ?? null };
  await client.post("/api/agent/command-block/scan-result", payload).catch((err) => console.error("Failed to report Command Block sync", err));
}

// Writes the rules the process watcher (appControlEnforcer.ts) enforces the moment a command
// starts; "[]" stops it.
async function writeWatcherCommandRules(rules: CommandBlockRuleWire[]): Promise<void> {
  const file = commandRulesFile();
  const next = JSON.stringify(rules.filter((r) => r.enforcementMode === "BLOCK"));
  const current = await fsp.readFile(file, "utf8").catch(() => null);
  if (current === next) return;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, next, "utf8");
}

// Never throws — any failure is caught and logged. The process watcher closes a matching command
// the moment it starts; this 20-second scan is the backstop (and closes anything already running).
// Every scan reports its sync status; blocked commands are reported as events. Protections are
// always enforced: the desktop safety net doesn't weaken them (they never touch the desktop), but
// pausing an endpoint or Emergency release does - the server then sends no rules.
export async function runCommandBlockScan(client: AxiosInstance): Promise<void> {
  let assigned: AssignedCommandBlockResponse;
  try {
    const { data } = await client.get<AssignedCommandBlockResponse>("/api/agent/command-block/assigned");
    assigned = data;
  } catch (err) {
    console.error("Failed to fetch assigned Command Block rules", err);
    return;
  }

  if (assigned.rules.length === 0) {
    await writeWatcherCommandRules([]).catch(() => undefined);
    return; // nothing assigned: no sync status to report
  }

  // Rules that would match Windows itself are never used, even if the server sent them.
  const assignedCount = assigned.rules.length;
  assigned = {
    ...assigned,
    rules: assigned.rules.filter((r) => {
      const problem = commandBlockRuleProblem(r.ruleType, r.pattern);
      if (problem) console.warn(`Command Block: not applying rule ${r.ruleId}: ${problem}`);
      return !problem;
    }),
  };
  await writeWatcherCommandRules(assigned.rules).catch((err) => console.error("Command Block: couldn't hand rules to the process watcher", err));
  if (assigned.rules.length === 0) {
    await reportSync(client, "FAILED", `All ${assignedCount} rule(s) were refused on this device because they would match Windows itself.`);
    return;
  }
  ensureProcessWatcher();

  const fromWatcher: CommandBlockEventPayload[] = drainCommandWatcherEvents()
    .filter((e) => e.ruleId)
    .map((e) => ({
      ruleId: e.ruleId!,
      matchedCommandLine: (e.commandLine ?? e.path).slice(0, 2000),
      processName: path.win32.basename(e.path),
      action: e.closed ? ("BLOCKED" as const) : ("ALERTED" as const),
      occurredAt: e.at,
    }));

  let events: CommandBlockEventPayload[];
  try {
    const script = buildScanScript(assigned.rules, process.pid);
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { maxBuffer: 1024 * 1024 },
    );

    const parsed: unknown = JSON.parse(stdout.trim() || "[]");
    // PowerShell 5.1's ConvertTo-Json unwraps a single-element array into a bare object.
    const rawMatches = (Array.isArray(parsed) ? parsed : [parsed]) as RawMatch[];
    events = rawMatches
      .filter((m) => m && m.RuleId)
      .map((m) => ({
        ruleId: m.RuleId,
        matchedCommandLine: m.MatchedCommandLine,
        processName: m.ProcessName ?? null,
        action: m.Action,
        occurredAt: m.OccurredAt,
      }));
  } catch (err) {
    console.error("Command Block scan failed", err);
    await reportSync(client, "FAILED", err instanceof Error ? err.message : String(err));
    events = [];
  }

  const problem = processWatcherProblem();
  await reportSync(
    client,
    problem ? "FAILED" : "SUCCESS",
    problem ? `${problem}. Blocked commands are closed at each scan (about every 20 seconds) instead of the moment they start.` : null,
  );

  events = [...fromWatcher, ...events];
  if (events.length === 0) return;
  try {
    for (let i = 0; i < events.length; i += 200) {
      await client.post("/api/agent/command-block/events", { events: events.slice(i, i + 200) });
    }
    console.log(`Reported ${events.length} Command Block event(s)`);
  } catch (err) {
    console.error("Failed to report Command Block events", err);
  }
}
