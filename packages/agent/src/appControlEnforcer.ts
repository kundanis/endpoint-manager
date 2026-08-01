import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AppControlRuleWire, AppControlScanResultPayload, AssignedAppControlResponse } from "@em/shared";

const execFileAsync = promisify(execFile);

// Software Restriction Policy (SRP), not AppLocker — SRP's default state is "Unrestricted"
// (allow everything) with specific paths added as explicit "Disallowed" exceptions, so
// turning it on can never accidentally block everything else the way an AppLocker
// enforcement-mode misconfiguration could. See project plan notes for the full reasoning.
const SRP_BASE_KEY = "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Safer\\CodeIdentifiers";
const SRP_DISALLOWED_PATHS_KEY = `${SRP_BASE_KEY}\\0\\Paths`;
// Every subkey this agent creates is tagged with this marker in its Description, so a
// re-sync can find and remove ONLY its own managed entries — never a Disallowed rule an
// admin authored some other way (e.g. directly via gpedit.msc).
const MANAGED_MARKER = "EM-managed";

function toSrpPathPattern(rule: AppControlRuleWire): string {
  if (rule.ruleType === "EXTENSION") {
    const ext = rule.value.startsWith(".") ? rule.value : `.${rule.value}`;
    return `*${ext}`;
  }
  // EXECUTABLE — a bare filename matches anywhere on disk via a wildcard path; a value
  // that already looks like a path (contains \ or :) is used exactly as given.
  if (rule.value.includes("\\") || rule.value.includes(":")) return rule.value;
  return `*\\${rule.value}`;
}

function psEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function buildApplyScript(rules: AppControlRuleWire[]): string {
  const rulesLiteral = rules
    .map((r) => `  @{ RuleId = '${psEscape(r.ruleId)}'; Pattern = '${psEscape(toSrpPathPattern(r))}' }`)
    .join(",\n");

  return `
$ErrorActionPreference = 'SilentlyContinue'
$basePath = '${SRP_BASE_KEY}'
$disallowedPath = '${SRP_DISALLOWED_PATHS_KEY}'

New-Item -Path $basePath -Force | Out-Null
New-Item -Path $disallowedPath -Force | Out-Null
Set-ItemProperty -Path $basePath -Name DefaultLevel -Value 262144 -Type DWord
Set-ItemProperty -Path $basePath -Name TransparentEnabled -Value 1 -Type DWord
Set-ItemProperty -Path $basePath -Name PolicyScope -Value 0 -Type DWord

Get-ChildItem -Path $disallowedPath -ErrorAction SilentlyContinue | ForEach-Object {
  $desc = (Get-ItemProperty -Path $_.PSPath -Name Description -ErrorAction SilentlyContinue).Description
  if ($desc -and $desc.StartsWith('${MANAGED_MARKER}:')) {
    Remove-Item -Path $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$rules = @(
${rulesLiteral}
)

foreach ($rule in $rules) {
  $guid = [guid]::NewGuid().ToString('B')
  $keyPath = Join-Path $disallowedPath $guid
  New-Item -Path $keyPath -Force | Out-Null
  Set-ItemProperty -Path $keyPath -Name ItemData -Value $rule.Pattern -Type String
  Set-ItemProperty -Path $keyPath -Name SaferFlags -Value 0 -Type DWord
  Set-ItemProperty -Path $keyPath -Name Description -Value "${MANAGED_MARKER}:$($rule.RuleId)" -Type String
}

Write-Output 'APPLIED'
`;
}

// Never throws — any failure is caught and reported as a FAILED scan result rather than
// left silent. events is always [] for now: SRP itself has no convenient block-event log
// to read reliably (unlike DLP's native sidecar) — telemetry here may be added later if a
// dependable event-log source is confirmed; for now "rules currently applied" is the signal.
export async function runAppControlScan(client: AxiosInstance): Promise<void> {
  let payload: AppControlScanResultPayload;

  try {
    const { data } = await client.get<AssignedAppControlResponse>("/api/agent/app-control/assigned");
    const script = buildApplyScript(data.rules);

    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { maxBuffer: 1024 * 1024 },
    );

    if (!stdout.includes("APPLIED")) {
      throw new Error(`Unexpected SRP apply output: ${stdout.trim()}`);
    }

    payload = { status: "APPLIED", errorMessage: null, events: [] };
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
