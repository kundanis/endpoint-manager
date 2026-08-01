<#
.SYNOPSIS
  Zips the staged folder produced by package-license-server-stage.ps1.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$StagingRoot
)
$ErrorActionPreference = "Stop"

$distInstallerDir = Split-Path $StagingRoot -Parent
$zipPath = Join-Path $distInstallerDir "LicenseServerInstaller.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Write-Host "Zipping deployment package..."
Compress-Archive -Path (Join-Path $StagingRoot "*") -DestinationPath $zipPath

Write-Output $zipPath
