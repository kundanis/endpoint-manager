<#
.SYNOPSIS
    Isolates this machine at the Windows Firewall level. Only the specified
    exception IPs are reachable, and only on the specified ports. Everything
    else — including LocalSubnet, ping (ICMP), and SMB — is blocked.

.NOTES
    - Must be run in an elevated (Administrator) PowerShell session.
    - Exports current firewall state to a .wfw backup before making changes.
    - Safe to re-run: removes any existing Quarantine-* rules first.

.PARAMETER ExceptionIPs
    IP addresses that should remain reachable, restricted to -AllowedPorts.
    Defaults to 10.10.6.154 and 10.10.6.115.

.PARAMETER AllowedPorts
    TCP ports allowed to/from the exception IPs. Defaults to 4000, 8443.

.PARAMETER BackupPath
    Where to save the pre-quarantine firewall state export.

.EXAMPLE
    .\Block-Quarantine.ps1
    .\Block-Quarantine.ps1 -ExceptionIPs "10.10.6.154","10.10.6.115" -AllowedPorts 4000,8443
#>

[CmdletBinding()]
param(
    [string[]]$ExceptionIPs  = @("10.10.6.154", "10.10.6.115"),
    [int[]]$AllowedPorts     = @(4000, 8443),
    [string]$BackupPath
)

# --- Require elevation ---
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal   = New-Object Security.Principal.WindowsPrincipal($currentUser)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator. Aborting."
    exit 1
}

# --- Backup current state ---
if (-not $BackupPath) {
    $backupDir = "C:\FirewallBackup"
    if (-not (Test-Path $backupDir)) { New-Item -Path $backupDir -ItemType Directory -Force | Out-Null }
    $timestamp  = Get-Date -Format "yyyyMMdd-HHmmss"
    $BackupPath = Join-Path $backupDir "pre-quarantine-$timestamp.wfw"
}

Write-Host "Backing up current firewall state to $BackupPath ..." -ForegroundColor Cyan
netsh advfirewall export "$BackupPath" | Out-Null
if (Test-Path $BackupPath) {
    Write-Host "Backup saved." -ForegroundColor Green
} else {
    Write-Warning "Backup export may have failed. Continuing anyway, but you won't have this rollback point."
}

# --- Clean slate ---
Write-Host "Removing any existing Quarantine-* rules..." -ForegroundColor Cyan
$existing = Get-NetFirewallRule -DisplayName "Quarantine-*" -ErrorAction SilentlyContinue
if ($existing) { $existing | Remove-NetFirewallRule }

# --- Enable all profiles, default-block ---
Write-Host "Enabling all firewall profiles and setting default action to Block..." -ForegroundColor Cyan
Set-NetFirewallProfile -Profile Domain, Private, Public -Enabled True -DefaultInboundAction Block -DefaultOutboundAction Block

# --- Explicitly block LocalSubnet (all protocols/ports) ---
Write-Host "Blocking LocalSubnet traffic..." -ForegroundColor Cyan
New-NetFirewallRule -DisplayName "Quarantine-Block-LocalSubnet-Out" -Direction Outbound -RemoteAddress LocalSubnet -Action Block | Out-Null
New-NetFirewallRule -DisplayName "Quarantine-Block-LocalSubnet-In"  -Direction Inbound  -RemoteAddress LocalSubnet -Action Block | Out-Null

# --- Explicitly block ICMP (ping), both v4 and v6, in and out ---
Write-Host "Blocking ICMP (ping)..." -ForegroundColor Cyan
New-NetFirewallRule -DisplayName "Quarantine-Block-ICMPv4-Out" -Direction Outbound -Protocol ICMPv4 -Action Block | Out-Null
New-NetFirewallRule -DisplayName "Quarantine-Block-ICMPv4-In"  -Direction Inbound  -Protocol ICMPv4 -Action Block | Out-Null
New-NetFirewallRule -DisplayName "Quarantine-Block-ICMPv6-Out" -Direction Outbound -Protocol ICMPv6 -Action Block | Out-Null
New-NetFirewallRule -DisplayName "Quarantine-Block-ICMPv6-In"  -Direction Inbound  -Protocol ICMPv6 -Action Block | Out-Null

# --- Explicitly block SMB (445, 139) globally ---
Write-Host "Blocking SMB (TCP 445, 139)..." -ForegroundColor Cyan
New-NetFirewallRule -DisplayName "Quarantine-Block-SMB-Out" -Direction Outbound -Protocol TCP -RemotePort 445,139 -Action Block | Out-Null
New-NetFirewallRule -DisplayName "Quarantine-Block-SMB-In"  -Direction Inbound  -Protocol TCP -LocalPort 445,139  -Action Block | Out-Null

# --- Allow exception IPs, restricted to AllowedPorts only ---
Write-Host "Adding port-restricted exceptions for: $($ExceptionIPs -join ', ') on ports $($AllowedPorts -join ', ')" -ForegroundColor Cyan
$i = 1
foreach ($ip in $ExceptionIPs) {
    # Outbound: this machine -> exception IP, destination (remote) port restricted
    New-NetFirewallRule -DisplayName "Quarantine-Allow-Exception$i-Out" -Direction Outbound -RemoteAddress $ip -Protocol TCP -RemotePort $AllowedPorts -Action Allow | Out-Null
    # Inbound: exception IP -> this machine, local (listening) port restricted
    New-NetFirewallRule -DisplayName "Quarantine-Allow-Exception$i-In"  -Direction Inbound  -RemoteAddress $ip -Protocol TCP -LocalPort $AllowedPorts  -Action Allow | Out-Null
    $i++
}

# --- Verify ---
Write-Host "`n=== Current Quarantine-* rules ===" -ForegroundColor Yellow
Get-NetFirewallRule -DisplayName "Quarantine-*" | Select-Object DisplayName, Direction, Action, Enabled | Format-Table -AutoSize

Write-Host "`n=== Firewall profile state ===" -ForegroundColor Yellow
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction | Format-Table -AutoSize

Write-Host "`nQuarantine applied." -ForegroundColor Green
Write-Host "Reachable: $($ExceptionIPs -join ', ') on TCP ports $($AllowedPorts -join ', ') only." -ForegroundColor Green
Write-Host "Blocked: everything else, including LocalSubnet, ICMP (ping), and SMB (445/139)." -ForegroundColor Green
Write-Host "Backup of pre-quarantine state: $BackupPath" -ForegroundColor Green
Write-Host "To revert: .\Revert-Quarantine.ps1  (or  .\Revert-Quarantine.ps1 -BackupPath `"$BackupPath`" for exact restore)" -ForegroundColor Green
