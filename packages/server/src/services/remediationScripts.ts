// PowerShell run on an endpoint to fix a vulnerable program: uninstall it, or - for programs
// that keep themselves current and can't (or shouldn't) be removed - run their own updater.
//
// Every script prints its outcome in plain words: a success line on stdout, or the reason on
// stderr with the uninstaller's exit code translated. The Commands page and the vulnerability's
// per-endpoint remediation status show that text, so an admin sees *why* something failed
// (e.g. "Microsoft Edge can't be uninstalled - update it instead") instead of a bare exit code.

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// Finds the program's live Uninstall entry - machine-wide (64- and 32-bit) and every signed-in
// user's - by exact DisplayName. Each key is read on its own (GetValue), so one malformed
// value elsewhere can't make the lookup fail.
const FIND_ENTRY = `
$roots = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
Get-ChildItem -Path 'Registry::HKEY_USERS' -ErrorAction SilentlyContinue |
  Where-Object { $_.PSChildName -match '^S-1-5-21-[0-9-]+$' } |
  ForEach-Object { $roots += "Registry::HKEY_USERS\\$($_.PSChildName)\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" }
$entry = $null
foreach ($root in $roots) {
  foreach ($key in @(Get-ChildItem -Path $root -ErrorAction SilentlyContinue)) {
    if ($key.GetValue('DisplayName') -eq $targetName) { $entry = $key; break }
  }
  if ($entry) { break }
}`;

// Uninstaller exit codes worth explaining (MSI codes plus the ones vendors commonly use).
const EXIT_REASONS = `
$reasons = @{
  2    = 'the uninstaller could not find the program''s files'
  5    = 'access was denied'
  93   = 'this program refuses to be uninstalled (Microsoft Edge and WebView2 are part of Windows) - update it instead'
  1223 = 'the uninstall was cancelled'
  1602 = 'the uninstall was cancelled'
  1603 = 'the uninstaller hit a fatal error (often a running process or a damaged install) - try again after restarting the endpoint'
  1605 = 'the program is not installed'
  1612 = 'the program''s installation source is not available'
  1618 = 'another installation is already running on this endpoint - try again in a few minutes'
  1619 = 'the program''s installer package could not be opened'
  1620 = 'the program''s installer package could not be opened'
  1625 = 'system policy blocks this uninstall'
  1638 = 'another version of the program is installed'
  1643 = 'system policy blocks this uninstall'
}`;

export function buildUninstallScript(softwareName: string): string {
  return `
$ErrorActionPreference = 'Continue'
$targetName = ${psQuote(softwareName)}
${FIND_ENTRY}
if (-not $entry) {
  [Console]::Error.WriteLine("'$targetName' is not installed on this endpoint - it may already have been removed or updated.")
  exit 1605
}

$uninstallCmd = $entry.GetValue('QuietUninstallString')
if (-not $uninstallCmd) { $uninstallCmd = $entry.GetValue('UninstallString') }
if (-not $uninstallCmd) {
  [Console]::Error.WriteLine("'$targetName' has no uninstall command registered - remove it manually.")
  exit 1
}

if ($uninstallCmd -match '(\\{[0-9A-Fa-f-]{36}\\})') {
  # MSI: force a real silent uninstall regardless of what's registered.
  $proc = Start-Process msiexec.exe -ArgumentList "/x $($Matches[1]) /qn /norestart" -Wait -PassThru
} else {
  # EXE: run exactly what's registered - forcing an unknown silent flag onto a vendor's
  # uninstaller is usually wrong. One with no quiet mode may wait for a click until the
  # command times out.
  $proc = Start-Process cmd.exe -ArgumentList @('/c', $uninstallCmd) -Wait -PassThru
}
$code = $proc.ExitCode
${EXIT_REASONS}
if ($code -eq 0) { Write-Output "Uninstalled '$targetName'."; exit 0 }
if ($code -eq 3010 -or $code -eq 1641) { Write-Output "Uninstalled '$targetName'. Restart the endpoint to finish."; exit 0 }
$why = if ($reasons.ContainsKey($code)) { $reasons[$code] } else { 'the uninstaller reported an error' }
[Console]::Error.WriteLine("Uninstalling '$targetName' failed (exit code $code): $why.")
exit $code
`;
}

// Programs that update themselves through their vendor's updater and shouldn't be uninstalled
// to fix a vulnerability: running the updater installs the fixed version.
interface UpdaterSpec {
  // Lower-case DisplayName prefix.
  namePrefix: string;
  vendor: string;
  // Updater paths, tried in order.
  updaters: string[];
}

const SELF_UPDATING: UpdaterSpec[] = [
  {
    namePrefix: "microsoft edge",
    vendor: "Microsoft Edge Update",
    updaters: [
      "${env:ProgramFiles(x86)}\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe",
      "$env:ProgramFiles\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe",
    ],
  },
  {
    namePrefix: "google chrome",
    vendor: "Google Update",
    updaters: ["${env:ProgramFiles(x86)}\\Google\\Update\\GoogleUpdate.exe", "$env:ProgramFiles\\Google\\Update\\GoogleUpdate.exe"],
  },
];

export function selfUpdatingSpec(softwareName: string): UpdaterSpec | undefined {
  const lower = softwareName.trim().toLowerCase();
  return SELF_UPDATING.find((s) => lower.startsWith(s.namePrefix));
}

function buildUpdateScript(softwareName: string, spec: UpdaterSpec): string {
  return `
$ErrorActionPreference = 'Continue'
$targetName = ${psQuote(softwareName)}
${FIND_ENTRY}
if (-not $entry) {
  [Console]::Error.WriteLine("'$targetName' is not installed on this endpoint - it may already have been removed.")
  exit 1605
}
$before = $entry.GetValue('DisplayVersion')
$updater = @(${spec.updaters.map((p) => `"${p}"`).join(", ")}) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $updater) {
  [Console]::Error.WriteLine("${spec.vendor} was not found on this endpoint, so '$targetName' can't be updated automatically - update it manually.")
  exit 2
}
# The same command the vendor's own scheduled update task runs: check for and install updates.
$proc = Start-Process -FilePath $updater -ArgumentList '/ua /installsource ondemand' -Wait -PassThru
$after = (Get-Item -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue).GetValue('DisplayVersion')
if ($proc.ExitCode -ne 0) {
  [Console]::Error.WriteLine("${spec.vendor} could not update '$targetName' (exit code $($proc.ExitCode)). Version is still $before.")
  exit $proc.ExitCode
}
if ($after -and $after -ne $before) {
  Write-Output "Updated '$targetName' from $before to $after. The vulnerability clears after the endpoint's next inventory report."
} else {
  Write-Output "${spec.vendor} ran for '$targetName' (version $before). If a newer version is available it finishes installing when the program next restarts; the vulnerability clears after the endpoint's next inventory report."
}
exit 0
`;
}

// What vulnerability remediation runs for a program: its updater if it's a self-updating
// program (Edge, WebView2, Chrome), otherwise an uninstall.
export function buildRemediationScript(softwareName: string): { script: string; action: "update" | "uninstall" } {
  const spec = selfUpdatingSpec(softwareName);
  return spec ? { script: buildUpdateScript(softwareName, spec), action: "update" } : { script: buildUninstallScript(softwareName), action: "uninstall" };
}
