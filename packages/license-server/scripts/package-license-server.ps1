<#
.SYNOPSIS
  Builds a self-contained, offline-installable deployment package for the License
  Server (Machine B) - the vendor's own central server, installed once, serving every
  customer entity. Thin orchestrator over three focused scripts (build/stage/zip) in
  this same folder. Mirrors packages/server/scripts/package-server.ps1.
#>
$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "package-license-server-build.ps1")
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) { throw "Build step failed" }

$stagingRoot = & (Join-Path $PSScriptRoot "package-license-server-stage.ps1") | Select-Object -Last 1

$zipPath = & (Join-Path $PSScriptRoot "package-license-server-zip.ps1") -StagingRoot $stagingRoot | Select-Object -Last 1

Write-Host ""
Write-Host "Deployment package created: $zipPath"
Write-Host "Staged (unzipped) copy at: $stagingRoot"
