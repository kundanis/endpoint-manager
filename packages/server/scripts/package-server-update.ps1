<#
.SYNOPSIS
  Builds an update-only deployment package for an EXISTING Endpoint Manager install -
  compiled app code + database migrations, no DB provisioning/admin seeding/fresh .env.
  Thin orchestrator, same shape as package-server.ps1 (the fresh-install equivalent) -
  see package-server-update-stage.ps1/-zip.ps1 for what each step actually does.
#>
$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "package-server-build.ps1")
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) { throw "Build step failed" }

$stagingRoot = & (Join-Path $PSScriptRoot "package-server-update-stage.ps1") | Select-Object -Last 1

$zipPath = & (Join-Path $PSScriptRoot "package-server-update-zip.ps1") -StagingRoot $stagingRoot | Select-Object -Last 1

Write-Host ""
Write-Host "Update package created: $zipPath"
Write-Host "Staged (unzipped) copy at: $stagingRoot"
