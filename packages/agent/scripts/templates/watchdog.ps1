# Endpoint IQ Agent Watchdog - runs on its own independent Scheduled Task (registered by
# install.ps1) every 5 minutes and at boot, putting the agent's Windows service
# "EndpointIQAgent" back if it has been deleted, disabled or stopped (register-service.ps1
# -Watchdog). Agents before 0.2.23 ran as a scheduled task instead; on those endpoints this also
# moves the agent to the service the first time it runs after the update.
#
# This is the mirror image of ensureWatchdogTaskRegistered() in the agent's own
# watchdogGuard.ts, which checks in the other direction that THIS watchdog task still exists
# and is enabled. Together: removing either one alone gets restored by the other within one
# check cycle (5 minutes) - a meaningful deterrent, not an absolute guarantee.

$ErrorActionPreference = "SilentlyContinue"
$installDir = Join-Path $env:ProgramData "EndpointPro\Agent"
$nodeExe = Join-Path $installDir "node\node.exe"
$entryPoint = Join-Path $installDir "app\dist\index.js"
$registerScript = Join-Path $installDir "register-service.ps1"

if (-not (Test-Path $nodeExe) -or -not (Test-Path $entryPoint) -or -not (Test-Path $registerScript)) {
    # The install itself is gone (a real uninstall, or someone deleted the files directly) -
    # nothing left to point a restored service at, so exit quietly.
    exit 0
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $registerScript -Watchdog
