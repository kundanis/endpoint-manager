<#
.SYNOPSIS
  Stages the deployable folder (compiled server, prisma, resolved node_modules, the
  two hand-built workspace packages, compiled console, portable node.exe, setup
  scripts). Assumes package-server-build.ps1 already ran. Outputs the staging root path.
#>
$ErrorActionPreference = "Stop"

$serverDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $serverDir "..\..")
$sharedDir = Join-Path $repoRoot "packages\shared"
$licenseSharedDir = Join-Path $repoRoot "packages\license-shared"
$consoleDir = Join-Path $repoRoot "packages\console"
$agentInstallerExe = Join-Path $repoRoot "packages\agent\dist-installer\EndpointProAgentSetup.exe"
$rootNodeModules = Join-Path $repoRoot "node_modules"
$templatesDir = Join-Path $PSScriptRoot "templates"

$distInstallerDir = Join-Path $serverDir "dist-installer"
$stagingRoot = Join-Path $distInstallerDir "EndpointManagerServer"
if (Test-Path $stagingRoot) { Remove-Item $stagingRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

Write-Host "Staging app files..."
$appDir = Join-Path $stagingRoot "app"
$appDist = Join-Path $appDir "dist"
New-Item -ItemType Directory -Force -Path $appDist | Out-Null
Copy-Item -Path (Join-Path $serverDir "dist\*") -Destination $appDist -Recurse -Force

Copy-Item -Path (Join-Path $serverDir "prisma") -Destination (Join-Path $appDir "prisma") -Recurse -Force
Copy-Item -Path (Join-Path $serverDir ".env.example") -Destination $appDir -Force

$appPackageJson = @{
    name    = "endpoint-manager-server-deployment"
    version = "0.1.0"
    private = $true
    main    = "dist/index.js"
} | ConvertTo-Json
# ASCII, not UTF8 - Windows PowerShell 5.1's "UTF8" encoding writes a BOM, which breaks
# tsx's/Node's package.json parsing (same issue already documented and worked around for
# config.json in packages/agent/scripts/templates/install.ps1). Content here is plain
# ASCII (package name/version/main path) so this is always safe.
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
    "@prisma/client", "axios", "bcryptjs", "cookie-parser", "cors", "dotenv",
    "express", "express-rate-limit", "jsonwebtoken", "multer", "pino", "pino-http", "zod",
    "prisma", "tsx"
)
$depsMap = @{}
foreach ($dep in $runtimeDeps) { $depsMap[$dep] = Get-InstalledVersion $dep }

$depsPackageJson = @{
    name         = "endpoint-manager-server-runtime-deps"
    private      = $true
    dependencies = $depsMap
} | ConvertTo-Json
Set-Content -Path (Join-Path $depsStagingDir "package.json") -Value $depsPackageJson -Encoding ASCII

Push-Location $depsStagingDir
npm install --omit=dev --no-audit --no-fund --no-package-lock
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed while resolving runtime dependencies" }
Pop-Location

Copy-Item -Path (Join-Path $depsStagingDir "node_modules\*") -Destination $appNodeModules -Recurse -Force
# Prisma's own engine-binary download cache (a nested node_modules\.cache\prisma\... -
# e.g. under @prisma\engines\node_modules\.cache, not just the top level) and any stray
# *.tmp<pid> leftover from an interrupted engine download both get swept in by the
# wildcard copy above - neither is needed at runtime, just dead weight (tens of MB).
Get-ChildItem $appNodeModules -Recurse -Directory -Filter ".cache" -Force -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $appNodeModules -Recurse -Filter "*.tmp*" -File -ErrorAction SilentlyContinue | Remove-Item -Force
Remove-Item $depsStagingDir -Recurse -Force

function Install-LocalWorkspacePackage($sourceDir, $packageName) {
    $dest = Join-Path $appNodeModules $packageName
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Path (Join-Path $sourceDir "dist") -Destination (Join-Path $dest "dist") -Recurse -Force
    Copy-Item -Path (Join-Path $sourceDir "package.json") -Destination (Join-Path $dest "package.json") -Force
}
Install-LocalWorkspacePackage $sharedDir "@em\shared"
Install-LocalWorkspacePackage $licenseSharedDir "@license\shared"

Write-Host "Staging compiled console..."
Copy-Item -Path (Join-Path $consoleDir "dist") -Destination (Join-Path $appDir "console-dist") -Recurse -Force

Write-Host "Staging agent installer (so Console -> Enrollment Tokens -> Download agent installer works immediately)..."
if (-not (Test-Path $agentInstallerExe)) { throw "Could not find agent installer at $agentInstallerExe - did package-server-build.ps1 run first?" }
$agentInstallerDir = Join-Path $appDir "agent-installer"
New-Item -ItemType Directory -Force -Path $agentInstallerDir | Out-Null
Copy-Item -Path $agentInstallerExe -Destination (Join-Path $agentInstallerDir "EndpointProAgentSetup.exe") -Force

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
Copy-Item -Path (Join-Path $serverDir "scripts\provision-database.ps1") -Destination $stagingRoot -Force

$docsDir = Join-Path $repoRoot "docs"
if (Test-Path (Join-Path $docsDir "fresh-deployment.md")) {
    Copy-Item -Path (Join-Path $docsDir "fresh-deployment.md") -Destination $stagingRoot -Force
}

Write-Output $stagingRoot
