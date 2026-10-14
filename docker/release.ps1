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

  # --- Smoke tests: a failing image never becomes a release -------------------------------
  # Each check guards against a failure seen in a real deployment:
  #   1. the entrypoint script actually executes (CRLF made it "no such file or directory");
  #   2. it has no CR characters at all;
  #   3. the server bytecode boots and serves /health AND the console page.
  # The DB-dependent startup path (migrations, seed) is not exercised here - no database is
  # created; it runs on the target server, guarded by deploy.sh's health wait.
  Step "Smoke-testing $image"
  $marker = docker run --rm $image echo "entrypoint-ok" 2>&1 | Out-String
  if ($marker -notmatch "entrypoint-ok") { throw "SMOKE FAIL: the image's entrypoint does not execute:`n$marker" }
  Write-Host "  entrypoint executes ........ OK"

  $crLines = (docker run --rm --entrypoint grep $image -c "`r" /usr/local/bin/docker-entrypoint.sh 2>$null | Out-String).Trim()
  if ($crLines -ne "0") { throw "SMOKE FAIL: docker-entrypoint.sh in the image has CRLF line endings ($crLines lines)." }
  Write-Host "  entrypoint line endings .... OK (LF)"

  $smokeDir = Join-Path $env:TEMP "endpoint-one-smoke"
  New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null
  # Single quotes only inside the JS: it's passed through a file, never a command line.
  Write-LfFile (Join-Path $smokeDir "smoke.cjs") @'
require('/app/dist/bootstrap.cjs');
setTimeout(async () => {
  let ok = true;
  try {
    const h = await fetch('http://127.0.0.1:4000/health');
    if (!h.ok) { console.log('SMOKE FAIL health ' + h.status); ok = false; }
    const r = await fetch('http://127.0.0.1:4000/');
    const t = await r.text();
    if (r.status !== 200 || !/<title>Endpoint One/i.test(t)) { console.log('SMOKE FAIL console ' + r.status + ' ' + t.slice(0, 80)); ok = false; }
  } catch (e) { console.log('SMOKE FAIL ' + e.message); ok = false; }
  console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
  process.exit(ok ? 0 : 1);
}, 5000);
'@
  $smokeOut = docker run --rm -v "${smokeDir}:/smoke:ro" `
    -e "DATABASE_URL=sqlserver://smoke-no-db:1433;database=x;user=x;password=x;encrypt=true;trustServerCertificate=true" `
    -e "JWT_SECRET=smoke-test-secret-not-used-anywhere" `
    -e "FIELD_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=" `
    -e "PORT=4000" --entrypoint node $image /smoke/smoke.cjs 2>&1 | Out-String
  if ($smokeOut -notmatch "SMOKE OK") {
    $fails = ($smokeOut -split "`n" | Where-Object { $_ -match "SMOKE FAIL" }) -join "`n"
    throw "SMOKE FAIL: the server did not boot and serve the console:`n$fails"
  }
  Write-Host "  server boots + console ..... OK"

  # HTTPS exactly as `deploy.sh --install-cert` sets it up: an openssl-made PFX, TLS on 4443,
  # plain HTTP kept on 4000 for agents. Self-signed, generated inside the container.
  Write-LfFile (Join-Path $smokeDir "smoke-tls.cjs") @'
const { execSync } = require('child_process');
execSync('openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/k.pem -out /tmp/c.pem -days 1 -subj /CN=smoke.local', { stdio: 'ignore' });
execSync('openssl pkcs12 -export -out /tmp/s.pfx -inkey /tmp/k.pem -in /tmp/c.pem -passout pass:smoke', { stdio: 'ignore' });
process.env.TLS_PFX_PATH = '/tmp/s.pfx';
process.env.TLS_PFX_PASSPHRASE = 'smoke';
process.env.TLS_PORT = '4443';
require('/app/dist/bootstrap.cjs');
setTimeout(() => {
  require('https').get({ host: '127.0.0.1', port: 4443, path: '/', rejectUnauthorized: false }, (res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', async () => {
      let ok = res.statusCode === 200 && /<title>Endpoint One/i.test(body);
      if (!ok) console.log('SMOKE FAIL https console ' + res.statusCode);
      try {
        const h = await fetch('http://127.0.0.1:4000/health');
        if (!h.ok) { ok = false; console.log('SMOKE FAIL http alongside https ' + h.status); }
      } catch (e) { ok = false; console.log('SMOKE FAIL http alongside https ' + e.message); }
      console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
      process.exit(ok ? 0 : 1);
    });
  }).on('error', (e) => { console.log('SMOKE FAIL https ' + e.message); process.exit(1); });
}, 5000);
'@
  $tlsOut = docker run --rm -v "${smokeDir}:/smoke:ro" `
    -e "DATABASE_URL=sqlserver://smoke-no-db:1433;database=x;user=x;password=x;encrypt=true;trustServerCertificate=true" `
    -e "JWT_SECRET=smoke-test-secret-not-used-anywhere" `
    -e "FIELD_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=" `
    -e "PORT=4000" --entrypoint node $image /smoke/smoke-tls.cjs 2>&1 | Out-String
  if ($tlsOut -notmatch "SMOKE OK") {
    $fails = ($tlsOut -split "`n" | Where-Object { $_ -match "SMOKE FAIL" }) -join "`n"
    throw "SMOKE FAIL: HTTPS mode did not work:`n$fails"
  }
  Write-Host "  https + http side by side .. OK"

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

  # --- Bundle text files must be clean Linux files ----------------------------------------
  foreach ($f in "deploy.sh", "docker-compose.yml", "INSTALL.md", "VERSION", "RELEASE-INFO.txt") {
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $bundleDir $f))
    $bad = @($bytes | Where-Object { $_ -lt 32 -and $_ -ne 9 -and $_ -ne 10 }).Count
    if ($bad -gt 0) { throw "SMOKE FAIL: bundle file $f contains $bad CR/control characters." }
  }
  $deployText = Get-Content (Join-Path $bundleDir "deploy.sh") -Raw
  if ($deployText -notmatch '(?m)^#!/usr/bin/env bash$') { throw "SMOKE FAIL: deploy.sh lost its shebang line." }
  Write-Host "  bundle files are clean LF . OK"

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
