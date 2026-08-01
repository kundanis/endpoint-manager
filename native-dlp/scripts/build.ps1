# build.ps1 - Build DLPFilter driver and DLPService (compile only - does NOT
# install, sign, or load anything). Run from a PowerShell prompt after WDK is
# installed. Adapted from E:\Claude-Projects\DLPAgent\scripts\build_all.ps1.
param(
    [string]$Config   = "Release",
    [string]$Platform = "x64"
)

$Root    = $PSScriptRoot | Split-Path -Parent
$VsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"

$VsPath  = & $VsWhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath 2>$null
if (-not $VsPath) { Write-Error "Visual Studio not found"; exit 1 }
$MSBuild = Join-Path $VsPath "MSBuild\Current\Bin\MSBuild.exe"
Write-Host "[Build] Using MSBuild: $MSBuild"

# ---- Build minifilter driver --------------------------------------------
Write-Host "`n[Build] Building DLPFilter driver ($Config|$Platform)..."
& $MSBuild "$Root\driver\DLPFilter.vcxproj" `
    /p:Configuration=$Config /p:Platform=$Platform `
    /p:OutDir="$Root\bin\driver\" `
    /t:Build /m /nologo
if ($LASTEXITCODE -ne 0) { Write-Error "Driver build failed"; exit 2 }

# ---- Build service -------------------------------------------------------
Write-Host "`n[Build] Building DLPService ($Config|$Platform)..."
& $MSBuild "$Root\service\DLPService.vcxproj" `
    /p:Configuration=$Config /p:Platform=$Platform `
    /p:OutDir="$Root\bin\service\" `
    /t:Build /m /nologo
if ($LASTEXITCODE -ne 0) { Write-Error "Service build failed"; exit 3 }

Write-Host "`n[Build] Build complete (compiled only - nothing installed or loaded)."
Write-Host "  Driver : $Root\bin\driver\DLPFilter.sys"
Write-Host "  Service: $Root\bin\service\DLPService.exe"
Write-Host ""
Write-Host "Loading/testing the driver is a separate, deliberately manual step - see"
Write-Host "the project README before running any install/load script."
