import { removeAgentImages } from "./screenCaptureImage.service";
import { UNINSTALL_GUARD_DIR_NAME, UNINSTALL_GUARD_PS, type UninstallHow, type UpdateAssetDetailsRequest } from "@em/shared";
import { prisma } from "../db";
import { assertCanSetGroups } from "./policyExclusivity.service";
import { createCommandJob } from "./command.service";
import { isProtectedSystemSoftware } from "./softwareClassify.util";
import { buildUninstallScript, UNINSTALL_TIMEOUT_SEC } from "./vulnerabilityRemediation.service";
import { verifyUninstallPassword } from "./agentSecurity.service";
import { incrementTotalAgentsUninstalled } from "./licenseActivation.service";
import { computeStatus } from "./agentDerived.util";
import { effectiveLastCheckin } from "../presence/presence";
import { decryptField } from "../utils/fieldEncryption";
import { logger } from "../logger";
import { logAgentUninstalled, type UninstalledReport } from "./agentUninstallLog.service";

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
  // The new groups mustn't give the endpoint a second policy of an allow/block module.
  await assertCanSetGroups(agentId, groupIds);
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
// System software (Windows components, drivers, runtimes, OEM tools, Defender, this agent) is
// never uninstalled from the console: removing it can break Windows, hardware or other programs.
export class ProtectedSoftwareError extends Error {
  constructor(readonly softwareName: string) {
    super(`${softwareName} is system software and can't be uninstalled from the console.`);
  }
}

// Judged with the publisher the endpoint reported for that program, when it's in the inventory.
async function isProtectedOnAgent(agentId: string, softwareName: string): Promise<boolean> {
  const snapshot = await prisma.inventorySnapshot.findUnique({ where: { agentId }, select: { installedSoftware: true } });
  const installed: { name: string; publisher: string | null }[] = snapshot ? JSON.parse(snapshot.installedSoftware) : [];
  const entry = installed.find((s) => s.name === softwareName);
  return isProtectedSystemSoftware(softwareName, entry?.publisher ?? null);
}

export async function uninstallSoftwareOnAgent(
  agentId: string,
  softwareName: string,
  createdByAdminId: string,
): Promise<{ jobId: string }> {
  if (await isProtectedOnAgent(agentId, softwareName)) throw new ProtectedSoftwareError(softwareName);
  return createCommandJob({
    agentIds: [agentId],
    groupIds: [],
    shell: "powershell",
    script: buildUninstallScript(softwareName),
    timeoutSec: UNINSTALL_TIMEOUT_SEC,
    createdByAdminId,
  });
}

// Also the name of the helper task - removeRemotelyUninstalledAgents looks for it in a command.
const UNINSTALL_HELPER_MARKER = "EndpointProUninstallHelper";

// The dispatched command runs AS a descendant of the agent - stopping the EndpointIQAgent
// service (or, on agents before 0.2.23, ending the EndpointProAgent scheduled task) kills the
// agent's whole process tree, which would kill this very script mid-teardown before it could
// finish removing the watchdog task/install folder. Sidestepped the same way self-updating
// installers generally do: this script's only job is to register a completely independent
// one-time Scheduled Task a few seconds in the future - Task Scheduler launches that fresh,
// with no process-tree relationship to anything running right now, so it survives the agent
// being torn down and finishes the real cleanup afterward. The dispatched command itself reports
// SUCCESS almost immediately (registering a task is near-instant), well before the actual removal.
//
// The helper stops the agent, then runs the uninstall guard (UNINSTALL_GUARD_PS, the same script
// Setup's uninstall uses), which releases every policy the agent applied and tells the server -
// or, if the PC drops off the network, keeps the report and delivers it later. The server's copy
// of the guard is sent, so agents of any version get the full release. Both scripts are written
// to the guard folder, which only SYSTEM and administrators can change (never %TEMP%, which is
// C:\Windows\Temp for SYSTEM and open to users).
export function buildUninstallAgentScript(how: UninstallHow = "console"): string {
  const taskName = "EndpointProAgent"; // agents before 0.2.23
  const serviceName = "EndpointIQAgent";
  const watchdogTaskName = "EndpointProWatchdog";
  const helperTaskName = UNINSTALL_HELPER_MARKER;

  const helper = [
    // Without this, an unexpected terminating error partway through aborts the rest of cleanup.
    `$ErrorActionPreference = 'SilentlyContinue'`,
    // Stop the agent first, so it can't put a policy back while it is being released. The
    // watchdog first, so it can't put the service back while it's being removed.
    `schtasks /change /tn "${watchdogTaskName}" /disable 2>$null | Out-Null`,
    `schtasks /end /tn "${watchdogTaskName}" 2>$null | Out-Null`,
    `schtasks /delete /tn "${watchdogTaskName}" /f 2>$null | Out-Null`,
    `Stop-Service -Name "${serviceName}" -Force -ErrorAction SilentlyContinue`,
    `sc.exe delete "${serviceName}" 2>$null | Out-Null`,
    `taskkill /IM EndpointIQTray.exe /F 2>$null | Out-Null`,
    `schtasks /change /tn "${taskName}" /disable 2>$null | Out-Null`,
    `schtasks /end /tn "${taskName}" 2>$null | Out-Null`,
    `schtasks /delete /tn "${taskName}" /f 2>$null | Out-Null`,
    `$guardScript = Join-Path $PSScriptRoot "guard.ps1"`,
    // Release everything and tell the server (it reads the agent's identity before the folder goes).
    `& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $guardScript -Mode Now -How ${how}`,
    `$installDir = Join-Path $env:ProgramData "EndpointPro\\Agent"`,
    `if (Test-Path $installDir) {`,
    `  takeown /F $installDir /R /D Y 2>$null | Out-Null`,
    `  icacls $installDir /reset /T /Q 2>$null | Out-Null`,
    `  Remove-Item -Path $installDir -Recurse -Force -ErrorAction SilentlyContinue`,
    `}`,
    `schtasks /delete /tn "${helperTaskName}" /f 2>$null | Out-Null`,
    `Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue`,
    // Removes the guard folder and task once nothing is left to report.
    `& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $guardScript -Mode Check`,
  ].join("\n");

  return [
    `$ErrorActionPreference = 'Stop'`,
    `$guardDir = Join-Path $env:ProgramData "EndpointPro\\${UNINSTALL_GUARD_DIR_NAME}"`,
    `if (-not (Test-Path -LiteralPath $guardDir)) { New-Item -ItemType Directory -Path $guardDir -Force | Out-Null }`,
    `$guardAcl = New-Object System.Security.AccessControl.DirectorySecurity`,
    `$guardAcl.SetSecurityDescriptorSddlForm('D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')`,
    `Set-Acl -LiteralPath $guardDir -AclObject $guardAcl`,
    `$guardPath = Join-Path $guardDir "guard.ps1"`,
    `$helperScriptPath = Join-Path $guardDir "${helperTaskName}.ps1"`,
    `Set-Content -LiteralPath $guardPath -Encoding UTF8 -Value @'`,
    UNINSTALL_GUARD_PS.trim(),
    `'@`,
    `Set-Content -LiteralPath $helperScriptPath -Encoding UTF8 -Value @'`,
    helper,
    `'@`,
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
    `$helperTaskXmlPath = Join-Path $guardDir "${helperTaskName}.xml"`,
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
    // register successfully and then silently never fire on any endpoint running on
    // battery at the time. Confirmed for real against a laptop: registration succeeded 4
    // separate times with the agent still checking in minutes later each time.
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
    `Write-Output "Uninstall scheduled - the agent will release its policies and be removed within about a minute."`,
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
export async function confirmAgentUninstalled(agentId: string, report?: UninstalledReport, confirmed = true): Promise<void> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { hostname: true } });
  try {
    await prisma.agent.delete({ where: { id: agentId } });
  } catch (err: any) {
    if (err?.code === "P2025") return; // already deleted - nothing to do, and already counted
    throw err;
  }
  // Admin logs and the alert bell (the record just deleted was the only other trace of it).
  if (agent) await logAgentUninstalled({ id: agentId, hostname: agent.hostname }, report, confirmed);
  await removeAgentImages(agentId).catch(() => undefined); // its saved screenshots
  await incrementTotalAgentsUninstalled();
}

// Safety net for confirmAgentUninstalled: a remote Uninstall whose final "uninstalled" call
// never reached the server (endpoint dropped off the network mid-teardown) would otherwise
// leave an offline row behind - still counted in every policy assignment. If the uninstall
// command reported success and the endpoint hasn't checked in since, it is gone: remove it
// the same way. An endpoint whose uninstall didn't actually happen keeps checking in, so it
// is never touched.
const UNINSTALL_GRACE_MS = 15 * 60_000;

export async function removeRemotelyUninstalledAgents(): Promise<number> {
  const now = Date.now();
  const tasks = await prisma.commandTask.findMany({
    where: {
      status: "SUCCESS",
      completedAt: { lt: new Date(now - UNINSTALL_GRACE_MS), gt: new Date(now - 30 * 24 * 60 * 60_000) },
      job: { bypassesPause: true },
    },
    select: { agentId: true, completedAt: true, job: { select: { script: true } }, agent: { select: { lastCheckinAt: true } } },
  });
  let removed = 0;
  for (const t of tasks) {
    const lastSeen = effectiveLastCheckin(t.agentId, t.agent.lastCheckinAt);
    // The agent keeps checking in for up to about a minute while the helper is scheduled.
    if (lastSeen && lastSeen.getTime() > t.completedAt!.getTime() + 5 * 60_000) continue;
    let script: string;
    try {
      script = decryptField(t.job.script);
    } catch {
      continue;
    }
    if (!script.includes(UNINSTALL_HELPER_MARKER)) continue;
    await confirmAgentUninstalled(t.agentId, { how: "console" }, false);
    logger.info({ agentId: t.agentId }, "Removed an endpoint whose remote uninstall finished but never confirmed");
    removed++;
  }
  return removed;
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
      const at = effectiveLastCheckin(a.id, a.lastCheckinAt)?.getTime() ?? 0;
      const bt = effectiveLastCheckin(b.id, b.lastCheckinAt)?.getTime() ?? 0;
      return at !== bt ? bt - at : b.createdAt.getTime() - a.createdAt.getTime();
    });

    for (const agent of group) {
      if (agent.id === primary.id) continue;
      const status = computeStatus(effectiveLastCheckin(agent.id, agent.lastCheckinAt));
      if (status !== "OFFLINE") continue;
      if (compareVersions(agent.agentVersion, primary.agentVersion) >= 0) continue;

      duplicates.push({
        id: agent.id,
        hostname: agent.hostname,
        serialNumber: agent.serialNumber,
        lastLoggedOnUser: agent.inventory?.lastLoggedOnUser ?? null,
        status,
        agentVersion: agent.agentVersion,
        lastCheckinAt: effectiveLastCheckin(agent.id, agent.lastCheckinAt)?.toISOString() ?? null,
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
