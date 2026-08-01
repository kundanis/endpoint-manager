<#
.SYNOPSIS
  Zips the staged folder produced by package-server-update-stage.ps1.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$StagingRoot
)
$ErrorActionPreference = "Stop"

$distInstallerDir = Split-Path $StagingRoot -Parent
$zipPath = Join-Path $distInstallerDir "EndpointManagerServerUpdate.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Write-Host "Zipping update package..."
Compress-Archive -Path (Join-Path $StagingRoot "*") -DestinationPath $zipPath

Write-Output $zipPath
