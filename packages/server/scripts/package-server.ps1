<#
.SYNOPSIS
  Builds a self-contained, offline-installable deployment package for a brand-new
  Endpoint Manager entity. Thin orchestrator over three focused scripts (build/stage/
  zip) in this same folder - see each for what it actually does.

  Does NOT package packages/license-server or packages/license-console - those stay
  centrally hosted by the vendor, one instance serving every customer entity.
#>
$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "package-server-build.ps1")
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) { throw "Build step failed" }

$stagingRoot = & (Join-Path $PSScriptRoot "package-server-stage.ps1") | Select-Object -Last 1

$zipPath = & (Join-Path $PSScriptRoot "package-server-zip.ps1") -StagingRoot $stagingRoot | Select-Object -Last 1

Write-Host ""
Write-Host "Deployment package created: $zipPath"
Write-Host "Staged (unzipped) copy at: $stagingRoot"
