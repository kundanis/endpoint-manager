[CmdletBinding()]
param(
    # No default on purpose - a silently-accepted placeholder here would point a fresh
    # entity's agents at whichever machine last built this installer. Always required,
    # explicitly, per deployment. May be a comma-separated list (LAN, web URL, public IP -
    # in the order the agent should try them); the agent fails over between them.
    [string]$ServerUrl,
    # Better left out: setup passes it in the EIQ_ENROLLMENT_TOKEN environment variable instead,
    # because any program on the PC can read another program's command line.
    [string]$EnrollmentToken
)

$ErrorActionPreference = "Stop"
$TaskName = "EndpointProAgent" # agents before 0.2.23 ran as this scheduled task
$ServiceName = "EndpointIQAgent"
$WatchdogTaskName = "EndpointProWatchdog"

Write-Host "Endpoint IQ Agent Installer"
Write-Host "============================"

if (-not $EnrollmentToken -and $env:EIQ_ENROLLMENT_TOKEN) { $EnrollmentToken = $env:EIQ_ENROLLMENT_TOKEN }
# Not passed on to the programs started below.
Remove-Item Env:EIQ_ENROLLMENT_TOKEN -ErrorAction SilentlyContinue

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
$serviceExists = [bool](Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
$ErrorActionPreference = $prevEap

if ($taskExists -or $serviceExists) {
    Write-Host "Existing installation detected - stopping it before updating."
    $ErrorActionPreference = "SilentlyContinue"
    # The watchdog first - it would otherwise start the agent again mid-copy. Then the agent
    # (service, or the scheduled task older versions used: disabled first, as RestartOnFailure
    # would otherwise relaunch what /end just stopped) and the tray app, whose files are in use.
    schtasks /change /tn $WatchdogTaskName /disable 2>$null | Out-Null
    schtasks /end /tn $WatchdogTaskName 2>$null | Out-Null
    if ($serviceExists) { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue }
    schtasks /change /tn $TaskName /disable 2>$null | Out-Null
    schtasks /end /tn $TaskName 2>$null | Out-Null
    taskkill /IM EndpointIQTray.exe /F 2>$null | Out-Null
    Start-Sleep -Seconds 2
    $ErrorActionPreference = $prevEap
}

# The install folder (new, or locked down by a prior install) is locked BEFORE any file goes in:
# SYSTEM and administrators only, administrators allowed to write while this copies. It is never
# reset to the permissions ProgramData would give it, which let users create files there - a
# user could otherwise put a file or link in it during the install that SYSTEM later runs.
# register-service.ps1 -PrepareInstall takes ownership first (an elevated admin lacks WRITE_DAC
# on a locked folder) and removes a junction or link put in place of the folder.
Write-Host "Installing to $installDir ..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptRoot "register-service.ps1") -PrepareInstall
if (-not (Test-Path -LiteralPath $installDir -PathType Container)) { throw "Couldn't prepare the install folder $installDir." }
Copy-Item -Path (Join-Path $scriptRoot "node") -Destination $installDir -Recurse -Force
Copy-Item -Path (Join-Path $scriptRoot "app") -Destination $installDir -Recurse -Force
Copy-Item -Path (Join-Path $scriptRoot "tray") -Destination $installDir -Recurse -Force
Copy-Item -Path (Join-Path $scriptRoot "EndpointIQAgentService.exe") -Destination $installDir -Force
Copy-Item -Path (Join-Path $scriptRoot "register-service.ps1") -Destination $installDir -Force
Copy-Item -Path (Join-Path $scriptRoot "watchdog.ps1") -Destination $installDir -Force

# config.ts resolves config.json relative to dist/'s parent - i.e. <installDir>/app/,
# not the outer install root (which just also holds the portable node/ runtime).
# serverUrl (the first address) stays for the uninstall/self-update scripts that read a single
# URL; the agent itself keeps it pointed at whichever address last worked.
$serverUrls = @($ServerUrl -split ',' | ForEach-Object { $_.Trim().TrimEnd('/') } | Where-Object { $_ })
if ($serverUrls.Count -eq 0) {
    Write-Error "A server URL is required."
    exit 1
}
$config = @{ serverUrl = $serverUrls[0]; serverUrls = $serverUrls; enrollmentToken = $EnrollmentToken } | ConvertTo-Json
# ASCII, not UTF8 - Windows PowerShell 5.1's "UTF8" encoding writes a BOM, which JSON.parse
# rejects. The values here (a URL and a hex token) are plain ASCII, so this is safe.
Set-Content -Path (Join-Path $installDir "app\config.json") -Value $config -Encoding ASCII

# Watchdog: an independent, self-contained Scheduled Task (own script, own trigger) that
# puts the agent service back if it's stopped, disabled or deleted (watchdog.ps1 ->
# register-service.ps1 -Watchdog). The agent performs the mirror-image check on THIS task
# (see watchdogGuard.ts) - together, tampering with either one alone gets undone by the other
# within one check cycle.
Write-Host "Registering the watchdog task..."
$watchdogScript = Join-Path $installDir "watchdog.ps1"
$watchdogTaskXmlPath = Join-Path $env:TEMP ("EndpointProWatchdogTask_" + [Guid]::NewGuid().ToString("N") + ".xml")
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

# The Windows service "EndpointIQAgent" (EndpointIQAgentService.exe): runs the agent as
# LocalSystem from boot, restarts it if it stops, and starts the Endpoint IQ tray app for each
# signed-in user. register-service.ps1 also removes the scheduled task older versions used and
# locks the install folder down to SYSTEM (administrators can read it; a local administrator
# can still take ownership deliberately - a deterrent, not an absolute guarantee).
Write-Host "Registering and starting the Endpoint IQ Agent service..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installDir "register-service.ps1")
$registerExitCode = $LASTEXITCODE

Start-Sleep -Seconds 2
Write-Host ""
if ($registerExitCode -eq 0) {
    Write-Host "Done. The Endpoint IQ agent is installed and running (Windows service '$ServiceName')."
    Write-Host "It starts automatically on every boot, shows the Endpoint IQ icon in the notification area for each"
    Write-Host "signed-in user, and a watchdog task restores the service if it is stopped or disabled."
} elseif ($registerExitCode -eq 3) {
    Write-Warning ("Windows didn't allow the Endpoint IQ Agent service to run (Smart App Control or an application " +
        "control policy may be blocking unsigned programs). The agent is installed and running as the scheduled task " +
        "'$TaskName' instead, without the notification-area icon. It will try the service again tomorrow.")
} else {
    throw "Failed to register the Endpoint IQ Agent service (register-service.ps1 exit code $registerExitCode)."
}
