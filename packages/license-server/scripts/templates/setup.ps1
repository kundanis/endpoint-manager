<#
.SYNOPSIS
  First-run setup for the License Server (Machine B) - the vendor's own central server,
  installed once, serving every customer entity. Run this once, from wherever you
  extracted this package (it operates in place - nothing is copied to ProgramData).

  What it does: provisions (or reuses) a SQL Server database + login, generates
  JWT_SECRET, writes app\.env, generates the Prisma Client and applies all migrations,
  seeds the first LicenseAdmin, then registers and starts a Scheduled Task so the
  server runs on every boot with no visible console window. Mirrors
  packages/server/scripts/templates/setup.ps1 (Machine A's equivalent).
#>
[CmdletBinding()]
param(
    [string]$SqlServerInstance,
    [string]$DatabaseName = "LicenseServerDb",
    [string]$LoginName = "ls_app_login",
    [switch]$SkipDbProvision,
    [string]$DatabaseUrl,
    [string]$ShadowDatabaseUrl,
    [string]$LicenseAdminEmail,
    [securestring]$LicenseAdminPassword,
    [int]$Port = 4200,
    [switch]$SkipServiceRegistration,
    # A fresh SQL Server install only has its own auto-generated self-signed certificate,
    # which nothing trusts by default - defaults to $true so a brand-new machine works
    # out of the box (connections are still encrypted either way). Pass
    # -TrustServerCertificate:$false once a real/trusted certificate is installed and you
    # want strict validation - see docs/tls-setup.md.
    [bool]$TrustServerCertificate = $true
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$appDir = Join-Path $root "app"
$nodeExe = Join-Path $root "node\node.exe"
$taskName = "LicenseServer"

Write-Host "License Server - First-Run Setup"
Write-Host "=================================="

function New-RandomBase64($byteLength) {
    $bytes = New-Object byte[] $byteLength
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

# 1. Database
if (-not $SkipDbProvision -and -not $DatabaseUrl) {
    if (-not $SqlServerInstance) {
        $SqlServerInstance = Read-Host "SQL Server hostname (the machine's actual hostname, not 'localhost')"
    }
    $dbResult = & (Join-Path $root "provision-database.ps1") -SqlServerInstance $SqlServerInstance -DatabaseName $DatabaseName -LoginName $LoginName -TrustServerCertificate $TrustServerCertificate
    $DatabaseUrl = $dbResult.DatabaseUrl
    $ShadowDatabaseUrl = $dbResult.ShadowDatabaseUrl
}
elseif (-not $DatabaseUrl) {
    $DatabaseUrl = Read-Host "DATABASE_URL (sqlserver://host:1433;database=X;user=Y;password=Z;encrypt=true;trustServerCertificate=true)"
    $ShadowDatabaseUrl = Read-Host "SHADOW_DATABASE_URL (same format, a second empty database - only used by dev tooling, never by this running app)"
}

# 2. Vendor admin account
if (-not $LicenseAdminEmail) {
    $LicenseAdminEmail = Read-Host "Vendor admin email (logs into the License Console)"
}
$generatedAdminPassword = $false
if (-not $LicenseAdminPassword -or $LicenseAdminPassword.Length -eq 0) {
    $adminPasswordPlain = (New-RandomBase64 18) -replace '[+/=]', ''
    $generatedAdminPassword = $true
}
else {
    # PowerShell 5.1 has no ConvertFrom-SecureString -AsPlainText - a throwaway
    # PSCredential is the standard way to unwrap one.
    $adminPasswordPlain = (New-Object System.Management.Automation.PSCredential("admin", $LicenseAdminPassword)).GetNetworkCredential().Password
}

# 3. Secrets
$jwtSecret = New-RandomBase64 48

# 4. Write .env
Write-Host "Writing app\.env ..."
$envContent = @"
PORT=$Port
JWT_SECRET=$jwtSecret
LICENSE_ADMIN_EMAIL=$LicenseAdminEmail
LICENSE_ADMIN_PASSWORD=$adminPasswordPlain
TLS_PFX_PATH=
TLS_PFX_PASSPHRASE=
DATABASE_URL="$DatabaseUrl"
SHADOW_DATABASE_URL="$ShadowDatabaseUrl"
"@
Set-Content -Path (Join-Path $appDir ".env") -Value $envContent -Encoding ASCII

# On a network with a TLS-inspecting proxy (self-signed cert in the chain), Prisma's
# engine-binary download and Node's native fetch() both fail with "self-signed
# certificate in certificate chain" unless Node is told to trust the OS certificate
# store too - same fix already documented for Machine A's setup.ps1.
$env:NODE_OPTIONS = "--use-system-ca"

# 5. Generate the Prisma Client, then apply migrations.
Push-Location $appDir
$prismaCli = Join-Path $appDir "node_modules\prisma\build\index.js"
Write-Host "Generating Prisma Client..."
& $nodeExe $prismaCli generate --schema (Join-Path $appDir "prisma\schema.prisma")
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "prisma generate failed" }

Write-Host "Applying database migrations..."
& $nodeExe $prismaCli migrate deploy --schema (Join-Path $appDir "prisma\schema.prisma")
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "prisma migrate deploy failed" }

# 6. Seed the first LicenseAdmin
Write-Host "Seeding the first vendor admin user..."
$tsxCli = Join-Path $appDir "node_modules\tsx\dist\cli.mjs"
& $nodeExe $tsxCli (Join-Path $appDir "prisma\seed.ts")
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Seeding failed" }
Pop-Location

# 7. Register + start the Scheduled Task (mirrors Machine A's setup.ps1 - schtasks.exe is
# built into Windows, no third-party service wrapper needed).
if (-not $SkipServiceRegistration) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    schtasks /query /tn $taskName 2>$null | Out-Null
    $taskExists = ($LASTEXITCODE -eq 0)
    if ($taskExists) {
        Write-Host "Existing installation detected - stopping it before updating."
        schtasks /end /tn $taskName 2>$null | Out-Null
    }
    $ErrorActionPreference = $prevEap

    $entryPoint = Join-Path $appDir "dist\index.js"
    $taskXmlPath = Join-Path $env:TEMP "LicenseServerTask.xml"
    $taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$nodeExe</Command>
      <Arguments>"$entryPoint"</Arguments>
      <WorkingDirectory>$appDir</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
    Set-Content -Path $taskXmlPath -Value $taskXml -Encoding Unicode
    schtasks /create /tn $taskName /xml $taskXmlPath /f | Out-Null
    $createExitCode = $LASTEXITCODE
    Remove-Item $taskXmlPath -Force
    if ($createExitCode -ne 0) { throw "Failed to register the scheduled task (schtasks exit code $createExitCode)." }

    Write-Host "Starting the License Server..."
    schtasks /run /tn $taskName | Out-Null
    Start-Sleep -Seconds 3
}

Write-Host ""
Write-Host "Setup complete."
Write-Host "License Console: http://localhost:$Port/"
Write-Host "Vendor admin email: $LicenseAdminEmail"
if ($generatedAdminPassword) {
    Write-Host "Vendor admin password (generated - shown once, save it now): $adminPasswordPlain"
}
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Log in to the License Console above."
Write-Host "  2. Create an Entity for each customer, and issue it a License Key."
Write-Host "  3. Give the customer this server's URL and the key - they enter both in"
Write-Host "     their own Endpoint Manager console (Licensing -> Licence API, then Activate)."
