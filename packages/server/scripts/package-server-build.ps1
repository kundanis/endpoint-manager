<#
.SYNOPSIS
  Builds the four workspace packages a server deployment needs, in dependency order,
  plus the standalone agent installer so a fresh customer setup's console can serve it
  immediately (Console -> Enrollment Tokens -> Download agent installer) with no manual
  step. Split out from package-server.ps1 so each packaging stage is a small,
  independently runnable/testable script rather than one large one.
#>
$ErrorActionPreference = "Stop"

$serverDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $serverDir "..\..")

Write-Host "Building @em/shared, @license/shared, @em/server, @em/console..."
Push-Location $repoRoot
npm run build -w @em/shared
if ($LASTEXITCODE -ne 0) { throw "@em/shared build failed" }
npm run build -w @license/shared
if ($LASTEXITCODE -ne 0) { throw "@license/shared build failed" }
npm run build -w @em/server
if ($LASTEXITCODE -ne 0) { throw "@em/server build failed" }
npm run build -w @em/console
if ($LASTEXITCODE -ne 0) { throw "@em/console build failed" }

Write-Host "Building the standalone agent installer (EndpointProAgentSetup.exe)..."
npm run package -w @em/agent
if ($LASTEXITCODE -ne 0) { throw "@em/agent package failed" }
Pop-Location
