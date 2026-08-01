<#
.SYNOPSIS
  Provisions a fresh SQL Server database + a least-privilege app login for the License
  Server. Mirrors packages/server/scripts/provision-database.ps1 exactly (same
  dedicated-login-scoped-to-db_owner-on-one-database-only pattern), just with License
  Server defaults.

.PARAMETER SqlServerInstance
  Hostname (or host\instance) of the target SQL Server. Use the machine's actual
  hostname, not "localhost" — see docs/tls-setup.md's DB-TLS note.

.PARAMETER DatabaseName
  Defaults to LicenseServerDb. A "<name>_shadow" database is also created — required by
  Prisma's schema (shadowDatabaseUrl), even though only `prisma migrate dev` (not
  `migrate deploy`, which this deployment uses) actually reads from it.

.PARAMETER LoginName
  Defaults to ls_app_login.

.PARAMETER Password
  If omitted, a strong random password is generated and returned (never printed).

.PARAMETER TrustServerCertificate
  Defaults to $true - a fresh SQL Server install has only its own auto-generated
  self-signed certificate, which nothing trusts by default, so `trustServerCertificate=
  false` (strict validation) fails with "certificate chain... terminated in a root
  certificate which is not trusted" on essentially every brand-new machine. Connections
  are still encrypted (encrypt=true) either way. Pass -TrustServerCertificate:$false once
  a real (or properly-trusted) certificate is installed and you want strict validation.

.OUTPUTS
  PSCustomObject { SqlServerInstance, DatabaseName, LoginName, Password,
  DatabaseUrl, ShadowDatabaseUrl } — the caller is responsible for writing these into
  .env; this script never writes or prints the password itself.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SqlServerInstance,

    [string]$DatabaseName = "LicenseServerDb",
    [string]$LoginName = "ls_app_login",
    [string]$Password,
    [bool]$TrustServerCertificate = $true
)

$ErrorActionPreference = "Stop"

function New-StrongPassword {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $b64 = [Convert]::ToBase64String($bytes) -replace '[+/=]', ''
    return "$($b64.Substring(0, 20))!Aa9"
}

if (-not $Password) {
    $Password = New-StrongPassword
}

$shadowDatabaseName = "${DatabaseName}_shadow"
$sqlFile = Join-Path $env:TEMP "provision-ls-db-$([guid]::NewGuid().ToString('N')).sql"
$safePassword = $Password -replace "'", ""

$sql = @"
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$LoginName')
BEGIN
    CREATE LOGIN [$LoginName] WITH PASSWORD = N'$safePassword', CHECK_POLICY = ON;
END
ELSE
BEGIN
    -- Re-running against a login left over from an earlier partial/failed run - without
    -- this, the login keeps whatever password an earlier run set, while this run still
    -- reports the fresh password it generated as if it had been applied.
    ALTER LOGIN [$LoginName] WITH PASSWORD = N'$safePassword';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = N'$DatabaseName')
BEGIN
    CREATE DATABASE [$DatabaseName];
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = N'$shadowDatabaseName')
BEGIN
    CREATE DATABASE [$shadowDatabaseName];
END
GO

USE [$DatabaseName];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$LoginName')
BEGIN
    CREATE USER [$LoginName] FOR LOGIN [$LoginName];
    ALTER ROLE db_owner ADD MEMBER [$LoginName];
END
GO

USE [$shadowDatabaseName];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$LoginName')
BEGIN
    CREATE USER [$LoginName] FOR LOGIN [$LoginName];
    ALTER ROLE db_owner ADD MEMBER [$LoginName];
END
GO
"@

Set-Content -Path $sqlFile -Value $sql -Encoding UTF8
try {
    Write-Host "Provisioning $DatabaseName / $shadowDatabaseName on $SqlServerInstance ..."
    # -C (trust server certificate) - newer go-sqlcmd builds default to requiring a
    # validated certificate too, and would hit the exact same untrusted-self-signed-cert
    # failure as Prisma's own connection otherwise.
    & sqlcmd -S $SqlServerInstance -E -C -i $sqlFile -b
    if ($LASTEXITCODE -ne 0) {
        throw "sqlcmd exited with code $LASTEXITCODE - check the output above."
    }
}
finally {
    Remove-Item -Path $sqlFile -Force -ErrorAction SilentlyContinue
}

$trustCertValue = if ($TrustServerCertificate) { "true" } else { "false" }

[PSCustomObject]@{
    SqlServerInstance = $SqlServerInstance
    DatabaseName       = $DatabaseName
    LoginName          = $LoginName
    Password           = $Password
    DatabaseUrl        = "sqlserver://${SqlServerInstance}:1433;database=$DatabaseName;user=$LoginName;password=$Password;encrypt=true;trustServerCertificate=$trustCertValue"
    ShadowDatabaseUrl  = "sqlserver://${SqlServerInstance}:1433;database=$shadowDatabaseName;user=$LoginName;password=$Password;encrypt=true;trustServerCertificate=$trustCertValue"
}
