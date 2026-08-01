[CmdletBinding()]
param(
    # No default on purpose - a silently-accepted placeholder here would point a fresh
    # entity's agents at whichever machine last built this installer. Always required,
    # explicitly, per deployment.
    [string]$ServerUrl,
    [string]$EnrollmentToken
)

$ErrorActionPreference = "Stop"
$TaskName = "EndpointProAgent"
$WatchdogTaskName = "EndpointProWatchdog"

Write-Host "Endpoint Pro Agent Installer"
Write-Host "============================"

if (-not $ServerUrl) {
    $ServerUrl = Read-Host "Server URL (e.g. http://10.10.6.217:4000)"
}
if (-not $EnrollmentToken) {
    $EnrollmentToken = Read-Host "Enrollment token"
}
if (-not $EnrollmentToken) {
    Write-Error "An enrollment token is required."
    exit 1
}

$installDir = Join-Path $env:ProgramData "EndpointPro\Agent"
$scriptRoot = $PSScriptRoot

# schtasks writes to stderr when the task doesn't exist yet (the expected case on a
# fresh install) - with $ErrorActionPreference = "Stop" that native stderr output would
# otherwise be promoted into a terminating error even though it's redirected away, hence
# the temporary override here.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
schtasks /query /tn $TaskName 2>$null | Out-Null
$taskExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEap

if ($taskExists) {
    Write-Host "Existing installation detected - stopping it before updating."
    $ErrorActionPreference = "SilentlyContinue"
    # Disable first - RestartOnFailure would otherwise immediately relaunch the process
    # /end just tried to stop, racing the file copy below.
    schtasks /change /tn $TaskName /disable 2>$null | Out-Null
    schtasks /end /tn $TaskName 2>$null | Out-Null
    schtasks /change /tn $WatchdogTaskName /disable 2>$null | Out-Null
    schtasks /end /tn $WatchdogTaskName 2>$null | Out-Null
    $ErrorActionPreference = $prevEap

    # The install folder may already be locked down (tamper protection) from a prior
    # install - reset its permissions first so this update can actually write to it, then
    # re-apply the lockdown once the new files are in place (below).
    if (Test-Path $installDir) {
        icacls $installDir /reset /T /Q 2>$null | Out-Null
    }
}

Write-Host "Installing to $installDir ..."
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -Path (Join-Path $scriptRoot "node") -Destination $installDir -Recurse -Force
Copy-Item -Path (Join-Path $scriptRoot "app") -Destination $installDir -Recurse -Force
Copy-Item -Path (Join-Path $scriptRoot "watchdog.ps1") -Destination $installDir -Force

# config.ts resolves config.json relative to dist/'s parent - i.e. <installDir>/app/,
# not the outer install root (which just also holds the portable node/ runtime).
$config = @{ serverUrl = $ServerUrl; enrollmentToken = $EnrollmentToken } | ConvertTo-Json
# ASCII, not UTF8 - Windows PowerShell 5.1's "UTF8" encoding writes a BOM, which JSON.parse
# rejects. The values here (a URL and a hex token) are plain ASCII, so this is safe.
Set-Content -Path (Join-Path $installDir "app\config.json") -Value $config -Encoding ASCII

$nodeExe = Join-Path $installDir "node\node.exe"
$entryPoint = Join-Path $installDir "app\dist\index.js"

# Task Scheduler, not a "real" Windows service - no third-party binary (NSSM/WinSW) to
# fetch, schtasks.exe is built into Windows. RestartOnFailure covers crash recovery;
# BootTrigger + SYSTEM principal covers running before any user logs in.
$taskXmlPath = Join-Path $env:TEMP "EndpointProAgentTask.xml"
$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Hidden>true</Hidden>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$nodeExe</Command>
      <Arguments>"$entryPoint"</Arguments>
      <WorkingDirectory>$installDir</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
Set-Content -Path $taskXmlPath -Value $taskXml -Encoding Unicode

schtasks /create /tn $TaskName /xml $taskXmlPath /f | Out-Null
$createExitCode = $LASTEXITCODE
Remove-Item $taskXmlPath -Force
if ($createExitCode -ne 0) {
    throw "Failed to register the scheduled task (schtasks exit code $createExitCode)."
}

# Watchdog: an independent, self-contained Scheduled Task (own script, own trigger) that
# checks and restores the main task above if it's disabled or deleted. The main agent
# process performs the mirror-image check on THIS task (see watchdogGuard.ts) - together,
# tampering with either task alone gets undone by the other within one check cycle.
Write-Host "Registering the watchdog task..."
$watchdogScript = Join-Path $installDir "watchdog.ps1"
$watchdogTaskXmlPath = Join-Path $env:TEMP "EndpointProWatchdogTask.xml"
$watchdogTaskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT5M</Interval>
      </Repetition>
      <StartBoundary>2020-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -File "$watchdogScript"</Arguments>
      <WorkingDirectory>$installDir</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
Set-Content -Path $watchdogTaskXmlPath -Value $watchdogTaskXml -Encoding Unicode
schtasks /create /tn $WatchdogTaskName /xml $watchdogTaskXmlPath /f | Out-Null
$watchdogCreateExitCode = $LASTEXITCODE
Remove-Item $watchdogTaskXmlPath -Force
if ($watchdogCreateExitCode -ne 0) {
    Write-Warning "Failed to register the watchdog task (schtasks exit code $watchdogCreateExitCode) - the agent will still run, just without task tamper-resistance."
}

# Tamper resistance: lock the install folder down to SYSTEM only once everything is in
# place - a local administrator can still bypass this deliberately (take ownership, reset
# the ACL), but it is no longer a casual one-click delete. This is a deterrent, not an
# absolute guarantee, and is applied last so nothing above needs to fight it while installing.
Write-Host "Applying tamper-resistant permissions to the install folder..."
$currentIdentity = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).Name
icacls $installDir /inheritance:r | Out-Null
icacls $installDir /grant:r "SYSTEM:(OI)(CI)F" | Out-Null
icacls $installDir /grant:r "*S-1-5-32-544:(OI)(CI)RX" | Out-Null
icacls $installDir /remove:g $currentIdentity 2>$null | Out-Null

Write-Host "Starting the agent..."
schtasks /run /tn $TaskName | Out-Null

Start-Sleep -Seconds 2
Write-Host ""
Write-Host "Done. The Endpoint Pro agent is installed and running (scheduled task '$TaskName')."
Write-Host "It will start automatically on every boot, and a watchdog task will restore it if stopped or disabled."
