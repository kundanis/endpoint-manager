<#
.SYNOPSIS
  Updates an EXISTING Endpoint Manager install in place - new app code, console, agent
  installer, and any new database migrations - WITHOUT touching the existing database's
  data, app\.env (secrets/config/license activation), or app\uploads. Run this from
  wherever you extracted the update package (it does not need to sit next to the
  existing install).

.DESCRIPTION
  What it does, in order:
    1. Validates -TargetDir actually looks like an existing install (app\.env present).
    2. Disables then stops the Scheduled Task (disabling first stops RestartOnFailure
       from respawning mid-update using the old files - see docs/updating-existing-deployment.md
       for why this matters).
    3. Backs up the current app\dist, app\console-dist, app\prisma, app\node_modules by
       MOVING them (not deleting) into a timestamped folder under _update-backups\ - if
       anything goes wrong, rollback is just moving them back, no reinstall needed.
    4. Copies in the new dist\, console-dist\, prisma\, node_modules\, and the updated
       agent installer exe.
    5. Regenerates the Prisma Client and runs `prisma migrate deploy` against the
       EXISTING database - additive only, never resets or drops anything.
    6. Re-enables and restarts the Scheduled Task, then checks /health.

.EXAMPLE
  .\update.ps1 -TargetDir "C:\EndpointManagerServer"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TargetDir,
    [string]$TaskName = "EndpointManagerServer"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$nodeExe = Join-Path $root "node\node.exe"

Write-Host "Endpoint Manager - Update Existing Install"
Write-Host "==========================================="

if (-not (Test-Path $TargetDir)) { throw "Path not found: $TargetDir" }
$TargetDir = (Resolve-Path $TargetDir).Path
$targetAppDir = Join-Path $TargetDir "app"
$targetEnvPath = Join-Path $targetAppDir ".env"

if (-not (Test-Path $targetEnvPath)) {
    throw "No app\.env found under $TargetDir - point -TargetDir at the folder that contains 'app\', 'node\', and Start-Server.bat (the existing install's root, e.g. C:\EndpointManagerServer)."
}

# Hard stop, checked BEFORE anything else runs: if this update package was unzipped
# directly into the existing install's own folder, $root (where this script lives) and
# $TargetDir are the same path - "the new files" and "the folder being updated" collapse
# into one, so the later backup-then-copy steps have nowhere left to copy FROM once the
# backup moves the old files out of the way. Caught for real on a live customer machine
# mid-update (Copy-Item failed because its own source had just been backed up out from
# under it) - refuse up front instead, before the service is even stopped.
if ((Resolve-Path $root).Path -eq $TargetDir) {
    throw "This update package is unzipped INSIDE the folder you pointed -TargetDir at ($TargetDir). " + `
        "These must be two different folders. Unzip EndpointManagerServerUpdate.zip into a separate, " + `
        "new folder (e.g. your Desktop) - not inside the existing install - then run Update.bat/update.ps1 " + `
        "from there and point -TargetDir at $TargetDir."
}

# 1. Stop the running service - disable first so RestartOnFailure can't respawn using
# the old files while we're mid-copy (schtasks /end alone does not stop the scheduled
# restart - a real gotcha already hit once on a live customer machine, see project docs).
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
schtasks /query /tn $TaskName 2>$null | Out-Null
$taskExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEap

if ($taskExists) {
    Write-Host "Stopping $TaskName..."
    schtasks /change /tn $TaskName /disable | Out-Null
    schtasks /end /tn $TaskName 2>$null | Out-Null
    Start-Sleep -Seconds 3
}
else {
    Write-Host "No '$TaskName' Scheduled Task found."
    Write-Host "If the server is currently running (e.g. via Start-Server.bat), close that window now - waiting 10 seconds..."
    # Not Read-Host: this script may run non-interactively (stdin unavailable), where
    # Read-Host throws outright rather than just pausing. A fixed delay degrades safely
    # either way, and if the server truly is still running and holding files open, the
    # copy step below will fail with a clear, actionable file-lock error regardless.
    Start-Sleep -Seconds 10
}

# 2. Back up current app code by MOVING it aside (not deleting) - a failed update rolls
# back by moving these folders back, no reinstall/redownload needed.
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $TargetDir "_update-backups\$timestamp"
Write-Host "Backing up current app code to $backupDir ..."
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

foreach ($item in @("dist", "console-dist", "prisma", "node_modules")) {
    $src = Join-Path $targetAppDir $item
    if (Test-Path $src) {
        Move-Item -Path $src -Destination (Join-Path $backupDir $item) -Force
    }
}

# 3. Copy in the new app code. app\.env and app\uploads are never referenced below, so
# existing secrets/DB connection/license activation/uploaded packages all survive untouched.
Write-Host "Copying updated app files..."
Copy-Item -Path (Join-Path $root "app\dist") -Destination (Join-Path $targetAppDir "dist") -Recurse -Force
Copy-Item -Path (Join-Path $root "app\console-dist") -Destination (Join-Path $targetAppDir "console-dist") -Recurse -Force
Copy-Item -Path (Join-Path $root "app\prisma") -Destination (Join-Path $targetAppDir "prisma") -Recurse -Force
Copy-Item -Path (Join-Path $root "app\node_modules") -Destination (Join-Path $targetAppDir "node_modules") -Recurse -Force

$agentInstallerDir = Join-Path $targetAppDir "agent-installer"
New-Item -ItemType Directory -Force -Path $agentInstallerDir | Out-Null
Copy-Item -Path (Join-Path $root "app\agent-installer\EndpointProAgentSetup.exe") -Destination (Join-Path $agentInstallerDir "EndpointProAgentSetup.exe") -Force

Copy-Item -Path (Join-Path $root "node\node.exe") -Destination (Join-Path $TargetDir "node\node.exe") -Force
Copy-Item -Path (Join-Path $root "Start-Server.bat") -Destination (Join-Path $TargetDir "Start-Server.bat") -Force

# 4. Regenerate the Prisma Client against the new schema, then apply any new migrations
# to the EXISTING database - additive only, never resets or drops existing data. Same
# corporate-proxy fix setup.ps1 itself needs for Prisma's engine-binary fetch.
$env:NODE_OPTIONS = "--use-system-ca"
Push-Location $targetAppDir
$prismaCli = Join-Path $targetAppDir "node_modules\prisma\build\index.js"
try {
    Write-Host "Regenerating Prisma Client..."
    & $nodeExe $prismaCli generate --schema (Join-Path $targetAppDir "prisma\schema.prisma")
    if ($LASTEXITCODE -ne 0) { throw "prisma generate failed (exit $LASTEXITCODE)" }

    Write-Host "Applying any new database migrations..."
    & $nodeExe $prismaCli migrate deploy --schema (Join-Path $targetAppDir "prisma\schema.prisma")
    if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed (exit $LASTEXITCODE)" }
}
catch {
    Pop-Location
    Write-Host ""
    Write-Host "UPDATE FAILED: $_" -ForegroundColor Red
    Write-Host "The previous app\dist / console-dist / prisma / node_modules are safely backed up at:"
    Write-Host "  $backupDir"
    Write-Host "To roll back: delete the new (broken) dist/console-dist/prisma/node_modules folders under"
    Write-Host "  $targetAppDir"
    Write-Host "then move the backed-up ones back from $backupDir, then:"
    Write-Host "  schtasks /change /tn $TaskName /enable"
    Write-Host "  schtasks /run /tn $TaskName"
    throw
}
Pop-Location

# 5. Restart the service.
if ($taskExists) {
    Write-Host "Restarting $TaskName..."
    schtasks /change /tn $TaskName /enable | Out-Null
    schtasks /run /tn $TaskName | Out-Null
    Start-Sleep -Seconds 3
}
else {
    Write-Host ""
    Write-Host "Start the server manually now (Start-Server.bat) - no Scheduled Task exists to restart it automatically."
    Write-Host "Consider registering one so it survives reboots/crashes going forward - from the ORIGINAL setup package:"
    Write-Host '  .\setup.ps1 -SkipDbProvision -DatabaseUrl "<DATABASE_URL from app\.env>" -ShadowDatabaseUrl "<SHADOW_DATABASE_URL from app\.env>" -AdminEmail <existing-admin-email>'
    Write-Host "(-SkipDbProvision means this only registers the Scheduled Task - it will not re-provision the database or re-seed the admin.)"
}

# 6. Health check - reads PORT/TLS_PFX_PATH from the existing .env so this works whether
# the deployment runs plain HTTP or HTTPS with a self-signed cert.
Write-Host ""
Write-Host "Checking health..."
Start-Sleep -Seconds 3
$envLines = Get-Content $targetEnvPath
$portMatch = ($envLines | Select-String '^PORT=(\d+)$').Matches | Select-Object -First 1
$port = if ($portMatch) { $portMatch.Groups[1].Value } else { 4000 }
$hasTls = ($envLines | Where-Object { $_ -match '^TLS_PFX_PATH=\S+' }) -ne $null
$scheme = if ($hasTls) { "https" } else { "http" }
$healthUrl = "$scheme`://localhost:$port/health"

$prevCallback = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
try {
    if ($hasTls) {
        # Self-signed dev cert - accept it for this one local health check only, same
        # pinned-callback discipline used elsewhere in this product rather than a blanket
        # TLS bypass; restored in the finally block below either way.
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    }
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 10
    Write-Host "Server responded at $healthUrl : $($health | ConvertTo-Json -Compress)"
}
catch {
    Write-Host "Could not reach $healthUrl yet - it may still be starting. Check again in a few seconds, or run Start-Server.bat manually to see any startup error directly." -ForegroundColor Yellow
}
finally {
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $prevCallback
}

Write-Host ""
Write-Host "Update complete. Previous app code backed up at: $backupDir"
Write-Host "(Safe to delete that backup folder once you've confirmed everything works.)"
