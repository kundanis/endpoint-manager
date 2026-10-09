<#
.SYNOPSIS
    Reverts the quarantine applied by Block-Quarantine.ps1.

.DESCRIPTION
    Default: removes all Quarantine-star rules and restores default firewall
    profile actions to Allow. Reports exactly what it removed or changed, and
    surfaces any errors instead of hiding them.

    If -BackupPath is supplied (a .wfw file created by Block-Quarantine.ps1),
    does a full netsh import instead, restoring the exact pre-quarantine
    state (all rules plus profile settings). This is the more reliable option.

.PARAMETER BackupPath
    Optional path to a .wfw backup file. Takes precedence over manual revert.

.EXAMPLE
    .\Revert-Quarantine.ps1
    .\Revert-Quarantine.ps1 -BackupPath "C:\FirewallBackup\pre-quarantine-20260828-101500.wfw"
#>

[CmdletBinding()]
param(
    [string]$BackupPath
)

# --- Require elevation ---
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal   = New-Object Security.Principal.WindowsPrincipal($currentUser)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator. Aborting."
    exit 1
}

if ($BackupPath) {
    if (-not (Test-Path $BackupPath)) {
        Write-Error "Backup file not found at: $BackupPath"
        exit 1
    }
    Write-Host "Restoring firewall state from backup: $BackupPath ..." -ForegroundColor Cyan
    $result = netsh advfirewall import "$BackupPath" 2>&1
    Write-Host $result
    if ($LASTEXITCODE -ne 0) {
        Write-Error "netsh import returned a non-zero exit code ($LASTEXITCODE). See output above."
        exit 1
    }
    Write-Host "Restore complete." -ForegroundColor Green
}
else {
    Write-Host "No backup path supplied. Reverting manually." -ForegroundColor Cyan

    $rules = Get-NetFirewallRule -DisplayName "Quarantine-*" -ErrorAction SilentlyContinue
    if (-not $rules) {
        Write-Host "No Quarantine rules found. Nothing to remove." -ForegroundColor Yellow
    } else {
        Write-Host "Found $($rules.Count) Quarantine rule(s). Removing..." -ForegroundColor Cyan
        foreach ($rule in $rules) {
            try {
                Remove-NetFirewallRule -Name $rule.Name -ErrorAction Stop
                Write-Host "  Removed: $($rule.DisplayName)" -ForegroundColor Green
            } catch {
                Write-Warning "  FAILED to remove $($rule.DisplayName): $($_.Exception.Message)"
            }
        }
    }

    Write-Host "Restoring default profile actions to Allow..." -ForegroundColor Cyan
    try {
        Set-NetFirewallProfile -Profile Domain, Private, Public -DefaultInboundAction Allow -DefaultOutboundAction Allow -ErrorAction Stop
        Write-Host "Profile defaults restored." -ForegroundColor Green
    } catch {
        Write-Warning "FAILED to reset profile defaults: $($_.Exception.Message)"
    }

    Write-Host "Note: profile Enabled or Disabled state (Domain, Private, Public) was not changed by this script." -ForegroundColor Yellow
    Write-Host "If a profile was disabled before quarantine, set it back manually if needed." -ForegroundColor Yellow
}

# --- Verify ---
Write-Host ""
Write-Host "=== Remaining Quarantine rules (should be empty) ===" -ForegroundColor Yellow
$remaining = Get-NetFirewallRule -DisplayName "Quarantine-*" -ErrorAction SilentlyContinue
if ($remaining) {
    $remaining | Select-Object DisplayName, Direction, Action, Enabled | Format-Table -AutoSize
    Write-Warning "$($remaining.Count) Quarantine rule(s) still present. See above."
} else {
    Write-Host "None." -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Firewall profile state ===" -ForegroundColor Yellow
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction | Format-Table -AutoSize

Write-Host ""
Write-Host "Run a live connectivity test to confirm:" -ForegroundColor Green
Write-Host "  Test-NetConnection 8.8.8.8 -Port 443" -ForegroundColor Green
Write-Host "  Test-NetConnection google.com -Port 443" -ForegroundColor Green
Write-Host "  Test-Connection <local-machine-ip>" -ForegroundColor Green
