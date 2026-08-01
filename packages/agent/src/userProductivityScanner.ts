import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { UserProductivityScanResultPayload, UserSessionSnapshotEntry } from "@em/shared";

const execFileAsync = promisify(execFile);

// quser is a fixed-width text table, not structured output (unlike tasklist/query process,
// it has no /FO CSV option) — sliced by the HEADER's own column start positions rather than
// splitting on whitespace, since a blank SESSIONNAME (disconnected sessions) would otherwise
// collide with neighboring columns. The leading '>' marking the console's own session is
// swapped for a space (not trimmed) so column alignment is preserved exactly.
const QUSER_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$raw = quser 2>$null
if (-not $raw) { Write-Output '[]'; exit }
$lines = $raw -split "\`r?\`n" | Where-Object { $_.Trim() -ne '' }
if ($lines.Count -lt 2) { Write-Output '[]'; exit }

$header = $lines[0]
$idxUser = $header.IndexOf('USERNAME')
$idxSession = $header.IndexOf('SESSIONNAME')
$idxState = $header.IndexOf('STATE')
$idxIdle = $header.IndexOf('IDLE TIME')
$idxLogon = $header.IndexOf('LOGON TIME')

$results = @()
for ($i = 1; $i -lt $lines.Count; $i++) {
  $line = $lines[$i] -replace '^>', ' '
  if ($line.Length -lt $idxLogon) { continue }
  try {
    $username = $line.Substring($idxUser, $idxSession - $idxUser).Trim()
    $state = $line.Substring($idxState, $idxIdle - $idxState).Trim()
    $idleRaw = $line.Substring($idxIdle, $idxLogon - $idxIdle).Trim()
    $logonRaw = $line.Substring($idxLogon).Trim()
    if (-not $username -or -not $logonRaw) { continue }

    $idleSeconds = 0
    if ($idleRaw -match '^(\\d+)\\+(\\d+):(\\d+)$') { $idleSeconds = [int]$matches[1]*86400 + [int]$matches[2]*3600 + [int]$matches[3]*60 }
    elseif ($idleRaw -match '^(\\d+):(\\d+)$') { $idleSeconds = [int]$matches[1]*3600 + [int]$matches[2]*60 }
    elseif ($idleRaw -match '^\\d+$') { $idleSeconds = [int]$idleRaw * 60 }
    # else: "none"/"." (zero) or an unrecognized format — treat as 0, don't fail the row

    $logonAt = $null
    try { $logonAt = [DateTime]::Parse($logonRaw).ToUniversalTime().ToString('o') } catch {}
    if (-not $logonAt) { continue }

    $results += [PSCustomObject]@{
      Username    = $username
      State       = $state
      IdleSeconds = $idleSeconds
      LogonAt     = $logonAt
    }
  } catch {}
}
ConvertTo-Json -InputObject $results -Compress
`;

interface RawSession {
  Username?: string;
  State?: string;
  IdleSeconds?: number;
  LogonAt?: string;
}

export async function runUserProductivityScan(client: AxiosInstance): Promise<void> {
  if (process.platform !== "win32") return;

  let sessions: UserSessionSnapshotEntry[] = [];
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", QUSER_SCRIPT],
      { maxBuffer: 1024 * 1024 },
    );

    const trimmed = stdout.trim();
    if (trimmed) {
      const parsed: RawSession | RawSession[] = JSON.parse(trimmed);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      sessions = rows
        .filter((r) => r.Username && r.LogonAt)
        .map((r) => ({
          username: r.Username!,
          state: r.State ?? "Unknown",
          idleSeconds: r.IdleSeconds ?? 0,
          logonAt: r.LogonAt!,
        }));
    }
  } catch (err) {
    console.error("Failed to collect user sessions (quser)", err);
    return;
  }

  const payload: UserProductivityScanResultPayload = {
    scannedAt: new Date().toISOString(),
    sessions,
  };

  try {
    await client.post("/api/agent/user-productivity/scan-result", payload);
    console.log(`User productivity scan reported (${sessions.length} session(s))`);
  } catch (err) {
    console.error("Failed to report user productivity scan", err);
  }
}
