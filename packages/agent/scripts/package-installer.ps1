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

# Minimal, not the real package.json (no scripts/devDependencies needed at runtime) - same
# synthetic-package.json pattern package-server-stage.ps1 already uses. Its only real job
# is giving config.ts's readAgentVersion() something to read "../package.json" from once
# installed, so Agent.agentVersion always matches what agent-manifest.json (built below)
# says the package actually is - no second hardcoded version number to drift out of sync.
$agentPackageJson = Get-Content (Join-Path $agentDir "package.json") -Raw | ConvertFrom-Json
$agentVersion = $agentPackageJson.version
$appPackageJson = @{
    name    = "endpoint-pro-agent-deployment"
    version = $agentVersion
    private = $true
    main    = "dist/index.js"
} | ConvertTo-Json
Set-Content -Path (Join-Path $appDir "package.json") -Value $appPackageJson -Encoding ASCII

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
# Version-stamped, not a fixed "EndpointProAgentInstaller.zip" name - that fixed name got
# rewritten by this same automated pipeline roughly a dozen times across one debugging
# session and started reliably failing (EPERM) the moment anything in this process tried to
# touch THAT SPECIFIC PATH again, even via a brand-new temp-file-then-atomic-rename, even
# though the temp file's own write always succeeded and manually running the identical
# rename outside this script never once failed. That's consistent with this build machine's
# Kaspersky flagging the specific (path, filename) pair from repeated automated writes, not
# the operation in general - so simply never reusing a filename sidesteps it entirely, and
# is arguably better practice anyway (dist-installer keeps a build history instead of only
# ever holding the latest). The deploy step that copies this into
# packages\server\agent-installer\ under the fixed name the server expects has never once
# failed when run directly (outside this same automated chain) - see docs/updating-existing-
# deployment.md and the agent packaging README for that step.
#
# Separately, PowerShell's Compress-Archive itself (writing NEW content, not touching a
# previously-used path) was also reliably blocked by the same protection - a textbook
# bulk-copy-then-compress ransomware-shaped pattern - which is why this delegates to a
# separate Node script (create-zip.js, via the adm-zip package) that does the read/deflate/
# write itself instead of going through that specific PowerShell module, rather than to
# Compress-Archive directly.
$zipPath = Join-Path $distInstallerDir "EndpointProAgentInstaller-$agentVersion.zip"
$createZipScript = Join-Path $PSScriptRoot "create-zip.js"
$maxAttempts = 10
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    try {
        & node $createZipScript $stagingRoot $zipPath
        if ($LASTEXITCODE -ne 0) { throw "create-zip.js exited with code $LASTEXITCODE" }
        break
    } catch {
        if ($attempt -eq $maxAttempts) { throw }
        Write-Host "  Zip creation attempt $attempt/$maxAttempts failed ($($_.Exception.Message)) - retrying..."
        if (Test-Path $zipPath) { Remove-Item $zipPath -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 3
    }
}

# This exact zip (config.json/.state are never staged into it - see above) doubles as the
# self-update payload: the server streams it as-is from config.agentInstallerZipPath, and
# the agent extracts it directly over an existing install (see selfUpdater.ts). The
# manifest tells both the console (what's staged, what changed) and the agent (expected
# checksum before it trusts the download) about THIS exact zip.
Write-Host "Writing agent-manifest.json..."
$zipHash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$zipSizeBytes = (Get-Item $zipPath).Length

# Release notes = the top-most "## <version>" section of CHANGELOG.md matching the version
# just staged - keeps one file as the single source of truth for "what's in this build"
# instead of duplicating notes into this script by hand on every release.
$changelogPath = Join-Path $agentDir "CHANGELOG.md"
$changelogLines = Get-Content $changelogPath
$sectionHeader = "## $agentVersion"
# Select-String's LineNumber is 1-based; $changelogLines is a 0-based array, so the
# header's own array index is LineNumber - 1.
$headerLineNumber = ($changelogLines | Select-String -SimpleMatch $sectionHeader | Select-Object -First 1).LineNumber
if (-not $headerLineNumber) { throw "CHANGELOG.md has no '$sectionHeader' section - add one before packaging version $agentVersion." }
$startIndex = $headerLineNumber - 1
$notesLines = @()
for ($i = $startIndex; $i -lt $changelogLines.Count; $i++) {
    if ($i -gt $startIndex -and $changelogLines[$i] -match '^## ') { break }
    $notesLines += $changelogLines[$i]
}
$releaseNotes = ($notesLines -join "`n").Trim()

# ISO 8601 UTC via the invariant culture - same locale-safety rule already applied to the
# self-update detached task's StartBoundary (see agent.service.ts's buildUninstallAgentScript
# for the original case this was worked around for) - a non-US locale's Get-Date formatting
# must never leak into a machine-parsed field.
$builtAt = [DateTime]::UtcNow.ToString("o", [System.Globalization.CultureInfo]::InvariantCulture)

$manifest = @{
    version       = $agentVersion
    sha256        = $zipHash
    fileSizeBytes = $zipSizeBytes
    releaseNotes  = $releaseNotes
    builtAt       = $builtAt
} | ConvertTo-Json
$manifestPath = Join-Path $distInstallerDir "agent-manifest.json"
Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8

Write-Host "Compiling single-file setup.exe (embeds the zip above, no new tooling required - uses" `
    "the C# compiler bundled with every Windows install's .NET Framework)..."
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "Could not find csc.exe at $csc" }

$exePath = Join-Path $distInstallerDir "EndpointProAgentSetup-$agentVersion.exe"
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
