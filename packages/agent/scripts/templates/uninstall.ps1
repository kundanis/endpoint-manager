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
