<#
.SYNOPSIS
  Builds a customer release bundle of Endpoint One: prebuilt image + installer, no source code.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File docker\release.ps1 -Version 1.0.0
  powershell -ExecutionPolicy Bypass -File docker\release.ps1 -Version 1.0.0 -Offline

.DESCRIPTION
  Produces release\endpoint-one-<Version>.tar.gz containing:
    images/endpoint-one-server-<Version>.tar   the server image (V8 bytecode, no readable JS)
    images/mssql-server.tar                    SQL Server image (only with -Offline)
    docker-compose.yml, deploy.sh, INSTALL.md  customer install/upgrade tooling and guide
    agent-installer/                           agent setup files from docker\agent-installer
    VERSION, RELEASE-INFO.txt, SHA256SUMS
  Copy that one file to the customer server and follow INSTALL.md (sudo bash deploy.sh).

  -Offline  also bundles the SQL Server image (~1.6 GB more) for servers that can't reach
            mcr.microsoft.com. Docker itself must still be installed on such servers.
  -SkipBuild reuse an existing endpoint-one-server:<Version> image instead of rebuilding.
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [switch]$Offline,
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"

if ($Version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$') {
  throw "Version must look like 1.0.0 (optionally 1.0.0-rc1), got '$Version'."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$customerDir = Join-Path $PSScriptRoot "customer"
$releaseRoot = Join-Path $repoRoot "release"
$bundleName = "endpoint-one-$Version"
$bundleDir = Join-Path $releaseRoot $bundleName
$image = "endpoint-one-server:$Version"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# Writes text with LF line endings and no BOM - these files run on Linux.
function Write-LfFile($path, $text) {
  $text = $text -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

Push-Location $repoRoot
try {
  # --- Source state (only recorded in RELEASE-INFO; git is optional) -------------------------
  $git = (Get-Command git -ErrorAction SilentlyContinue).Source
  if (-not $git -and (Test-Path "$env:ProgramFiles\Git\cmd\git.exe")) { $git = "$env:ProgramFiles\Git\cmd\git.exe" }
  $commit = "unknown"
  if ($git) {
    $commit = (& $git rev-parse --short HEAD).Trim()
    $dirty = (& $git status --porcelain --untracked-files=no)
    if ($dirty) {
      Write-Warning "Uncommitted changes are present; the release will include them but RELEASE-INFO only records commit $commit."
    }
  } else {
    Write-Warning "git not found - RELEASE-INFO will not record the source commit."
  }

  # --- Image --------------------------------------------------------------------------------
  if (-not $SkipBuild) {
    Step "Building $image"
    docker build -f docker/Dockerfile -t $image -t endpoint-one-server:latest .
    if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
  }
  docker image inspect $image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Image $image not found (drop -SkipBuild to build it)." }

  # --- Bundle folder ------------------------------------------------------------------------
  Step "Assembling $bundleName"
  if (Test-Path $bundleDir) { Remove-Item $bundleDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Join-Path $bundleDir "images"), (Join-Path $bundleDir "agent-installer") | Out-Null

  foreach ($f in "docker-compose.yml", "deploy.sh", "INSTALL.md") {
    Write-LfFile (Join-Path $bundleDir $f) (Get-Content (Join-Path $customerDir $f) -Raw)
  }
  Write-LfFile (Join-Path $bundleDir "VERSION") "$Version`n"
  $builtAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  Write-LfFile (Join-Path $bundleDir "RELEASE-INFO.txt") @"
Endpoint One $Version
Built:   $builtAt
Commit:  $commit
Image:   $image
Offline: $([bool]$Offline)
"@

  $installers = Get-ChildItem (Join-Path $PSScriptRoot "agent-installer") -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne ".gitkeep" }
  if ($installers) {
    $installers | Copy-Item -Destination (Join-Path $bundleDir "agent-installer")
    $manifest = Join-Path $PSScriptRoot "agent-installer\agent-manifest.json"
    $agentVersion = if (Test-Path $manifest) { (Get-Content $manifest -Raw | ConvertFrom-Json).version } else { "unknown" }
    Write-Host "Agent installers included (agent $agentVersion): $($installers.Name -join ', ')"
  } else {
    Write-Warning "docker\agent-installer is empty - the bundle has no agent installer. Build with 'npm run package -w @em/agent' and copy the 3 files there."
  }

  # --- Images -------------------------------------------------------------------------------
  Step "Exporting $image"
  docker save -o (Join-Path $bundleDir "images\endpoint-one-server-$Version.tar") $image
  if ($LASTEXITCODE -ne 0) { throw "docker save failed" }

  if ($Offline) {
    Step "Pulling and exporting SQL Server (offline bundle)"
    docker pull --platform linux/amd64 mcr.microsoft.com/mssql/server:2022-latest
    if ($LASTEXITCODE -ne 0) { throw "docker pull mssql failed" }
    docker save -o (Join-Path $bundleDir "images\mssql-server.tar") mcr.microsoft.com/mssql/server:2022-latest
    if ($LASTEXITCODE -ne 0) { throw "docker save mssql failed" }
  }

  # --- Checksums (sha256sum -c format) ------------------------------------------------------
  Step "Writing SHA256SUMS"
  $lines = Get-ChildItem $bundleDir -Recurse -File | Sort-Object FullName | ForEach-Object {
    $rel = $_.FullName.Substring($bundleDir.Length + 1).Replace('\', '/')
    "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $rel"
  }
  Write-LfFile (Join-Path $bundleDir "SHA256SUMS") (($lines -join "`n") + "`n")

  # --- Archive ------------------------------------------------------------------------------
  Step "Creating archive"
  $archive = Join-Path $releaseRoot "$bundleName.tar.gz"
  if (Test-Path $archive) { Remove-Item $archive -Force }
  tar -czf $archive -C $releaseRoot $bundleName
  if ($LASTEXITCODE -ne 0) { throw "tar failed" }
  $archiveHash = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-LfFile "$archive.sha256" "$archiveHash  $bundleName.tar.gz`n"
  Remove-Item $bundleDir -Recurse -Force

  $sizeMb = [math]::Round((Get-Item $archive).Length / 1MB)
  Write-Host ""
  Write-Host "Release ready: $archive ($sizeMb MB)" -ForegroundColor Green
  Write-Host "SHA-256:       $archiveHash"
  Write-Host "Next: copy it to the customer server and run 'sudo bash deploy.sh' inside the extracted folder (see INSTALL.md)."
}
finally {
  Pop-Location
}
