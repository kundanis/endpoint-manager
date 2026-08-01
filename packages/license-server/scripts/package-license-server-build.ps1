<#
.SYNOPSIS
  Builds the three workspace packages a License Server deployment needs, in dependency
  order. Mirrors packages/server/scripts/package-server-build.ps1.
#>
$ErrorActionPreference = "Stop"

$licenseServerDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $licenseServerDir "..\..")

Write-Host "Building @license/shared, @license/server, @license/console..."
Push-Location $repoRoot
npm run build -w @license/shared
if ($LASTEXITCODE -ne 0) { throw "@license/shared build failed" }
npm run build -w @license/server
if ($LASTEXITCODE -ne 0) { throw "@license/server build failed" }
npm run build -w @license/console
if ($LASTEXITCODE -ne 0) { throw "@license/console build failed" }
Pop-Location
