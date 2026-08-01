# Endpoint Pro Agent Watchdog - runs on its own independent Scheduled Task (registered by
# install.ps1), checking and restoring the main "EndpointProAgent" task if it's been
# disabled or deleted. Deliberately self-contained (duplicates the task-registration XML
# from install.ps1) rather than depending on the agent's own compiled code, since it must
# keep working even if the main task/process it's protecting is not.
#
# This is the mirror image of ensureWatchdogTaskRegistered() in the agent's own
# checkinLoop.ts, which performs the same check in the other direction (does THIS watchdog
# task still exist and is it enabled) from inside the main agent process. Together: deleting
# or disabling either task alone gets restored by the other within one check cycle (5
# minutes); only removing both within the same window actually stops the agent via task
# manipulation alone - a meaningful deterrent, not an absolute guarantee.

$ErrorActionPreference = "SilentlyContinue"
$TaskName = "EndpointProAgent"
$installDir = Join-Path $env:ProgramData "EndpointPro\Agent"
$nodeExe = Join-Path $installDir "node\node.exe"
$entryPoint = Join-Path $installDir "app\dist\index.js"

if (-not (Test-Path $nodeExe) -or -not (Test-Path $entryPoint)) {
    # The install itself is gone (a real uninstall, or someone deleted the files directly) -
    # nothing left to point a restored task at, so exit quietly rather than recreating a
    # task with a target that doesn't exist.
    exit 0
}

schtasks /query /tn $TaskName 2>$null | Out-Null
$taskExists = ($LASTEXITCODE -eq 0)

if (-not $taskExists) {
    $taskXmlPath = Join-Path $env:TEMP ("EndpointProAgentTask_restore_" + [Guid]::NewGuid().ToString("N") + ".xml")
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
    schtasks /create /tn $TaskName /xml $taskXmlPath /f | Out-Null
    Remove-Item $taskXmlPath -Force
} else {
    schtasks /change /tn $TaskName /enable 2>$null | Out-Null
}

schtasks /run /tn $TaskName 2>$null | Out-Null
