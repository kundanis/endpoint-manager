import type { UpdateAssetDetailsRequest } from "@em/shared";
import { prisma } from "../db";
import { createCommandJob } from "./command.service";
import { buildUninstallScript, UNINSTALL_TIMEOUT_SEC } from "./vulnerabilityRemediation.service";
import { verifyUninstallPassword } from "./agentSecurity.service";

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
    `schtasks /change /tn "${taskName}" /disable 2>$null | Out-Null`,
    `schtasks /end /tn "${taskName}" 2>$null | Out-Null`,
    `schtasks /delete /tn "${taskName}" /f 2>$null | Out-Null`,
    `schtasks /change /tn "${watchdogTaskName}" /disable 2>$null | Out-Null`,
    `schtasks /end /tn "${watchdogTaskName}" 2>$null | Out-Null`,
    `schtasks /delete /tn "${watchdogTaskName}" /f 2>$null | Out-Null`,
    `$installDir = Join-Path $env:ProgramData "EndpointPro\\Agent"`,
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
