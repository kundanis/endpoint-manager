<#
.SYNOPSIS
  Provisions a fresh SQL Server database + a least-privilege app login for a new
  Endpoint Manager entity deployment. Mirrors the exact pattern used for this
  project's own EndpointManagerDb/em_app_login (and license-server's LicenseServerDb/
  ls_app_login): a dedicated login, scoped to db_owner on its own database only -
  never sa, never a shared login across entities.

.PARAMETER SqlServerInstance
  Hostname (or host\instance) of the target SQL Server. Use the machine's actual
  hostname, not "localhost" - SQL Server's auto-generated self-signed certificate is
  issued for the hostname, so DATABASE_URL's trustServerCertificate=false only
  validates correctly against that name (see docs/tls-setup.md's DB-TLS note).

.PARAMETER DatabaseName
  Defaults to EndpointManagerDb. A "<name>_shadow" database is also created -
  required by Prisma's schema (shadowDatabaseUrl), even though only `prisma migrate
  dev` (not `migrate deploy`, which this deployment uses) actually reads from it.

.PARAMETER LoginName
  Defaults to em_app_login.

.PARAMETER Password
  If omitted, a strong random password is generated and returned (never printed).

.PARAMETER TrustServerCertificate
  Defaults to $true - a fresh SQL Server install has only its own auto-generated
  self-signed certificate, which nothing trusts by default, so `trustServerCertificate=
  false` (strict validation) fails with "certificate chain... terminated in a root
  certificate which is not trusted" on essentially every brand-new customer machine.
  Connections are still encrypted (encrypt=true) either way - this only controls whether
  the certificate's identity is also validated. Pass -TrustServerCertificate:$false once
  a real (or properly-trusted) certificate is installed on the SQL Server and you want
  strict validation - see docs/tls-setup.md.

.OUTPUTS
  PSCustomObject { SqlServerInstance, DatabaseName, LoginName, Password,
  DatabaseUrl, ShadowDatabaseUrl } - the caller is responsible for writing these into
  .env; this script never writes or prints the password itself.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SqlServerInstance,

    [string]$DatabaseName = "EndpointManagerDb",
    [string]$LoginName = "em_app_login",
    [string]$Password,
    [bool]$TrustServerCertificate = $true
)

$ErrorActionPreference = "Stop"

function New-StrongPassword {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $b64 = [Convert]::ToBase64String($bytes) -replace '[+/=]', ''
    # Fixed safe suffix guarantees upper/lower/digit/symbol regardless of what the
    # random slice happened to contain, satisfying default SQL Server password policy.
    return "$($b64.Substring(0, 20))!Aa9"
}

if (-not $Password) {
    $Password = New-StrongPassword
}

$shadowDatabaseName = "${DatabaseName}_shadow"
$sqlFile = Join-Path $env:TEMP "provision-em-db-$([guid]::NewGuid().ToString('N')).sql"

# Login/DB/user names are our own fixed defaults or admin-supplied identifiers, not
# end-user free text - still stripped of a stray quote defensively since the generated
# password is interpolated directly into a T-SQL string literal below.
$safePassword = $Password -replace "'", ""

$sql = @"
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$LoginName')
BEGIN
    CREATE LOGIN [$LoginName] WITH PASSWORD = N'$safePassword', CHECK_POLICY = ON;
END
ELSE
BEGIN
    -- Re-running against a login left over from an earlier partial/failed run (e.g. a
    -- prior attempt whose DROP DATABASE failed because a lingering connection was still
    -- open, which then blocks DROP LOGIN too) - without this, the login would keep
    -- whatever password an EARLIER run set, while this run still reports the fresh
    -- password it generated, so DATABASE_URL would be written with a password that was
    -- never actually applied.
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
