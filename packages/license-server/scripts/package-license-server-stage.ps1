<#
.SYNOPSIS
  Stages the deployable License Server folder (compiled server, prisma schema+
  migrations, resolved node_modules, the hand-built @license/shared workspace package,
  compiled license-console, portable node.exe, setup scripts). Assumes
  package-license-server-build.ps1 already ran. Outputs the staging root path. Mirrors
  packages/server/scripts/package-server-stage.ps1.
#>
$ErrorActionPreference = "Stop"

$licenseServerDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $licenseServerDir "..\..")
$licenseSharedDir = Join-Path $repoRoot "packages\license-shared"
$licenseConsoleDir = Join-Path $repoRoot "packages\license-console"
$rootNodeModules = Join-Path $repoRoot "node_modules"
$templatesDir = Join-Path $PSScriptRoot "templates"

$distInstallerDir = Join-Path $licenseServerDir "dist-installer"
$stagingRoot = Join-Path $distInstallerDir "LicenseServer"
if (Test-Path $stagingRoot) { Remove-Item $stagingRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

Write-Host "Staging app files..."
$appDir = Join-Path $stagingRoot "app"
$appDist = Join-Path $appDir "dist"
New-Item -ItemType Directory -Force -Path $appDist | Out-Null
Copy-Item -Path (Join-Path $licenseServerDir "dist\*") -Destination $appDist -Recurse -Force

Copy-Item -Path (Join-Path $licenseServerDir "prisma") -Destination (Join-Path $appDir "prisma") -Recurse -Force
Copy-Item -Path (Join-Path $licenseServerDir ".env.example") -Destination $appDir -Force

# ASCII, not UTF8 - Windows PowerShell 5.1's "UTF8" encoding writes a BOM, which breaks
# tsx's/Node's package.json parsing (same fix already applied to package-server-stage.ps1
# after hitting this for real).
$appPackageJson = @{
    name    = "license-server-deployment"
    version = "0.1.0"
    private = $true
    main    = "dist/index.js"
} | ConvertTo-Json
Set-Content -Path (Join-Path $appDir "package.json") -Value $appPackageJson -Encoding ASCII

$appNodeModules = Join-Path $appDir "node_modules"
New-Item -ItemType Directory -Force -Path $appNodeModules | Out-Null

Write-Host "Resolving runtime dependencies..."
$depsStagingDir = Join-Path $distInstallerDir ".deps-staging"
if (Test-Path $depsStagingDir) { Remove-Item $depsStagingDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $depsStagingDir | Out-Null

function Get-InstalledVersion($pkgName) {
    $pkgJsonPath = Join-Path $rootNodeModules "$pkgName\package.json"
    if (-not (Test-Path $pkgJsonPath)) { throw "Expected dependency not found at $pkgJsonPath" }
    return (Get-Content $pkgJsonPath -Raw | ConvertFrom-Json).version
}

$runtimeDeps = @(
    "@prisma/client", "bcryptjs", "cookie-parser", "cors", "dotenv",
    "express", "express-rate-limit", "jsonwebtoken", "pino", "pino-http", "zod",
    "prisma", "tsx"
)
$depsMap = @{}
foreach ($dep in $runtimeDeps) { $depsMap[$dep] = Get-InstalledVersion $dep }

$depsPackageJson = @{
    name         = "license-server-runtime-deps"
    private      = $true
    dependencies = $depsMap
} | ConvertTo-Json
Set-Content -Path (Join-Path $depsStagingDir "package.json") -Value $depsPackageJson -Encoding ASCII

Push-Location $depsStagingDir
npm install --omit=dev --no-audit --no-fund --no-package-lock
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed while resolving runtime dependencies" }
Pop-Location

Copy-Item -Path (Join-Path $depsStagingDir "node_modules\*") -Destination $appNodeModules -Recurse -Force
Remove-Item $depsStagingDir -Recurse -Force

$sharedDest = Join-Path $appNodeModules "@license\shared"
New-Item -ItemType Directory -Force -Path $sharedDest | Out-Null
Copy-Item -Path (Join-Path $licenseSharedDir "dist") -Destination (Join-Path $sharedDest "dist") -Recurse -Force
Copy-Item -Path (Join-Path $licenseSharedDir "package.json") -Destination (Join-Path $sharedDest "package.json") -Force

Write-Host "Staging compiled license-console..."
Copy-Item -Path (Join-Path $licenseConsoleDir "dist") -Destination (Join-Path $appDir "console-dist") -Recurse -Force

Write-Host "Staging portable Node.js runtime..."
$nodeDir = Join-Path $stagingRoot "node"
New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
$systemNodeExe = Join-Path $env:ProgramFiles "nodejs\node.exe"
if (-not (Test-Path $systemNodeExe)) { throw "Could not find node.exe at $systemNodeExe" }
Copy-Item -Path $systemNodeExe -Destination (Join-Path $nodeDir "node.exe") -Force

Write-Host "Staging setup scripts..."
Copy-Item -Path (Join-Path $templatesDir "Setup.bat") -Destination $stagingRoot -Force
Copy-Item -Path (Join-Path $templatesDir "setup.ps1") -Destination $stagingRoot -Force
Copy-Item -Path (Join-Path $templatesDir "Start-Server.bat") -Destination $stagingRoot -Force
Copy-Item -Path (Join-Path $licenseServerDir "scripts\provision-database.ps1") -Destination $stagingRoot -Force

$docsDir = Join-Path $repoRoot "docs"
if (Test-Path (Join-Path $docsDir "license-server-deployment.md")) {
    Copy-Item -Path (Join-Path $docsDir "license-server-deployment.md") -Destination $stagingRoot -Force
}

Write-Output $stagingRoot
