<#
.SYNOPSIS
  Zips the staged folder produced by package-server-stage.ps1.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$StagingRoot
)
$ErrorActionPreference = "Stop"

$distInstallerDir = Split-Path $StagingRoot -Parent
$zipPath = Join-Path $distInstallerDir "EndpointManagerServerInstaller.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Write-Host "Zipping deployment package..."
Compress-Archive -Path (Join-Path $StagingRoot "*") -DestinationPath $zipPath

Write-Output $zipPath
