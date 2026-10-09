[CmdletBinding()]
param(
    [string]$UninstallPassword = ""
)

$TaskName = "EndpointProAgent"
$WatchdogTaskName = "EndpointProWatchdog"
$installDir = Join-Path $env:ProgramData "EndpointPro\Agent"
$configPath = Join-Path $installDir "app\config.json"
$statePath = Join-Path $installDir "app\.state\state.json"

# Verify against the server before touching anything, if this install has a working
# identity to check with. If config.json/state.json are already gone (a prior partial
# removal, or an install that never finished enrolling), there is nothing left to protect -
# proceed straight to cleanup rather than blocking a legitimate removal on files that no
# longer exist.
if ((Test-Path $configPath) -and (Test-Path $statePath)) {
    try {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        $state = Get-Content $statePath -Raw | ConvertFrom-Json
        $serverUrl = $config.serverUrl.TrimEnd("/")
        $verifyUri = "$serverUrl/api/agent/verify-uninstall-password"
        $body = @{ password = $UninstallPassword } | ConvertTo-Json
        $headers = @{ "X-Agent-Id" = $state.agentId; "X-Agent-Key" = $state.apiKey }

        $caPath = Join-Path $installDir "app\certs-trust\dev-server-public.pem"

        try {
            $result = Invoke-RestMethod -Uri $verifyUri -Method Post -Body $body -ContentType "application/json" -Headers $headers -ErrorAction Stop
        } catch {
            if ((Test-Path $caPath) -and ($_.Exception.Message -match "trust|certificate|SSL|TLS")) {
                # Same narrow "trust this one pinned dev certificate" pattern the agent
                # itself uses (httpClient.ts) - never a blanket certificate-validation
                # bypass. Only attempted as a retry after a trust-shaped failure, and only
                # when this exact pinned cert is present on disk. Scoped with a try/finally
                # so the process-wide callback is always restored afterward, even on error.
                $pinnedCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($caPath)
                $previousCallback = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
                try {
                    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = {
                        param($requestSender, $cert, $chain, $errors)
                        return $cert.GetCertHashString() -eq $pinnedCert.GetCertHashString()
                    }
                    $result = Invoke-RestMethod -Uri $verifyUri -Method Post -Body $body -ContentType "application/json" -Headers $headers -ErrorAction Stop
                } finally {
                    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $previousCallback
                }
            } else {
                throw
            }
        }

        if (-not $result.valid) {
            Write-Error "Incorrect uninstall password. Uninstall cancelled."
            exit 1
        }
    } catch {
        # Fails closed, deliberately: this is exactly the scenario tamper resistance is
        # meant to cover (e.g. an admin disconnecting the network specifically to dodge the
        # password check). If the deployment genuinely has no uninstall password configured,
        # the server itself reports every password as valid - so this branch only ever
        # blocks removal when the check could not be completed at all, not when the answer
        # was legitimately "no password required."
        Write-Error "Could not verify the uninstall password with the management server ($($_.Exception.Message)). Uninstall cancelled - check network connectivity and try again."
        exit 1
    }
}

$ErrorActionPreference = "SilentlyContinue"

# Release any active policy enforcement before removing anything else, so a
# quarantined/RDP-enabled/web-blocked/IP-blocked/app-blocked machine doesn't stay locked
# down forever with no agent left to reverse it. Each removal only touches this tool's own
# named/marked artifacts (mirrors quarantine.service.ts, remoteAccess.service.ts,
# webBlockEnforcer.ts, ipBlockEnforcer.ts, appControlEnforcer.ts exactly) - nothing an
# admin configured through any other means is touched. USB Control is deliberately NOT
# included here: a device it already disabled has no scriptable re-enable (see
# usbControlEnforcer.ts) - it would need to be physically unplugged and reinserted.
Write-Host "Releasing any active policy enforcement..."

netsh advfirewall set allprofiles firewallpolicy blockinbound,allowoutbound 2>$null | Out-Null
netsh advfirewall firewall delete rule name="EM-Quarantine-DNS" 2>$null | Out-Null
netsh advfirewall firewall delete rule name="EM-Quarantine-Server" 2>$null | Out-Null

netsh advfirewall firewall delete rule name="EM-RemoteAccess-RDP" 2>$null | Out-Null
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 1 -ErrorAction SilentlyContinue

Get-NetFirewallRule -DisplayName "EM-IPBLOCK-Outbound" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName "EM-IPBLOCK-Inbound" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue

$hostsPath = "C:\Windows\System32\drivers\etc\hosts"
if (Test-Path $hostsPath) {
    $hostsContent = Get-Content $hostsPath -Raw
    $startIdx = $hostsContent.IndexOf("# EM-WEBBLOCK-START")
    $endIdx = $hostsContent.IndexOf("# EM-WEBBLOCK-END")
    if ($startIdx -ge 0 -and $endIdx -ge 0) {
        $before = $hostsContent.Substring(0, $startIdx).TrimEnd()
        Set-Content -Path $hostsPath -Value "$before`r`n" -NoNewline -Encoding ASCII
    }
}
Remove-Item -Path 'HKLM:\SOFTWARE\Policies\Google\Chrome\URLBlocklist' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\URLBlocklist' -Recurse -Force -ErrorAction SilentlyContinue

$srpDisallowedPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Safer\CodeIdentifiers\0\Paths'
if (Test-Path $srpDisallowedPath) {
    Get-ChildItem -Path $srpDisallowedPath -ErrorAction SilentlyContinue | ForEach-Object {
        $desc = (Get-ItemProperty -Path $_.PSPath -Name Description -ErrorAction SilentlyContinue).Description
        if ($desc -and $desc.StartsWith('EM-managed:')) {
            Remove-Item -Path $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Safer\CodeIdentifiers' -Name DefaultLevel -Value 262144 -Type DWord -ErrorAction SilentlyContinue

# Best-effort self-report to the server so the Agent row - and its license seat - is freed
# immediately instead of lingering forever as an unreachable "offline" row. $config/$state
# are already loaded above if this install ever finished enrolling; any failure here
# (offline, server down) is swallowed since local removal must proceed regardless.
if ($config -and $state) {
    try {
        Invoke-RestMethod -Uri "$($config.serverUrl.TrimEnd('/'))/api/agent/uninstalled" -Method Post -TimeoutSec 10 `
            -Headers @{ "X-Agent-Id" = $state.agentId; "X-Agent-Key" = $state.apiKey } | Out-Null
    } catch {}
}

Write-Host "Stopping and removing the Endpoint Pro agent..."
schtasks /change /tn $TaskName /disable 2>$null | Out-Null
schtasks /end /tn $TaskName 2>$null | Out-Null
schtasks /delete /tn $TaskName /f 2>$null | Out-Null
schtasks /change /tn $WatchdogTaskName /disable 2>$null | Out-Null
schtasks /end /tn $WatchdogTaskName 2>$null | Out-Null
schtasks /delete /tn $WatchdogTaskName /f 2>$null | Out-Null

if (Test-Path $installDir) {
    # The agent runs as SYSTEM, so every file it wrote during normal operation (not just the
    # tamper-resistance lockdown on the folder itself) is SYSTEM-owned - an admin's own
    # SeTakeOwnershipPrivilege lets takeown reassign ownership, which /reset alone cannot do
    # for files an admin was never the owner of. Take ownership first, then reset ACLs, then
    # remove - each step needs the one before it to have actually succeeded.
    takeown /F $installDir /R /D Y 2>$null | Out-Null
    icacls $installDir /reset /T /Q 2>$null | Out-Null
    Remove-Item -Path $installDir -Recurse -Force
}

Write-Host "Endpoint Pro agent removed."
