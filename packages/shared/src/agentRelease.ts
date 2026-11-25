// Releasing a Windows endpoint when the agent is removed, however it is removed.
//
// UNINSTALL_GUARD_PS is one PowerShell script (guard.ps1) used by every way the agent can go:
//  - Setup / Programs and Features (uninstall.ps1) and the console's or tray app's Uninstall (the
//    helper task from buildUninstallAgentScript on the server) run it with -Mode Now once the agent
//    is stopped: it takes back everything the agent applied, then tells the server, which deletes
//    the endpoint and so frees its licence;
//  - the agent keeps a copy in ProgramData\EndpointPro\UninstallGuard (SYSTEM and administrators
//    only) with a scheduled task that runs it every 30 minutes and at start-up (-Mode Check). If the
//    agent's files disappear without an uninstall (deleted by hand), it does the same release and
//    report once they have been gone for 20 minutes (a self-update never takes that long);
//  - when the server can't be reached at that moment (PC offline), the report waits in the guard
//    folder and the task delivers it once the PC is back on the network (for up to 180 days).
//
// Only what this product put on the PC is taken back: its own marked firewall rules, hosts
// section, registry values, AppLocker rules and Defender exclusions. Settings an administrator made
// another way are left alone. Every step is safe to run again.
//
// Keep in step with the enforcers in packages/agent/src: quarantine.service.ts and
// remoteAccess.service.ts (server), ipBlockEnforcer.ts, webBlockEnforcer.ts, mailGuardPolicy.ts,
// appControlPaths.ts / appLockerEnforcer.ts, screenshotBlockEnforcer.ts, aiGuardAgent.ts,
// usbControlEnforcer.ts, threatProtection.ts and defenderExclusion.ts. No backticks in here: it is
// a JavaScript template string.

export const UNINSTALL_GUARD_TASK_NAME = "EndpointIQUninstallGuard";
// Under C:\ProgramData\EndpointPro, beside (not inside) the Agent folder the uninstall deletes.
export const UNINSTALL_GUARD_DIR_NAME = "UninstallGuard";
// Agent state files the release reads (copied into the guard folder so a hand-deleted install
// can still be released).
export const UNINSTALL_GUARD_STATE_FILES = [
  "threat-protection-state.json",
  "screenshot-block-policies.json",
  "ai-guard-blocks.json",
  "usb-control-enforced",
];

export type UninstallHow = "uninstaller" | "console" | "endpoint" | "removed-without-uninstaller";

export const UNINSTALL_GUARD_PS = String.raw`
param(
  [ValidateSet('Check', 'Now')][string]$Mode = 'Check',
  [string]$How = 'removed-without-uninstaller'
)
$ErrorActionPreference = 'SilentlyContinue'

$TaskName = '${UNINSTALL_GUARD_TASK_NAME}'
$baseDir = Join-Path $env:ProgramData 'EndpointPro'
$guardDir = Join-Path $baseDir '${UNINSTALL_GUARD_DIR_NAME}'
$installDir = Join-Path $baseDir 'Agent'
$installState = Join-Path $installDir 'app\.state'
$guardState = Join-Path $guardDir 'state'
$pendingDir = Join-Path $guardDir 'pending'
$currentPath = Join-Path $guardDir 'current.json'
$missingPath = Join-Path $guardDir 'missing-since.txt'
$releaseAgainPath = Join-Path $guardDir 'release-again.txt'
$logPath = Join-Path $baseDir 'uninstall.log'
$MaxPendingDays = 180

function Write-GuardLog([string]$text) {
  try { Add-Content -LiteralPath $logPath -Value ('{0}  {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $text) -Encoding UTF8 } catch {}
}

function Test-Installed {
  (Test-Path -LiteralPath (Join-Path $installDir 'node\node.exe')) -and (Test-Path -LiteralPath (Join-Path $installDir 'app\dist\index.js'))
}

# ---- Release: take back everything the agent applied -----------------------------------------

function Read-AgentState([string]$name) {
  foreach ($d in @($installState, $guardState)) {
    $p = Join-Path $d $name
    if (Test-Path -LiteralPath $p) {
      try { return (Get-Content -Raw -LiteralPath $p | ConvertFrom-Json) } catch {}
    }
  }
  return $null
}

function Test-AgentStateFile([string]$name) {
  (Test-Path -LiteralPath (Join-Path $installState $name)) -or (Test-Path -LiteralPath (Join-Path $guardState $name))
}

function Invoke-Release {
  $script:released = New-Object System.Collections.Generic.List[string]
  $script:problems = New-Object System.Collections.Generic.List[string]
  function Step([string]$name, [scriptblock]$body) {
    try {
      $did = & $body
      if ($did) { $script:released.Add($name) }
    } catch {
      $script:problems.Add(('{0}: {1}' -f $name, $_.Exception.Message))
    }
  }

  # The tray app in every session (it blocks screenshot keys and AI clipboard pastes while it runs).
  Step 'Tray app closed' { $p = @(Get-Process -Name 'EndpointIQTray'); if ($p.Count) { $p | Stop-Process -Force; $true } }

  # Quarantine (quarantine.service.ts): its firewall rules, and the firewall's default actions put
  # back to what quarantine release sets - only when a quarantine was in place.
  Step 'Quarantine released' {
    $rules = @(Get-NetFirewallRule -DisplayName 'EM-Quarantine-*')
    if ($rules.Count) {
      $rules | Remove-NetFirewallRule
      Set-NetFirewallProfile -Profile Domain, Private, Public -DefaultInboundAction Block -DefaultOutboundAction Allow
      $true
    }
  }

  # Remote access (remoteAccess.service.ts): its RDP rule; RDP is turned back off only if this
  # product had opened it.
  Step 'Remote access closed' {
    $rdp = @(Get-NetFirewallRule -DisplayName 'EM-RemoteAccess-RDP')
    if ($rdp.Count) {
      $rdp | Remove-NetFirewallRule
      Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 1
      $true
    }
  }

  # IP blocking (ipBlockEnforcer.ts).
  Step 'IP blocking removed' {
    $rules = @(Get-NetFirewallRule -DisplayName 'EM-IPBLOCK-*')
    if ($rules.Count) { $rules | Remove-NetFirewallRule; $true }
  }

  # Web blocking (webBlockEnforcer.ts): its section of the hosts file, and the Chrome / Edge URL
  # blocklists, which it owns outright.
  Step 'Web blocking removed' {
    $did = $false
    $hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
    $text = [System.IO.File]::ReadAllText($hostsPath)
    $start = $text.IndexOf('# EM-WEBBLOCK-START')
    $end = $text.IndexOf('# EM-WEBBLOCK-END')
    if ($start -ge 0 -and $end -gt $start) {
      $after = $text.Substring($end + '# EM-WEBBLOCK-END'.Length).TrimStart([char]13, [char]10)
      $kept = $text.Substring(0, $start).TrimEnd()
      if ($after) { $kept = $kept + [Environment]::NewLine + $after }
      [System.IO.File]::WriteAllText($hostsPath, $kept + [Environment]::NewLine, [System.Text.Encoding]::ASCII)
      $did = $true
    }
    foreach ($k in 'HKLM:\SOFTWARE\Policies\Google\Chrome\URLBlocklist', 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\URLBlocklist') {
      if (Test-Path -LiteralPath $k) { Remove-Item -LiteralPath $k -Recurse -Force; $did = $true }
    }
    $did
  }

  # Mail Guard browser extension (mailGuardPolicy.ts; IDs from packages/shared/src/data/mailGuard.ts).
  Step 'Mail Guard extension removed' {
    $did = $false
    $ids = @('lkmoggokfmdgjjjbmfachhmjdpbebebc', 'ncghjfmanemplpcikadapjgdmedgncob')
    foreach ($root in 'HKLM:\SOFTWARE\Policies\Google\Chrome', 'HKLM:\SOFTWARE\Policies\Microsoft\Edge') {
      foreach ($id in $ids) {
        $k = Join-Path $root "3rdparty\extensions\$id"
        if (Test-Path -LiteralPath $k) { Remove-Item -LiteralPath $k -Recurse -Force; $did = $true }
      }
      $force = Join-Path $root 'ExtensionInstallForcelist'
      if (Test-Path -LiteralPath $force) {
        $props = Get-ItemProperty -LiteralPath $force
        foreach ($p in $props.PSObject.Properties) {
          if ($p.Name -like 'PS*') { continue }
          foreach ($id in $ids) {
            if ("$($p.Value)".StartsWith("$id;")) { Remove-ItemProperty -LiteralPath $force -Name $p.Name; $did = $true }
          }
        }
      }
    }
    $did
  }

  # Application control (appControlPaths.ts): launch blocks (Image File Execution Options values
  # tagged EndpointIQManaged), Software Restriction rules from agents before 0.2.18, and the
  # AppLocker rules of advanced application control.
  Step 'Application blocks removed' {
    $did = $false
    foreach ($root in 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows NT\CurrentVersion\Image File Execution Options') {
      if (-not (Test-Path -LiteralPath $root)) { continue }
      foreach ($key in @(Get-ChildItem -LiteralPath $root)) {
        $props = Get-ItemProperty -LiteralPath $key.PSPath
        if ($props.EndpointIQManaged) {
          Remove-ItemProperty -LiteralPath $key.PSPath -Name Debugger, EndpointIQManaged -Force
          $k = Get-Item -LiteralPath $key.PSPath
          if ($k.ValueCount -eq 0 -and $k.SubKeyCount -eq 0) { Remove-Item -LiteralPath $key.PSPath -Force }
          $did = $true
        }
      }
    }
    $srp = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Safer\CodeIdentifiers\0\Paths'
    if (Test-Path -LiteralPath $srp) {
      foreach ($entry in @(Get-ChildItem -LiteralPath $srp)) {
        $desc = (Get-ItemProperty -LiteralPath $entry.PSPath -Name Description).Description
        if ($desc -and $desc.StartsWith('EM-managed:')) { Remove-Item -LiteralPath $entry.PSPath -Recurse -Force; $did = $true }
      }
    }
    try {
      $alx = [xml](Get-AppLockerPolicy -Local -Xml)
      $alChanged = $false
      foreach ($c in @($alx.AppLockerPolicy.RuleCollection)) {
        if (-not $c) { continue }
        $ours = @($c.ChildNodes | Where-Object { $_.Description -eq 'Endpoint IQ managed' })
        foreach ($r in $ours) { [void]$c.RemoveChild($r); $alChanged = $true }
        if ($ours.Count -gt 0 -and @($c.ChildNodes | Where-Object { $_.LocalName -like '*Rule' }).Count -eq 0) { $c.SetAttribute('EnforcementMode', 'NotConfigured') }
      }
      if ($alChanged) {
        $alFile = Join-Path $guardDir ('applocker-' + [guid]::NewGuid().ToString('N') + '.xml')
        if (-not (Test-Path -LiteralPath $guardDir)) { $alFile = Join-Path $baseDir ('applocker-' + [guid]::NewGuid().ToString('N') + '.xml') }
        $alx.Save($alFile)
        Set-AppLockerPolicy -XmlPolicy $alFile
        Remove-Item -LiteralPath $alFile -Force
        $did = $true
      }
    } catch {}
    $did
  }

  # Screenshot blocking (screenshotBlockEnforcer.ts): Snipping Tool, Game Bar capture and Edge web
  # capture put back to what they were before.
  Step 'Screenshot tools restored' {
    $saved = Read-AgentState 'screenshot-block-policies.json'
    if ($saved) {
      foreach ($p in $saved.PSObject.Properties) {
        $i = $p.Name.LastIndexOf('\')
        $key = $p.Name.Substring(0, $i) -replace '^HKLM\\', 'HKLM:\'
        $name = $p.Name.Substring($i + 1)
        if ($null -eq $p.Value) { Remove-ItemProperty -LiteralPath $key -Name $name -Force }
        else { Set-ItemProperty -LiteralPath $key -Name $name -Value ([int]$p.Value) -Type DWord }
      }
      $true
    }
  }

  # AI Guard (aiGuardAgent.ts): only the extension blocklist entries and VS Code extension rules it
  # added.
  Step 'AI Guard blocks removed' {
    $s = Read-AgentState 'ai-guard-blocks.json'
    if (-not $s) { return }
    $did = $false
    $lists = @{ chrome = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallBlocklist'; edge = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallBlocklist' }
    foreach ($browser in 'chrome', 'edge') {
      $owned = @($s.browser.$browser | ForEach-Object { "$_".ToLowerInvariant() })
      $k = $lists[$browser]
      if (-not $owned.Count -or -not (Test-Path -LiteralPath $k)) { continue }
      $props = Get-ItemProperty -LiteralPath $k
      foreach ($p in $props.PSObject.Properties) {
        if ($p.Name -like 'PS*') { continue }
        if ($owned -contains "$($p.Value)".ToLowerInvariant()) { Remove-ItemProperty -LiteralPath $k -Name $p.Name; $did = $true }
      }
    }
    $vsKey = 'HKLM:\SOFTWARE\Policies\Microsoft\VSCode'
    $raw = (Get-ItemProperty -LiteralPath $vsKey -Name AllowedExtensions).AllowedExtensions
    if ($raw) {
      if ($s.vscodeValueCreated) {
        Remove-ItemProperty -LiteralPath $vsKey -Name AllowedExtensions -Force
        $did = $true
      } elseif (@($s.vscode).Count) {
        $rules = $raw | ConvertFrom-Json
        $changed = $false
        foreach ($id in @($s.vscode)) {
          if ($rules.PSObject.Properties[$id] -and $rules.$id -eq $false) { $rules.PSObject.Properties.Remove($id); $changed = $true }
        }
        if ($changed) { Set-ItemProperty -LiteralPath $vsKey -Name AllowedExtensions -Value ($rules | ConvertTo-Json -Compress) -Type String; $did = $true }
      }
    }
    $did
  }

  # USB Control (usbControlEnforcer.ts): USB drives it turned off are turned back on - the ones
  # plugged in now, and the ones Windows remembers that aren't plugged in.
  Step 'USB drives re-enabled' {
    if (-not (Test-AgentStateFile 'usb-control-enforced')) { return }
    $did = $false
    foreach ($d in @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='DiskDrive' AND ConfigManagerErrorCode=22" | Where-Object { $_.PNPDeviceID -like 'USBSTOR\*' })) {
      Enable-PnpDevice -InstanceId $d.PNPDeviceID -Confirm:$false
      $did = $true
    }
    $usbstor = 'HKLM:\SYSTEM\CurrentControlSet\Enum\USBSTOR'
    if (Test-Path -LiteralPath $usbstor) {
      foreach ($inst in @(Get-ChildItem -LiteralPath $usbstor | Get-ChildItem)) {
        $flags = (Get-ItemProperty -LiteralPath $inst.PSPath -Name ConfigFlags).ConfigFlags
        if ($null -ne $flags -and ($flags -band 1)) {
          # Windows lets only SYSTEM change these: from an administrator's uninstall this fails, and
          # the guard task (SYSTEM) runs the release once more straight after (see Complete-Removal).
          try { Set-ItemProperty -LiteralPath $inst.PSPath -Name ConfigFlags -Value ($flags -band -bnot 1) -Type DWord -ErrorAction Stop; $did = $true } catch {}
        }
      }
    }
    $did
  }

  # Threat Protection (threatProtection.ts): only the Defender exclusions it added. Defender's
  # protection settings stay on.
  Step 'Threat Protection exclusions removed' {
    $tp = Read-AgentState 'threat-protection-state.json'
    if (-not $tp) { return }
    $did = $false
    foreach ($x in @($tp.added.paths)) { if ($x) { Remove-MpPreference -ExclusionPath $x; $did = $true } }
    foreach ($x in @($tp.added.extensions)) { if ($x) { Remove-MpPreference -ExclusionExtension $x; $did = $true } }
    foreach ($x in @($tp.added.processes)) { if ($x) { Remove-MpPreference -ExclusionProcess $x; $did = $true } }
    $did
  }

  # The agent's own Defender exclusion for its data folder (defenderExclusion.ts).
  Step 'Agent Defender exclusion removed' {
    $pref = Get-MpPreference
    if ($pref.ExclusionPath -contains $installState) { Remove-MpPreference -ExclusionPath $installState; $true }
  }
}

# ---- Telling the server ----------------------------------------------------------------------

function Get-InstalledIdentity {
  try {
    $config = Get-Content -Raw -LiteralPath (Join-Path $installDir 'app\config.json') | ConvertFrom-Json
    $state = Get-Content -Raw -LiteralPath (Join-Path $installState 'state.json') | ConvertFrom-Json
    if (-not $state.agentId -or -not $state.apiKey) { return $null }
    $urls = @()
    if ($config.serverUrl) { $urls += "$($config.serverUrl)" }
    foreach ($u in @($config.serverUrls)) { if ($u) { $urls += "$u" } }
    return [PSCustomObject]@{ agentId = $state.agentId; apiKey = $state.apiKey; serverUrls = @($urls | Select-Object -Unique) }
  } catch { return $null }
}

# 'done' when the server has the news (or never knew this endpoint), 'retry' when it couldn't be
# reached.
function Send-Uninstalled($notice) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $caPath = Join-Path $guardDir 'server-ca.pem'
  if (-not (Test-Path -LiteralPath $caPath)) { $caPath = Join-Path $installDir 'app\certs-trust\dev-server-public.pem' }
  $body = @{ how = "$($notice.how)"; uninstalledAt = "$($notice.uninstalledAt)"; released = @($notice.released); problems = @($notice.problems) } | ConvertTo-Json -Compress
  $headers = @{ 'X-Agent-Id' = "$($notice.agentId)"; 'X-Agent-Key' = "$($notice.apiKey)" }
  foreach ($url in @($notice.serverUrls)) {
    if (-not $url) { continue }
    $uri = "$($url.TrimEnd('/'))/api/agent/uninstalled"
    for ($attempt = 0; $attempt -lt 2; $attempt++) {
      $previous = [Net.ServicePointManager]::ServerCertificateValidationCallback
      try {
        if ($attempt -eq 1) {
          # Only this one pinned certificate (the same narrow trust the agent uses), never a
          # blanket bypass - and only after a certificate failure.
          if (-not (Test-Path -LiteralPath $caPath)) { break }
          $pinned = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($caPath)
          [Net.ServicePointManager]::ServerCertificateValidationCallback = { param($s, $cert, $chain, $errors) $cert.GetCertHashString() -eq $pinned.GetCertHashString() }
        }
        Invoke-RestMethod -Uri $uri -Method Post -Body $body -ContentType 'application/json' -Headers $headers -TimeoutSec 15 -ErrorAction Stop | Out-Null
        return 'done'
      } catch {
        $status = 0
        try { $status = [int]$_.Exception.Response.StatusCode } catch {}
        # 401: the server no longer has this endpoint (already removed) - nothing left to tell.
        if ($status -eq 401) { return 'done' }
        if ($attempt -eq 0 -and $_.Exception.Message -notmatch 'trust|certificate|SSL|TLS') { break }
      } finally {
        [Net.ServicePointManager]::ServerCertificateValidationCallback = $previous
      }
    }
  }
  return 'retry'
}

# ---- Keeping a report until it is delivered ----------------------------------------------------

function Protect-GuardDir {
  if (-not (Test-Path -LiteralPath $guardDir)) { New-Item -ItemType Directory -Path $guardDir -Force | Out-Null }
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetSecurityDescriptorSddlForm('D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
  Set-Acl -LiteralPath $guardDir -AclObject $acl
}

function Register-GuardTask {
  $script = Join-Path $guardDir 'guard.ps1'
  $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger><Repetition><Interval>PT30M</Interval></Repetition><StartBoundary>2020-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger>
    <BootTrigger><Delay>PT2M</Delay><Enabled>true</Enabled></BootTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$script"</Arguments></Exec></Actions>
</Task>
"@
  $xmlPath = Join-Path $guardDir ('task-' + [guid]::NewGuid().ToString('N') + '.xml')
  Set-Content -LiteralPath $xmlPath -Value $xml -Encoding Unicode
  schtasks /create /tn $TaskName /xml $xmlPath /f 2>$null | Out-Null
  Remove-Item -LiteralPath $xmlPath -Force
}

function Save-Pending($notice) {
  Install-Guard
  if (-not (Test-Path -LiteralPath $pendingDir)) { New-Item -ItemType Directory -Path $pendingDir -Force | Out-Null }
  $notice | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $pendingDir ("$($notice.agentId).json")) -Encoding UTF8
}

# Puts this script and its task in the guard folder (the uninstall helpers run a copy from elsewhere).
function Install-Guard {
  Protect-GuardDir
  $self = Join-Path $guardDir 'guard.ps1'
  if ($PSCommandPath -and ($PSCommandPath -ne $self)) { Copy-Item -LiteralPath $PSCommandPath -Destination $self -Force }
  $ca = Join-Path $installDir 'app\certs-trust\dev-server-public.pem'
  if ((Test-Path -LiteralPath $ca) -and -not (Test-Path -LiteralPath (Join-Path $guardDir 'server-ca.pem'))) { Copy-Item -LiteralPath $ca -Destination (Join-Path $guardDir 'server-ca.pem') -Force }
  schtasks /query /tn $TaskName 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Register-GuardTask }
}

function Send-PendingNotices {
  foreach ($f in @(Get-ChildItem -LiteralPath $pendingDir -Filter '*.json')) {
    try { $n = Get-Content -Raw -LiteralPath $f.FullName | ConvertFrom-Json } catch { Remove-Item -LiteralPath $f.FullName -Force; continue }
    $result = Send-Uninstalled $n
    $age = (Get-Date) - [datetime]::Parse("$($n.uninstalledAt)")
    if ($result -eq 'done') {
      Write-GuardLog "Server told that endpoint $($n.agentId) was removed ($($n.how)) - its licence is free."
      Remove-Item -LiteralPath $f.FullName -Force
    } elseif ($age.TotalDays -gt $MaxPendingDays) {
      Write-GuardLog "Gave up telling the server about endpoint $($n.agentId) after $MaxPendingDays days - remove it in the console."
      Remove-Item -LiteralPath $f.FullName -Force
    }
  }
}

function Remove-GuardIfDone {
  if (Test-Installed) { return }
  if (Test-Path -LiteralPath $releaseAgainPath) { return }
  # The agent's files are gone but its removal hasn't been handled yet (the 20-minute wait).
  if (Test-Path -LiteralPath $currentPath) { return }
  if (@(Get-ChildItem -LiteralPath $pendingDir -Filter '*.json').Count) { return }
  schtasks /delete /tn $TaskName /f 2>$null | Out-Null
  Set-Location $env:SystemRoot
  Remove-Item -LiteralPath $guardDir -Recurse -Force
}

# The agent is gone: take everything back and report it (now, or later from the pending folder).
function Complete-Removal([string]$how) {
  $identity = Get-InstalledIdentity
  if (-not $identity -and (Test-Path -LiteralPath $currentPath)) { try { $identity = Get-Content -Raw -LiteralPath $currentPath | ConvertFrom-Json } catch {} }
  Invoke-Release
  Write-GuardLog ("Endpoint IQ agent removed ({0}). Released: {1}" -f $how, $(if ($script:released.Count) { $script:released -join '; ' } else { 'nothing was in place' }))
  foreach ($p in $script:problems) { Write-GuardLog "  Couldn't release - $p" }
  Remove-Item -LiteralPath $currentPath -Force
  Remove-Item -LiteralPath $missingPath -Force
  # Not running as SYSTEM (Setup's uninstall runs as the administrator): a few settings only SYSTEM
  # may change, so the guard task runs the release once more as soon as the agent's files are gone.
  if (-not [Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) {
    Install-Guard
    Set-Content -LiteralPath $releaseAgainPath -Value $how
  }
  if (-not $identity) { Write-GuardLog 'This PC never finished enrolling - nothing to tell the server.'; return }
  $notice = [PSCustomObject]@{
    agentId = "$($identity.agentId)"; apiKey = "$($identity.apiKey)"; serverUrls = @($identity.serverUrls)
    how = $how; uninstalledAt = (Get-Date).ToUniversalTime().ToString('o')
    released = @($script:released); problems = @($script:problems)
  }
  if ((Send-Uninstalled $notice) -eq 'done') {
    Write-GuardLog 'Server told - the endpoint is removed and its licence is free.'
  } else {
    Save-Pending $notice
    Write-GuardLog "Server not reachable - it will be told when this PC is back on the network (checked every 30 minutes)."
  }
}

if ($Mode -eq 'Now') {
  Complete-Removal $How
} else {
  if (Test-Installed) {
    Remove-Item -LiteralPath $missingPath -Force
  } elseif (Test-Path -LiteralPath $releaseAgainPath) {
    Invoke-Release
    if ($script:released.Count) { Write-GuardLog ('Released after the uninstall: ' + ($script:released -join '; ')) }
    foreach ($p in $script:problems) { Write-GuardLog "  Couldn't release - $p" }
    Remove-Item -LiteralPath $releaseAgainPath -Force
  } elseif (Test-Path -LiteralPath $currentPath) {
    # The agent's files are gone but nothing uninstalled it. Wait 20 minutes before acting, in case
    # it is being updated or reinstalled.
    if (-not (Test-Path -LiteralPath $missingPath)) {
      Set-Content -LiteralPath $missingPath -Value (Get-Date).ToUniversalTime().ToString('o')
    } else {
      $since = [datetime]::Parse((Get-Content -Raw -LiteralPath $missingPath).Trim())
      if (((Get-Date).ToUniversalTime() - $since.ToUniversalTime()).TotalMinutes -ge 20) { Complete-Removal 'removed-without-uninstaller' }
    }
  }
}
Send-PendingNotices
Remove-GuardIfDone
`;
