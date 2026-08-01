import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PatchInstallResultPayload, PatchTaskWire } from "@em/shared";

const execFileAsync = promisify(execFile);

const INSTALL_TIMEOUT_MS = 30 * 60 * 1000; // downloads + install can genuinely take a while

interface RawPerUpdateResult {
  UpdateId: string;
  ResultCode: number;
  HResult: number | null;
}

interface RawInstallResult {
  Status: "NOTHING_TO_INSTALL" | "DONE";
  RebootRequired?: boolean;
  PerUpdate?: RawPerUpdateResult[] | RawPerUpdateResult;
  NotFound?: string[] | string;
  Error?: string;
}

function toArray<T>(value: T[] | T | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Same Microsoft.Update.Session COM surface as patchScanner.ts. Re-searches and filters to
// just the admin-approved updateIds, downloads, installs, and reports RebootRequired —
// this code path never reboots the machine itself; that's a separate, explicit admin action.
function buildInstallScript(updateIds: string[]): string {
  // Defensive escaping even though UpdateIDs are GUIDs and can't actually contain a quote.
  const updateIdsJsonLiteral = JSON.stringify(updateIds).replace(/'/g, "''");

  return `
$ErrorActionPreference = 'Stop'
$targetIds = '${updateIdsJsonLiteral}' | ConvertFrom-Json

# WUA search works fine for a standard/admin-role user token, but downloading and installing
# generally requires a genuinely elevated token — a plain Administrator-group user under UAC
# (IsInRole($false) despite group membership) can search successfully but have Download()
# silently leave IsDownloaded=$false rather than throw. Fail fast with a clear reason instead
# of surfacing an opaque WUA result code in that case. A packaged Windows service running as
# LocalSystem (the production deployment target) always has a fully privileged token.
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  [PSCustomObject]@{
    Status = 'DONE'
    RebootRequired = $false
    PerUpdate = @($targetIds | ForEach-Object { [PSCustomObject]@{ UpdateId = $_; ResultCode = 4; HResult = $null } })
    NotFound = @()
    Error = 'Agent process is not running with an elevated token — installing updates requires administrative privileges (search works without it, install does not).'
  } | ConvertTo-Json -Compress -Depth 5
  exit 0
}

$session  = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$result   = $searcher.Search("IsInstalled=0 and Type='Software' and IsHidden=0")

$toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
$notFound  = @()
foreach ($id in $targetIds) {
  $match = @($result.Updates | Where-Object { $_.Identity.UpdateID -eq $id })
  if ($match.Count -gt 0) {
    $u = $match[0]
    if (-not $u.EulaAccepted) { $u.AcceptEula() }
    [void]$toInstall.Add($u)
  } else {
    $notFound += $id
  }
}

if ($toInstall.Count -eq 0) {
  [PSCustomObject]@{ Status = 'NOTHING_TO_INSTALL'; NotFound = @($notFound); PerUpdate = @() } | ConvertTo-Json -Compress
  exit 0
}

$downloader = $session.CreateUpdateDownloader()
$downloader.Updates = $toInstall
[void]$downloader.Download()

$downloadFailedIds = @()
for ($i = 0; $i -lt $toInstall.Count; $i++) {
  if (-not $toInstall.Item($i).IsDownloaded) { $downloadFailedIds += $toInstall.Item($i).Identity.UpdateID }
}

$toActuallyInstall = New-Object -ComObject Microsoft.Update.UpdateColl
foreach ($u in $toInstall) { if ($u.IsDownloaded) { [void]$toActuallyInstall.Add($u) } }

$perUpdate = @()
$installResult = $null
if ($toActuallyInstall.Count -gt 0) {
  $installer = $session.CreateUpdateInstaller()
  $installer.Updates = $toActuallyInstall
  $installResult = $installer.Install()

  for ($i = 0; $i -lt $toActuallyInstall.Count; $i++) {
    $r = $installResult.GetUpdateResult($i)
    $perUpdate += [PSCustomObject]@{
      UpdateId   = $toActuallyInstall.Item($i).Identity.UpdateID
      ResultCode = $r.ResultCode
      HResult    = $r.HResult
    }
  }
}
foreach ($failedId in $downloadFailedIds) {
  $perUpdate += [PSCustomObject]@{ UpdateId = $failedId; ResultCode = 4; HResult = $null }
}

$sysInfo = New-Object -ComObject Microsoft.Update.SystemInfo
$rebootFromInstall = $false
if ($installResult) { $rebootFromInstall = [bool]$installResult.RebootRequired }
$rebootRequired = $rebootFromInstall -or [bool]$sysInfo.RebootRequired

[PSCustomObject]@{
  Status         = 'DONE'
  RebootRequired = $rebootRequired
  PerUpdate      = @($perUpdate)
  NotFound       = @($notFound)
} | ConvertTo-Json -Compress -Depth 5
`;
}

export async function installPatches(task: PatchTaskWire): Promise<PatchInstallResultPayload> {
  const startedAt = new Date().toISOString();

  if (process.platform !== "win32") {
    return {
      status: "FAILED",
      rebootRequired: false,
      results: [],
      message: "Patch installation is only supported on Windows",
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", buildInstallScript(task.updateIds)],
      { maxBuffer: 20 * 1024 * 1024, timeout: INSTALL_TIMEOUT_MS },
    );

    const trimmed = stdout.trim();
    const parsed: RawInstallResult = trimmed
      ? JSON.parse(trimmed)
      : { Status: "NOTHING_TO_INSTALL", PerUpdate: [], NotFound: [] };

    const perUpdate = toArray(parsed.PerUpdate);
    const notFound = toArray(parsed.NotFound);

    if (parsed.Status === "NOTHING_TO_INSTALL") {
      return {
        status: "NOTHING_TO_INSTALL",
        rebootRequired: false,
        results: [],
        message: notFound.length > 0 ? `Update(s) no longer offered: ${notFound.join(", ")}` : null,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    const results = perUpdate.map((r) => ({
      updateId: r.UpdateId,
      resultCode: r.ResultCode,
      hresult: r.HResult ?? null,
    }));

    const anyFailed = results.some((r) => r.resultCode === 4 || r.resultCode === 5);
    const anySucceeded = results.some((r) => r.resultCode === 2 || r.resultCode === 3);
    const status = anyFailed && anySucceeded ? "PARTIAL" : anyFailed ? "FAILED" : "SUCCESS";

    const messageParts = [
      parsed.Error,
      notFound.length > 0 ? `Update(s) no longer offered: ${notFound.join(", ")}` : null,
    ].filter((m): m is string => Boolean(m));

    return {
      status,
      rebootRequired: Boolean(parsed.RebootRequired),
      results,
      message: messageParts.length > 0 ? messageParts.join(" | ") : null,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "FAILED",
      rebootRequired: false,
      results: [],
      message: err instanceof Error ? err.message : String(err),
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
