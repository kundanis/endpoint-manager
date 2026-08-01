import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AssignedCommandBlockResponse, CommandBlockEventPayload, CommandBlockRuleWire } from "@em/shared";
import { COMMAND_BLOCK_PROTECTED_PROCESS_NAMES } from "@em/shared";

const execFileAsync = promisify(execFile);

function psEscape(value: string): string {
  return value.replace(/'/g, "''");
}

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

  return `
$ErrorActionPreference = 'SilentlyContinue'
$ownPid = ${ownPid}
$protectedNames = @(${protectedNamesLiteral})
$rules = @(
${rulesLiteral}
)

$matches = @()
$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $ownPid -and $_.ProcessId -ne $PID -and $_.ParentProcessId -ne $ownPid -and $_.ParentProcessId -ne $PID -and ($protectedNames -notcontains $_.Name)
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
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
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

// Never throws — any failure is caught and logged; there is no sync-status to report back
// for this module (unlike webBlock), since a scan producing zero matches is not itself
// meaningful telemetry. Skips the WMI query entirely when no rules are assigned.
export async function runCommandBlockScan(client: AxiosInstance): Promise<void> {
  let assigned: AssignedCommandBlockResponse;
  try {
    const { data } = await client.get<AssignedCommandBlockResponse>("/api/agent/command-block/assigned");
    assigned = data;
  } catch (err) {
    console.error("Failed to fetch assigned Command Block rules", err);
    return;
  }

  if (assigned.rules.length === 0) return;

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
    return;
  }

  if (events.length === 0) return;

  try {
    await client.post("/api/agent/command-block/events", { events });
    console.log(`Reported ${events.length} Command Block event(s)`);
  } catch (err) {
    console.error("Failed to report Command Block events", err);
  }
}
