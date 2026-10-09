import type { UpdateAssetDetailsRequest } from "@em/shared";
import { prisma } from "../db";
import { createCommandJob } from "./command.service";
import { buildUninstallScript, UNINSTALL_TIMEOUT_SEC } from "./vulnerabilityRemediation.service";
import { verifyUninstallPassword } from "./agentSecurity.service";
import { incrementTotalAgentsUninstalled } from "./licenseActivation.service";
import { computeStatus } from "./agentDerived.util";

export class IncorrectUninstallPasswordError extends Error {}

export async function setAgentLifecycle(agentId: string, lifecycleStatus: string) {
  await prisma.agent.update({ where: { id: agentId }, data: { lifecycleStatus } });
}

export async function updateAssetDetails(agentId: string, params: UpdateAssetDetailsRequest) {
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      serialNumber: params.serialNumber,
      vendor: params.vendor,
      purchaseDate: params.purchaseDate,
      warrantyExpiryDate: params.warrantyExpiryDate,
      deviceTypeOverride: params.deviceTypeOverride,
      location: params.location,
    },
  });
}

export async function setAgentGroups(agentId: string, groupIds: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.agentGroupMembership.deleteMany({ where: { agentId } }),
    ...groupIds.map((groupId) => prisma.agentGroupMembership.create({ data: { agentId, groupId } })),
  ]);
}

export async function setAgentCustomFieldValues(
  agentId: string,
  values: { fieldDefinitionId: string; value: string }[],
): Promise<void> {
  for (const v of values) {
    await prisma.agentCustomFieldValue.upsert({
      where: { agentId_fieldDefinitionId: { agentId, fieldDefinitionId: v.fieldDefinitionId } },
      create: { agentId, fieldDefinitionId: v.fieldDefinitionId, value: v.value },
      update: { value: v.value, updatedAt: new Date() },
    });
  }
}

export async function getAgentCustomFieldValues(agentId: string) {
  const values = await prisma.agentCustomFieldValue.findMany({ where: { agentId } });
  return values.map((v) => ({ fieldDefinitionId: v.fieldDefinitionId, value: v.value }));
}

// Reuses the exact same registry-lookup uninstall script vulnerability remediation
// already dispatches (see vulnerabilityRemediation.service.ts's buildUninstallScript for
// the MSI-vs-EXE/silent-uninstall caveats) — this is just that same mechanism reachable
// from an arbitrary installed-software row, not only a CVE-flagged one.
export async function uninstallSoftwareOnAgent(
  agentId: string,
  softwareName: string,
  createdByAdminId: string,
): Promise<{ jobId: string }> {
  return createCommandJob({
    agentIds: [agentId],
    groupIds: [],
    shell: "powershell",
    script: buildUninstallScript(softwareName),
    timeoutSec: UNINSTALL_TIMEOUT_SEC,
    createdByAdminId,
  });
}

// The dispatched command runs AS a descendant of the EndpointProAgent scheduled task -
// `schtasks /end /tn EndpointProAgent` kills the whole process tree Task Scheduler
// associated with that task, which would kill this very script mid-teardown before it
// could finish removing the watchdog task/install folder. Sidestepped the same way
// self-updating installers generally do: this script's only job is to register a
// completely independent one-time Scheduled Task a few seconds in the future - Task
// Scheduler launches that fresh, with no process-tree relationship to anything running
// right now, so it survives EndpointProAgent being torn down and finishes the real
// cleanup afterward. The dispatched command itself reports SUCCESS almost immediately
// (registering a task is near-instant), well before the actual removal happens.
function buildUninstallAgentScript(): string {
  const taskName = "EndpointProAgent";
  const watchdogTaskName = "EndpointProWatchdog";
  const helperTaskName = "EndpointProUninstallHelper";

  return [
    `$helperScriptPath = Join-Path $env:TEMP "${helperTaskName}.ps1"`,
    `$helperScript = @'`,
    // Without this, an unexpected terminating error partway through (e.g. Set-Content
    // hitting a permissions issue) aborts the rest of cleanup silently - confirmed for
    // real in testing, where a hosts-file write failure skipped the firewall reset AND
    // the install-dir removal that were supposed to run after it. Matches the local
    // uninstall.ps1's own $ErrorActionPreference for the exact same reason.
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `schtasks /change /tn "${taskName}" /disable 2>$null | Out-Null`,
    `schtasks /end /tn "${taskName}" 2>$null | Out-Null`,
    `schtasks /delete /tn "${taskName}" /f 2>$null | Out-Null`,
    `schtasks /change /tn "${watchdogTaskName}" /disable 2>$null | Out-Null`,
    `schtasks /end /tn "${watchdogTaskName}" 2>$null | Out-Null`,
    `schtasks /delete /tn "${watchdogTaskName}" /f 2>$null | Out-Null`,
    `$installDir = Join-Path $env:ProgramData "EndpointPro\\Agent"`,
    // Best-effort self-report to the server (see confirmAgentUninstalled) so the Agent
    // row - and its license seat - is freed immediately instead of lingering forever as
    // an unreachable "offline" row. Must run BEFORE the install folder is wiped below,
    // since config.json/state.json live inside it. Any failure here (offline, server
    // down, files missing) is swallowed - the local removal must proceed regardless.
    `try {`,
    `  $agentConfigPath = Join-Path $installDir "app\\config.json"`,
    `  $agentStatePath = Join-Path $installDir "app\\.state\\state.json"`,
    `  if ((Test-Path $agentConfigPath) -and (Test-Path $agentStatePath)) {`,
    `    $agentConfig = Get-Content $agentConfigPath -Raw | ConvertFrom-Json`,
    `    $agentState = Get-Content $agentStatePath -Raw | ConvertFrom-Json`,
    `    Invoke-RestMethod -Uri "$($agentConfig.serverUrl)/api/agent/uninstalled" -Method Post -TimeoutSec 10 ` +
      `-Headers @{ "X-Agent-Id" = $agentState.agentId; "X-Agent-Key" = $agentState.apiKey } | Out-Null`,
    `  }`,
    `} catch {}`,
    // Release any active policy enforcement before the install folder is wiped, so a
    // quarantined/RDP-enabled/web-blocked/IP-blocked/app-blocked machine doesn't stay
    // locked down forever with no agent left to reverse it. Mirrors quarantine.service.ts,
    // remoteAccess.service.ts, webBlockEnforcer.ts, ipBlockEnforcer.ts,
    // appControlEnforcer.ts exactly - only this tool's own named/marked artifacts are
    // touched. USB Control has no scriptable undo (see usbControlEnforcer.ts) and is
    // deliberately not included here.
    `netsh advfirewall set allprofiles firewallpolicy blockinbound,allowoutbound 2>$null | Out-Null`,
    `netsh advfirewall firewall delete rule name="EM-Quarantine-DNS" 2>$null | Out-Null`,
    `netsh advfirewall firewall delete rule name="EM-Quarantine-Server" 2>$null | Out-Null`,
    `netsh advfirewall firewall delete rule name="EM-RemoteAccess-RDP" 2>$null | Out-Null`,
    `Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 1 -ErrorAction SilentlyContinue`,
    `Get-NetFirewallRule -DisplayName "EM-IPBLOCK-Outbound" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue`,
    `Get-NetFirewallRule -DisplayName "EM-IPBLOCK-Inbound" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue`,
    `$hostsPath = "C:\\Windows\\System32\\drivers\\etc\\hosts"`,
    `if (Test-Path $hostsPath) {`,
    `  $hostsContent = Get-Content $hostsPath -Raw`,
    `  $startIdx = $hostsContent.IndexOf("# EM-WEBBLOCK-START")`,
    `  $endIdx = $hostsContent.IndexOf("# EM-WEBBLOCK-END")`,
    `  if ($startIdx -ge 0 -and $endIdx -ge 0) {`,
    `    $before = $hostsContent.Substring(0, $startIdx).TrimEnd()`,
    `    Set-Content -Path $hostsPath -Value ($before + [System.Environment]::NewLine) -NoNewline -Encoding ASCII`,
    `  }`,
    `}`,
    `Remove-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome\\URLBlocklist' -Recurse -Force -ErrorAction SilentlyContinue`,
    `Remove-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge\\URLBlocklist' -Recurse -Force -ErrorAction SilentlyContinue`,
    `$srpDisallowedPath = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Safer\\CodeIdentifiers\\0\\Paths'`,
    `if (Test-Path $srpDisallowedPath) {`,
    `  Get-ChildItem -Path $srpDisallowedPath -ErrorAction SilentlyContinue | ForEach-Object {`,
    `    $desc = (Get-ItemProperty -Path $_.PSPath -Name Description -ErrorAction SilentlyContinue).Description`,
    `    if ($desc -and $desc.StartsWith('EM-managed:')) {`,
    `      Remove-Item -Path $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue`,
    `    }`,
    `  }`,
    `}`,
    `Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Safer\\CodeIdentifiers' -Name DefaultLevel -Value 262144 -Type DWord -ErrorAction SilentlyContinue`,
    `if (Test-Path $installDir) {`,
    `  takeown /F $installDir /R /D Y 2>$null | Out-Null`,
    `  icacls $installDir /reset /T /Q 2>$null | Out-Null`,
    `  Remove-Item -Path $installDir -Recurse -Force -ErrorAction SilentlyContinue`,
    `}`,
    `schtasks /delete /tn "${helperTaskName}" /f 2>$null | Out-Null`,
    `Remove-Item -Path "$PSCommandPath" -Force -ErrorAction SilentlyContinue`,
    `'@`,
    `Set-Content -Path $helperScriptPath -Value $helperScript -Encoding ASCII`,
    ``,
    // XML task registration with an InvariantCulture ISO 8601 StartBoundary - the same
    // idiom install.ps1/watchdog.ps1 already use - rather than a /tr + /sd + /st
    // command-line one-liner. Caught for real on an en-IN-locale machine: a plain
    // .ToString('MM/dd/yyyy')-style format string treats "/" and ":" as locale-dependent
    // date/time SEPARATOR placeholders, not literal characters, AND this locale's actual
    // day/month order (DD/MM, not MM/DD) silently misread a correctly-computed few-
    // seconds-in-the-future time as already past ("Task may not run because /ST is
    // earlier than current time" - the task got created but never actually scheduled,
    // Next Run Time: N/A). ISO 8601 + InvariantCulture sidesteps both problems at once,
    // and matters here specifically because this deployment's actual locale is unknown.
    `$invariant = [System.Globalization.CultureInfo]::InvariantCulture`,
    `$startBoundary = (Get-Date).AddSeconds(20).ToString("yyyy-MM-ddTHH:mm:ss", $invariant)`,
    `$helperTaskXmlPath = Join-Path $env:TEMP "${helperTaskName}.xml"`,
    `$helperTaskXml = @"`,
    `<?xml version="1.0" encoding="UTF-16"?>`,
    `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">`,
    `  <Triggers>`,
    `    <TimeTrigger>`,
    `      <StartBoundary>$startBoundary</StartBoundary>`,
    `      <Enabled>true</Enabled>`,
    `    </TimeTrigger>`,
    `  </Triggers>`,
    `  <Principals>`,
    `    <Principal id="Author">`,
    `      <UserId>S-1-5-18</UserId>`,
    `      <RunLevel>HighestAvailable</RunLevel>`,
    `    </Principal>`,
    `  </Principals>`,
    `  <Settings>`,
    `    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>`,
    // Matches install.ps1/watchdog.ps1's task XML - without these, Task Scheduler's
    // documented default for DisallowStartIfOnBatteries is true, so this task would
    // register successfully (schtasks /create succeeds, the outer script still reports
    // "Uninstall scheduled") and then silently never fire on any endpoint running on
    // battery at the time - a laptop uninstall would look like it worked every time and
    // do nothing. Confirmed for real against SSSIL-LAP-86: registration succeeded 4
    // separate times with the agent still checking in minutes later each time, unrelated
    // to AV (ruled out by pausing it) - the task simply never launched.
    `    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>`,
    `    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>`,
    `    <StartWhenAvailable>true</StartWhenAvailable>`,
    `  </Settings>`,
    `  <Actions Context="Author">`,
    `    <Exec>`,
    `      <Command>powershell.exe</Command>`,
    `      <Arguments>-NoProfile -ExecutionPolicy Bypass -File "$helperScriptPath"</Arguments>`,
    `    </Exec>`,
    `  </Actions>`,
    `</Task>`,
    `"@`,
    `Set-Content -Path $helperTaskXmlPath -Value $helperTaskXml -Encoding Unicode`,
    `schtasks /create /tn "${helperTaskName}" /xml $helperTaskXmlPath /f | Out-Null`,
    `Remove-Item -Path $helperTaskXmlPath -Force -ErrorAction SilentlyContinue`,
    ``,
    `Write-Output "Uninstall scheduled - the agent and its watchdog task will be removed within about 30 seconds."`,
  ].join("\n");
}

// Called by the detached uninstall helper task (see buildUninstallAgentScript) as its
// last network call before deleting the install folder, using the agent's own
// still-valid state.json credentials - the one reliable "this endpoint is actually gone"
// signal available in a fire-and-forget teardown. Deleting the row here (rather than
// e.g. setting a status flag) is what removes it from the dashboard and frees its
// license seat, matching exactly what the admin's manual Delete button already does.
// Best-effort by design: if this call never arrives (offline at that exact moment), the
// row is simply left for the admin to remove manually later - never treated as an error
// here since idempotent double-delete (already gone) is expected, not exceptional.
export async function confirmAgentUninstalled(agentId: string): Promise<void> {
  try {
    await prisma.agent.delete({ where: { id: agentId } });
  } catch (err: any) {
    if (err?.code === "P2025") return; // already deleted - nothing to do, and already counted
    throw err;
  }
  await incrementTotalAgentsUninstalled();
}

export async function uninstallAgentRemotely(
  agentId: string,
  password: string,
  createdByAdminId: string,
): Promise<{ jobId: string }> {
  const valid = await verifyUninstallPassword(password);
  if (!valid) throw new IncorrectUninstallPasswordError("Incorrect uninstall password");

  return createCommandJob({
    agentIds: [agentId],
    groupIds: [],
    shell: "powershell",
    script: buildUninstallAgentScript(),
    timeoutSec: 60,
    createdByAdminId,
    // A paused agent must still be uninstallable - otherwise it'd be stuck needing a
    // resume first just to be removed at all.
    bypassesPause: true,
  });
}

export async function listAgentNotes(agentId: string) {
  const notes = await prisma.assetNote.findMany({
    where: { agentId },
    include: { createdByAdmin: true },
    orderBy: { createdAt: "desc" },
  });
  return notes.map((n) => ({
    id: n.id,
    body: n.body,
    createdByAdminEmail: n.createdByAdmin.email,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function createAgentNote(agentId: string, createdByAdminId: string, body: string) {
  const note = await prisma.assetNote.create({
    data: { agentId, createdByAdminId, body },
    include: { createdByAdmin: true },
  });
  return {
    id: note.id,
    body: note.body,
    createdByAdminEmail: note.createdByAdmin.email,
    createdAt: note.createdAt.toISOString(),
  };
}

// Plain dotted-numeric comparison (agentVersion is always "x.y.z", package.json-derived -
// see readAgentVersion in packages/agent/src/config.ts) - negative when a < b.
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Finds Agent rows left behind by a re-enrollment from before enrollment.service.ts's
// hostname dedup existed (or any other path that once produced more than one row for the
// same physical machine) - the enrollAgent() fix stops new ones from forming, this is for
// cleaning up ones that already exist. Deliberately conservative about what counts as safe
// to flag: within each hostname's set of rows, the "primary" is whichever one last checked
// in (falling back to whichever was created most recently if none ever has); every other
// row in that set is only surfaced here if it's BOTH offline AND running a strictly older
// agentVersion than the primary - i.e. unambiguously the stale identity, not e.g. two
// legitimately different machines that happen to share a hostname with one currently
// offline for an unrelated reason.
export async function findDuplicateAgents() {
  const agents = await prisma.agent.findMany({
    include: { inventory: { select: { lastLoggedOnUser: true } } },
  });

  const byHostname = new Map<string, typeof agents>();
  for (const agent of agents) {
    const group = byHostname.get(agent.hostname);
    if (group) group.push(agent);
    else byHostname.set(agent.hostname, [agent]);
  }

  const duplicates: {
    id: string;
    hostname: string;
    serialNumber: string | null;
    lastLoggedOnUser: string | null;
    status: "ONLINE" | "OFFLINE";
    agentVersion: string;
    lastCheckinAt: string | null;
    createdAt: string;
  }[] = [];

  for (const group of byHostname.values()) {
    if (group.length < 2) continue;

    const [primary] = [...group].sort((a, b) => {
      const at = a.lastCheckinAt?.getTime() ?? 0;
      const bt = b.lastCheckinAt?.getTime() ?? 0;
      return at !== bt ? bt - at : b.createdAt.getTime() - a.createdAt.getTime();
    });

    for (const agent of group) {
      if (agent.id === primary.id) continue;
      const status = computeStatus(agent.lastCheckinAt);
      if (status !== "OFFLINE") continue;
      if (compareVersions(agent.agentVersion, primary.agentVersion) >= 0) continue;

      duplicates.push({
        id: agent.id,
        hostname: agent.hostname,
        serialNumber: agent.serialNumber,
        lastLoggedOnUser: agent.inventory?.lastLoggedOnUser ?? null,
        status,
        agentVersion: agent.agentVersion,
        lastCheckinAt: agent.lastCheckinAt?.toISOString() ?? null,
        createdAt: agent.createdAt.toISOString(),
      });
    }
  }

  return duplicates;
}

export async function deleteAgentsBulk(agentIds: string[]): Promise<number> {
  if (agentIds.length === 0) return 0;
  const result = await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
  await incrementTotalAgentsUninstalled(result.count);
  return result.count;
}
