$ErrorActionPreference = "Stop"

$agentDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $agentDir "..\..")
$sharedDir = Join-Path $repoRoot "packages\shared"
$rootNodeModules = Join-Path $repoRoot "node_modules"
$templatesDir = Join-Path $PSScriptRoot "templates"

Write-Host "Building @em/shared and @em/agent..."
Push-Location $repoRoot
npm run build -w @em/shared
if ($LASTEXITCODE -ne 0) { throw "@em/shared build failed" }
npm run build -w @em/agent
if ($LASTEXITCODE -ne 0) { throw "@em/agent build failed" }
Pop-Location

$distInstallerDir = Join-Path $agentDir "dist-installer"
$stagingRoot = Join-Path $distInstallerDir "EndpointProAgent"
if (Test-Path $stagingRoot) { Remove-Item $stagingRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

Write-Host "Staging app files..."
$appDir = Join-Path $stagingRoot "app"
$appDist = Join-Path $appDir "dist"
New-Item -ItemType Directory -Force -Path $appDist | Out-Null
Copy-Item -Path (Join-Path $agentDir "dist\*") -Destination $appDist -Recurse -Force

$appNodeModules = Join-Path $appDir "node_modules"
New-Item -ItemType Directory -Force -Path $appNodeModules | Out-Null

# Copying just axios/systeminformation/zod themselves misses their own transitive deps
# (e.g. axios -> form-data) - a real `npm install` in a scratch folder resolves the full
# tree correctly instead of hand-enumerating it (and re-guessing wrong every time a dep
# updates its own dependencies).
Write-Host "Resolving runtime dependencies..."
$depsStagingDir = Join-Path $distInstallerDir ".deps-staging"
if (Test-Path $depsStagingDir) { Remove-Item $depsStagingDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $depsStagingDir | Out-Null

function Get-InstalledVersion($pkgName) {
    $pkgJsonPath = Join-Path $rootNodeModules "$pkgName\package.json"
    if (-not (Test-Path $pkgJsonPath)) { throw "Expected dependency not found at $pkgJsonPath" }
    return (Get-Content $pkgJsonPath -Raw | ConvertFrom-Json).version
}

$depsPackageJson = @{
    name         = "endpoint-pro-agent-runtime-deps"
    private      = $true
    dependencies = @{
        axios             = Get-InstalledVersion "axios"
        systeminformation = Get-InstalledVersion "systeminformation"
        zod               = Get-InstalledVersion "zod"
    }
} | ConvertTo-Json
Set-Content -Path (Join-Path $depsStagingDir "package.json") -Value $depsPackageJson -Encoding UTF8

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

# @em/shared isn't a real npm-published package - hand-build the node_modules entry
# require("@em/shared") needs, mirroring the workspace symlink the agent uses in dev mode.
$sharedDest = Join-Path $appNodeModules "@em\shared"
New-Item -ItemType Directory -Force -Path $sharedDest | Out-Null
Copy-Item -Path (Join-Path $sharedDir "dist") -Destination (Join-Path $sharedDest "dist") -Recurse -Force
Copy-Item -Path (Join-Path $sharedDir "package.json") -Destination (Join-Path $sharedDest "package.json") -Force

Write-Host "Staging portable Node.js runtime..."
$nodeDir = Join-Path $stagingRoot "node"
New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
$systemNodeExe = Join-Path $env:ProgramFiles "nodejs\node.exe"
if (-not (Test-Path $systemNodeExe)) { throw "Could not find node.exe at $systemNodeExe" }
Copy-Item -Path $systemNodeExe -Destination (Join-Path $nodeDir "node.exe") -Force

Write-Host "Staging install/uninstall scripts..."
Copy-Item -Path (Join-Path $templatesDir "Install.bat") -Destination $stagingRoot -Force
Copy-Item -Path (Join-Path $templatesDir "install.ps1") -Destination $stagingRoot -Force
Copy-Item -Path (Join-Path $templatesDir "Uninstall.bat") -Destination $stagingRoot -Force
Copy-Item -Path (Join-Path $templatesDir "uninstall.ps1") -Destination $stagingRoot -Force
Copy-Item -Path (Join-Path $templatesDir "watchdog.ps1") -Destination $stagingRoot -Force

Write-Host "Zipping installer package..."
$zipPath = Join-Path $distInstallerDir "EndpointProAgentInstaller.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $zipPath

Write-Host "Compiling single-file setup.exe (embeds the zip above, no new tooling required - uses" `
    "the C# compiler bundled with every Windows install's .NET Framework)..."
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "Could not find csc.exe at $csc" }

$exePath = Join-Path $distInstallerDir "EndpointProAgentSetup.exe"
if (Test-Path $exePath) { Remove-Item $exePath -Force }

& $csc /nologo /target:winexe /platform:x64 /out:$exePath `
    /r:Microsoft.VisualBasic.dll /r:System.Windows.Forms.dll /r:System.IO.Compression.dll `
    /r:System.IO.Compression.FileSystem.dll `
    "/res:$zipPath,installer.zip" `
    (Join-Path $templatesDir "SetupStub.cs")
if ($LASTEXITCODE -ne 0) { throw "csc.exe failed to compile the setup exe" }

Write-Host ""
Write-Host "Installer created: $zipPath"
Write-Host "Single-file setup exe created: $exePath"
