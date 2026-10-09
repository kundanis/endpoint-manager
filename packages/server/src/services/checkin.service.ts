import type { AgentUpdateTaskWire, CheckinResponse, InstallerType, InventoryReport, Shell } from "@em/shared";
import { DEFAULT_POLL_INTERVAL_SEC } from "@em/shared";
import { prisma } from "../db";
import { logger } from "../logger";
import { matchAgentInventory } from "./vulnerabilityMatch.service";
import { refreshIpGeoIfStale } from "./ipGeo.service";
import { decryptField } from "../utils/fieldEncryption";
import { getServerUrlsForCheckin } from "./agentConnection.service";

// Shared by both the paused and normal branches below - an agent update is a fleet
// hygiene/security concern (staying on a current, non-vulnerable build), not "new work"
// pause is meant to hold back, so it's delivered unconditionally either way. Marks
// PENDING -> DISPATCHED same as every other task type, so it's never redelivered on a
// later checkin no matter how long the endpoint takes to actually apply it.
async function fetchAndDispatchAgentUpdateTasks(agentId: string): Promise<AgentUpdateTaskWire[]> {
  const pending = await prisma.agentUpdateTask.findMany({
    where: { agentId, status: "PENDING" },
    include: { job: true },
  });
  if (pending.length > 0) {
    await prisma.agentUpdateTask.updateMany({
      where: { id: { in: pending.map((t) => t.id) } },
      data: { status: "DISPATCHED", dispatchedAt: new Date() },
    });
  }
  return pending.map((t) => ({
    id: t.id,
    jobId: t.jobId,
    targetVersion: t.job.targetVersion,
    sha256: t.job.sha256,
  }));
}

export async function handleCheckin(
  agentId: string,
  ipAddress: string | null,
  macAddress: string | null,
  agentVersion: string | null,
): Promise<CheckinResponse> {
  const agent = await prisma.agent.update({
    where: { id: agentId },
    data: {
      lastCheckinAt: new Date(),
      ipAddress: ipAddress ?? undefined,
      macAddress: macAddress ?? undefined,
      // Self-corrects on every checkin from whatever the agent actually reports itself
      // running (see checkin.schema.ts) rather than staying frozen at whatever was
      // reported once at enroll — a successful self-update (agentUpdate.service.ts) still
      // updates this too, redundantly but harmlessly, since both end up writing the same
      // value once the endpoint's next checkin lands anyway.
      agentVersion: agentVersion ?? undefined,
    },
    select: { paused: true },
  });

  // Fire-and-forget — an external geo-IP lookup must never block or fail a checkin.
  void refreshIpGeoIfStale(agentId, ipAddress).catch((err) =>
    logger.error({ err, agentId }, "IP geolocation refresh failed"),
  );

  // Paused agents still check in (so they stay visible/reportable if the endpoint is
  // online) but receive no new work - see pause.service.ts for why this can't instead
  // stop the local process outright. The one exception is CommandJob.bypassesPause
  // (quarantine/remote-access/uninstall) - those MUST still reach the agent even while
  // paused, since pause.service.ts itself relies on dispatching a release command before
  // the pause actually takes effect in the database, and an uninstall must always be
  // deliverable regardless of pause state.
  if (agent.paused) {
    const bypassCommands = await prisma.commandTask.findMany({
      where: { agentId, status: "PENDING", job: { bypassesPause: true } },
      include: { job: true },
    });
    if (bypassCommands.length > 0) {
      await prisma.commandTask.updateMany({
        where: { id: { in: bypassCommands.map((t) => t.id) } },
        data: { status: "DISPATCHED", dispatchedAt: new Date() },
      });
    }
    return {
      pollIntervalSec: DEFAULT_POLL_INTERVAL_SEC,
      commandTasks: bypassCommands.map((t) => ({
        id: t.id,
        jobId: t.jobId,
        shell: t.job.shell as Shell,
        script: decryptField(t.job.script),
        timeoutSec: t.job.timeoutSec,
      })),
      deploymentTasks: [],
      patchTasks: [],
      networkScanTasks: [],
      agentUpdateTasks: await fetchAndDispatchAgentUpdateTasks(agentId),
      runDataDiscoveryScanNow: false,
      serverUrls: await getServerUrlsForCheckin(),
    };
  }

  const pendingCommands = await prisma.commandTask.findMany({
    where: { agentId, status: "PENDING" },
    include: { job: true },
  });
  const pendingDeployments = await prisma.deploymentTask.findMany({
    where: { agentId, status: "PENDING" },
    include: { job: { include: { package: true } } },
  });
  const pendingPatches = await prisma.patchTask.findMany({
    where: { agentId, status: "PENDING" },
    include: { job: true },
  });
  const pendingDataDiscoveryScan = await prisma.dataDiscoveryScanState.findFirst({
    where: { agentId, scanRequested: true },
    select: { id: true },
  });
  // NetworkScanTask has no agentId of its own (see schema.prisma) — "is this task for me"
  // is derived by filtering on its parent run's agentId instead.
  const pendingNetworkScanTasks = await prisma.networkScanTask.findMany({
    where: { status: "PENDING", scanRun: { agentId } },
    include: { scanRun: true },
  });

  const now = new Date();
  if (pendingCommands.length > 0) {
    await prisma.commandTask.updateMany({
      where: { id: { in: pendingCommands.map((t) => t.id) } },
      data: { status: "DISPATCHED", dispatchedAt: now },
    });
  }
  if (pendingDeployments.length > 0) {
    await prisma.deploymentTask.updateMany({
      where: { id: { in: pendingDeployments.map((t) => t.id) } },
      data: { status: "DOWNLOADING", dispatchedAt: now },
    });
  }
  if (pendingPatches.length > 0) {
    await prisma.patchTask.updateMany({
      where: { id: { in: pendingPatches.map((t) => t.id) } },
      data: { status: "DISPATCHED", dispatchedAt: now },
    });
  }
  if (pendingNetworkScanTasks.length > 0) {
    // Dispatch and "start running" are the same event here — the agent executes the scan
    // synchronously within this same checkin cycle, unlike CommandTask's separate phases.
    await prisma.networkScanTask.updateMany({
      where: { id: { in: pendingNetworkScanTasks.map((t) => t.id) } },
      data: { status: "DISPATCHED", dispatchedAt: now },
    });
    await prisma.networkScanRun.updateMany({
      where: { id: { in: pendingNetworkScanTasks.map((t) => t.scanRunId) } },
      data: { status: "RUNNING" },
    });
  }

  return {
    pollIntervalSec: DEFAULT_POLL_INTERVAL_SEC,
    commandTasks: pendingCommands.map((t) => ({
      id: t.id,
      jobId: t.jobId,
      shell: t.job.shell as Shell,
      script: decryptField(t.job.script),
      timeoutSec: t.job.timeoutSec,
    })),
    deploymentTasks: pendingDeployments.map((t) => ({
      id: t.id,
      packageId: t.job.packageId,
      installerType: t.job.package.installerType as InstallerType,
      silentArgs: t.job.package.silentArgs,
      sha256: t.job.package.sha256,
    })),
    patchTasks: pendingPatches.map((t) => ({
      id: t.id,
      jobId: t.jobId,
      updateIds: JSON.parse(t.job.updateIds) as string[],
    })),
    networkScanTasks: pendingNetworkScanTasks.map((t) => ({
      id: t.id,
      scanRunId: t.scanRunId,
      cidr: t.scanRun.cidr,
    })),
    agentUpdateTasks: await fetchAndDispatchAgentUpdateTasks(agentId),
    runDataDiscoveryScanNow: pendingDataDiscoveryScan != null,
    serverUrls: await getServerUrlsForCheckin(),
  };
}

export async function recordInventory(agentId: string, report: InventoryReport): Promise<void> {
  const shared = {
    cpuModel: report.cpuModel,
    cpuCores: report.cpuCores,
    cpuPhysicalCores: report.cpuPhysicalCores,
    cpuSpeedGhz: report.cpuSpeedGhz,
    totalMemBytes: report.totalMemBytes ? BigInt(report.totalMemBytes) : null,
    memLayout: JSON.stringify(report.memLayout),
    osInfo: JSON.stringify(report.osInfo),
    osBuild: report.osBuild,
    pcSystemType: report.pcSystemType,
    osLicenseStatus: report.osLicenseStatus,
    osLicenseChannel: report.osLicenseChannel,
    osPartialProductKey: report.osPartialProductKey,
    lastLoggedOnUser: report.lastLoggedOnUser,
    diskInfo: JSON.stringify(report.diskInfo),
    diskVolumes: JSON.stringify(report.diskVolumes),
    installedSoftware: JSON.stringify(report.installedSoftware),
    batteryPresent: report.batteryPresent,
    batteryDesignCapacityMwh: report.batteryDesignCapacityMwh,
    batteryFullChargeCapacityMwh: report.batteryFullChargeCapacityMwh,
    batteryChargePercent: report.batteryChargePercent,
    batteryCycleCount: report.batteryCycleCount,
    batteryCharging: report.batteryCharging,
    batteryAcConnected: report.batteryAcConnected,
  };

  await prisma.inventorySnapshot.upsert({
    where: { agentId },
    create: { agentId, ...shared },
    update: { ...shared, collectedAt: new Date() },
  });

  // Auto-fill serial number/vendor from agent-captured hardware facts, but only while
  // still unset — once an admin manually edits either field via asset-details, that
  // manual value is authoritative and must not be silently overwritten on the next sync.
  if (report.systemSerialNumber || report.systemManufacturer) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { serialNumber: true, vendor: true } });
    const backfill: { serialNumber?: string; vendor?: string } = {};
    if (!agent?.serialNumber && report.systemSerialNumber) backfill.serialNumber = report.systemSerialNumber;
    if (!agent?.vendor && report.systemManufacturer) backfill.vendor = report.systemManufacturer;
    if (Object.keys(backfill).length > 0) {
      await prisma.agent.update({ where: { id: agentId }, data: backfill });
    }
  }

  // Fire-and-forget — matching against the local CVE cache is cheap, but must never
  // block or fail the inventory checkin itself.
  void matchAgentInventory(agentId).catch((err) => logger.error({ err, agentId }, "Vulnerability matching failed"));
}
