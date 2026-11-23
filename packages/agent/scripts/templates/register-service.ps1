# Endpoint IQ Agent - registers and starts the Windows service "EndpointIQAgent" (EndpointIQAgentService.exe),
# which runs the agent and starts the tray app in each signed-in user's session. Safe to run any
# number of times; called by:
#   - install.ps1, after copying the files (and with -PrepareInstall before copying them)
#   - the self-update helper (selfUpdater.ts), after extracting a new version
#   - the agent itself, once, when it finds it is still running the pre-0.2.23 way (a scheduled
#     task) - that is how existing endpoints move to the service on their first self-update
#   - watchdog.ps1 every 5 minutes (-Watchdog), to put the service back if it was removed,
#     disabled or stopped
# Agents before 0.2.23 ran as the scheduled task "EndpointProAgent"; it is removed here before the
# service starts, so the agent never runs twice.
#
# Safety net: if Windows won't run the service program (e.g. Smart App Control or an application
# control policy blocking unsigned programs), the agent goes on running as the scheduled task
# instead - never left not running - and the reason is written to app\.state\service-blocked.txt.
# The watchdog then keeps the task running and tries the service again a day later; an install or
# self-update tries it straight away. Exit codes: 0 service running, 3 running as the task.
param(
    [switch]$Watchdog,
    # install.ps1, before copying files: only lock the (possibly new) install folder, with
    # administrators allowed to write, so no user can put anything in it while files go in.
    [switch]$PrepareInstall
)

$ErrorActionPreference = "SilentlyContinue"
$ServiceName = "EndpointIQAgent"
$LegacyTaskName = "EndpointProAgent"
$installDir = Join-Path $env:ProgramData "EndpointPro\Agent"
$serviceExe = Join-Path $installDir "EndpointIQAgentService.exe"
$trayDir = Join-Path $installDir "tray"
$blockedMarker = Join-Path $installDir "app\.state\service-blocked.txt"

# Locks the install folder: owned by SYSTEM, SYSTEM has full control and administrators read
# access, nothing is inherited from ProgramData (where users may create files), and everything
# inside inherits only that - so no file or permission a user added survives, and no file is
# ever left open to users (no "icacls /reset" back to ProgramData's permissions). A junction or
# link put in place of the folder (or of ProgramData\EndpointPro) is removed, never followed.
# The tray app's and the launch blocker's folders are also readable by users (both run as the
# signed-in user). -AdminWrite: administrators keep full control, while install.ps1 copies files.
# The same function is in selfUpdater.ts (LOCK_INSTALL_DIR_PS) - keep the two in step.
function Set-FolderAcl($path, $sddl) {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetSecurityDescriptorSddlForm($sddl, [System.Security.AccessControl.AccessControlSections]::Access)
  [System.IO.Directory]::SetAccessControl($path, $acl)
}
function Lock-AgentFolder([switch]$AdminWrite) {
  $root = Split-Path $installDir
  foreach ($d in @($root, $installDir)) {
    $item = Get-Item -LiteralPath $d -Force -ErrorAction SilentlyContinue
    if ($item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $item.PSIsContainer)) {
      if ($item.PSIsContainer) { [IO.Directory]::Delete($d, $false) } else { [IO.File]::Delete($d) }
    }
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  }
  # Owned by Administrators first (only the owner, no permission changes), so the permissions
  # below can be set whatever they were; SYSTEM becomes the owner at the end.
  & takeown.exe /F $root /A 2>$null | Out-Null
  & takeown.exe /F $installDir /R /A /D Y 2>$null | Out-Null
  Set-FolderAcl $root 'D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)'
  # Administrators: full control only while an administrator copies files in (install.ps1).
  Set-FolderAcl $installDir $(if ($AdminWrite) { 'D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)' } else { 'D:PAI(A;OICI;FA;;;SY)(A;OICI;0x1200a9;;;BA)' })
  if (@(Get-ChildItem -LiteralPath $installDir -Force).Count -gt 0) { & icacls.exe (Join-Path $installDir '*') /reset /T /C /Q 2>$null | Out-Null }
  foreach ($sub in @('tray', 'app\blocker')) {
    $p = Join-Path $installDir $sub
    if (Test-Path -LiteralPath $p) { & icacls.exe $p /grant '*S-1-5-32-545:(OI)(CI)RX' /C /Q 2>$null | Out-Null }
  }
  & icacls.exe $root /setowner '*S-1-5-18' /C /Q 2>$null | Out-Null
  & icacls.exe $installDir /setowner '*S-1-5-18' /T /C /Q 2>$null | Out-Null
}

if ($PrepareInstall) {
    Lock-AgentFolder -AdminWrite
    exit 0
}

if (-not (Test-Path $serviceExe)) { exit 1 }

function Test-LegacyTask {
    schtasks /query /tn $LegacyTaskName 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

# The scheduled task the agent ran as before 0.2.23 (same definition), used only as the fallback.
function Start-LegacyTask {
    if (-not (Test-LegacyTask)) {
        $nodeExe = Join-Path $installDir "node\node.exe"
        $entryPoint = Join-Path $installDir "app\dist\index.js"
        # A random name: %TEMP% is C:\Windows\Temp when SYSTEM runs this (watchdog).
        $taskXmlPath = Join-Path $env:TEMP ("EndpointProAgentTask_" + [Guid]::NewGuid().ToString("N") + ".xml")
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
    <Hidden>true</Hidden>
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
      <WorkingDirectory>$installDir</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
        Set-Content -Path $taskXmlPath -Value $taskXml -Encoding Unicode
        schtasks /create /tn $LegacyTaskName /xml $taskXmlPath /f | Out-Null
        Remove-Item $taskXmlPath -Force
    }
    schtasks /change /tn $LegacyTaskName /enable 2>$null | Out-Null
    schtasks /run /tn $LegacyTaskName 2>$null | Out-Null
}

$migrating = Test-LegacyTask

# Fallback in force: the watchdog keeps the task running and leaves the service alone for a day.
if ($Watchdog -and (Test-Path $blockedMarker) -and ((Get-Item $blockedMarker).LastWriteTime -gt (Get-Date).AddDays(-1))) {
    Start-LegacyTask
    exit 3
}

# 1. Tamper resistance: the install folder belongs to SYSTEM; administrators can read it
# (Lock-AgentFolder above, applied to everything inside, so nothing added during an install or
# update keeps other permissions). Also on the first run after updating from a task-based
# version, even from the watchdog.
if (-not $Watchdog -or $migrating) {
    Lock-AgentFolder
}

# 2. The service: automatic start as LocalSystem; Windows restarts it a minute after a crash.
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    sc.exe create $ServiceName binPath= "`"$serviceExe`"" start= auto obj= LocalSystem DisplayName= "Endpoint IQ Agent" | Out-Null
}
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    if (-not $migrating) { Start-LegacyTask }
    exit 2
}
sc.exe config $ServiceName binPath= "`"$serviceExe`"" start= auto obj= LocalSystem DisplayName= "Endpoint IQ Agent" | Out-Null
sc.exe description $ServiceName "Applies your organization's Endpoint IQ policies on this PC and reports its status. Managed by your IT team." | Out-Null
sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null
sc.exe failureflag $ServiceName 1 | Out-Null

# 3. The old scheduled task goes before the service starts.
if ($migrating) {
    schtasks /change /tn $LegacyTaskName /disable 2>$null | Out-Null
    schtasks /end /tn $LegacyTaskName 2>$null | Out-Null
    schtasks /delete /tn $LegacyTaskName /f 2>$null | Out-Null
    Start-Sleep -Seconds 2
}

# 4. Start it, and make sure it stays running.
$startError = $null
if ((Get-Service -Name $ServiceName).Status -ne "Running") {
    try { Start-Service -Name $ServiceName -ErrorAction Stop } catch { $startError = $_.Exception.Message }
}
$running = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 2
    if ((Get-Service -Name $ServiceName).Status -eq "Running") { $running = $true; break }
}
if ($running) {
    Start-Sleep -Seconds 3
    $running = ((Get-Service -Name $ServiceName).Status -eq "Running")
}

if ($running) {
    Remove-Item $blockedMarker -Force -ErrorAction SilentlyContinue
    exit 0
}

# Windows wouldn't run it: back to the scheduled task.
Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
sc.exe delete $ServiceName | Out-Null
$reason = if ($startError) { $startError } else { "The service didn't stay running." }
New-Item -ItemType Directory -Force -Path (Split-Path $blockedMarker) | Out-Null
Set-Content -Path $blockedMarker -Value ("{0} {1}" -f (Get-Date).ToString("o"), $reason) -Encoding ASCII
Start-LegacyTask
exit 3
