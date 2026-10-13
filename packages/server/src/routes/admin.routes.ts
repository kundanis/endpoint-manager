import fs from "node:fs";
import { Router } from "express";
import {
  createEnrollmentTokenRequestSchema,
  createNoteRequestSchema,
  dispatchTargetRequestSchema,
  downloadAgentSetupRequestSchema,
  getWindowsEolInfo,
  setAgentGroupsRequestSchema,
  setCustomFieldValuesRequestSchema,
  startRemoteInstallRequestSchema,
  uninstallSoftwareRequestSchema,
  updateAgentConnectionSettingsRequestSchema,
  updateAssetDetailsRequestSchema,
  updateLifecycleStatusRequestSchema,
  verifyUninstallPasswordRequestSchema,
} from "@em/shared";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { prisma } from "../db";
import { config } from "../config";
import { createEnrollmentToken } from "../services/enrollment.service";
import {
  AgentInstallerMissingError,
  buildConfiguredSetupExe,
  getAgentConnectionSettings,
  setAgentConnectionSettings,
} from "../services/agentConnection.service";
import { hashToken } from "../utils/tokens";
import { getRemoteInstallJob, startRemoteInstall } from "../services/remoteInstall.service";
import { annotateWithLicenseStatus } from "../services/softwareLicense.service";
import {
  createAgentNote,
  deleteAgentsBulk,
  findDuplicateAgents,
  getAgentCustomFieldValues,
  IncorrectUninstallPasswordError,
  listAgentNotes,
  setAgentCustomFieldValues,
  setAgentGroups,
  setAgentLifecycle,
  uninstallAgentRemotely,
  uninstallSoftwareOnAgent,
  updateAssetDetails,
} from "../services/agent.service";
import { getLatestAgentUpdateTaskByAgent } from "../services/agentUpdate.service";
import { getLastPatchInstalledAtByAgent, getLatestMissingPatchByAgent } from "../services/patch.service";
import { excludeOverriddenFailures, getOverriddenKeysByAgent } from "../services/zeroTrustOverride.service";
import { getAgentRollupsCached } from "../cache/fleetCache";
import { effectiveLastCheckin } from "../presence/presence";
import { quarantineAgents, releaseAgents } from "../services/quarantine.service";
import { AgentNotFoundError, disableRemoteAccess, enableRemoteAccess, normalizeAdminIp } from "../services/remoteAccess.service";
import { pauseAgent, resumeAgent, AgentNotFoundError as PauseAgentNotFoundError } from "../services/pause.service";
import { incrementTotalAgentsUninstalled } from "../services/licenseActivation.service";
import {
  buildBatteryView,
  buildIpGeoHint,
  computeStatus,
  deriveDeviceType,
  extractOsEditionLabel,
  summarizeDiskLayout,
} from "../services/agentDerived.util";

export const adminRouter = Router();

adminRouter.get("/agents", async (_req, res, next) => {
  try {
    const agents = await prisma.agent.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        groupMemberships: { include: { group: true } },
        // Nested select (not a bare `inventory: true`) deliberately excludes
        // installedSoftware/diskInfo/osInfo — those are large JSON blobs only needed
        // on the single-agent detail view, and this list is polled every 5s.
        inventory: {
          select: {
            cpuModel: true,
            cpuCores: true,
            cpuPhysicalCores: true,
            cpuSpeedGhz: true,
            totalMemBytes: true,
            memLayout: true,
            osInfo: true,
            pcSystemType: true,
            osLicenseStatus: true,
            osLicenseChannel: true,
            osPartialProductKey: true,
            lastLoggedOnUser: true,
            diskInfo: true,
            batteryPresent: true,
            batteryDesignCapacityMwh: true,
            batteryFullChargeCapacityMwh: true,
            batteryChargePercent: true,
            batteryCycleCount: true,
            batteryCharging: true,
            batteryAcConnected: true,
          },
        },
      },
    });

    // Per-agent rollups for the endpoint list's summary row. Served from the fleet cache
    // (recomputed on a short timer) instead of running these fleet-wide scans on every poll
    // from every open console tab - the vulnerability table alone can hold hundreds of
    // thousands of rows. The agent list itself (above) stays live, so per-agent actions
    // (quarantine, pause, status) still reflect immediately.
    const { vulnCountByAgent, ztCountByAgent, lastPatchByAgent: lastPatchInstalledByAgent, latestUpdateTaskByAgent } =
      await getAgentRollupsCached();

    res.json(
      agents.map((a) => ({
        id: a.id,
        hostname: a.hostname,
        osPlatform: a.osPlatform,
        osVersion: a.osVersion,
        osArch: a.osArch,
        agentVersion: a.agentVersion,
        ipAddress: a.ipAddress,
        macAddress: a.macAddress,
        tags: JSON.parse(a.tags) as string[],
        lifecycleStatus: a.lifecycleStatus,
        groups: a.groupMemberships.map((m) => ({ id: m.group.id, name: m.group.name })),
        serialNumber: a.serialNumber,
        vendor: a.vendor,
        purchaseDate: a.purchaseDate?.toISOString() ?? null,
        warrantyExpiryDate: a.warrantyExpiryDate?.toISOString() ?? null,
        location: a.location,
        ipGeoHint: buildIpGeoHint(a),
        osEol: getWindowsEolInfo(a.osVersion, extractOsEditionLabel(a.inventory?.osInfo)),
        osEditionLabel: extractOsEditionLabel(a.inventory?.osInfo),
        deviceTypeOverride: a.deviceTypeOverride,
        deviceType: a.deviceTypeOverride ?? deriveDeviceType(a.inventory?.pcSystemType ?? null, extractOsEditionLabel(a.inventory?.osInfo)),
        quarantined: a.quarantined,
        paused: a.paused,
        pausedAt: a.pausedAt?.toISOString() ?? null,
        zeroTrustNonCompliantCount: ztCountByAgent.get(a.id) ?? 0,
        openVulnerabilityCount: vulnCountByAgent.get(a.id) ?? 0,
        lastPatchInstalledAt: lastPatchInstalledByAgent.get(a.id)?.toISOString() ?? null,
        latestUpdateTask: latestUpdateTaskByAgent.get(a.id) ?? null,
        inventory: a.inventory
          ? {
              cpuModel: a.inventory.cpuModel,
              cpuCores: a.inventory.cpuCores,
              cpuPhysicalCores: a.inventory.cpuPhysicalCores,
              cpuSpeedGhz: a.inventory.cpuSpeedGhz,
              totalMemBytes: a.inventory.totalMemBytes?.toString() ?? null,
              memLayout: JSON.parse(a.inventory.memLayout),
              osLicenseStatus: a.inventory.osLicenseStatus,
              osLicenseChannel: a.inventory.osLicenseChannel,
              osPartialProductKey: a.inventory.osPartialProductKey,
              lastLoggedOnUser: a.inventory.lastLoggedOnUser,
              ...summarizeDiskLayout(a.inventory.diskInfo),
              battery: buildBatteryView(a.inventory),
            }
          : null,
        lastCheckinAt: effectiveLastCheckin(a.id, a.lastCheckinAt)?.toISOString() ?? null,
        status: computeStatus(effectiveLastCheckin(a.id, a.lastCheckinAt)),
        createdAt: a.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/agents/:id", async (req, res, next) => {
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      include: { inventory: true, groupMemberships: { include: { group: true } } },
    });
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const customFieldValues = await getAgentCustomFieldValues(agent.id);
    const [openVulnerabilityCount, nonCompliantZtFindingsRaw, lastPatchInstalledByAgent, latestUpdateTaskByAgent, latestAvailablePatch] =
      await Promise.all([
        prisma.vulnerabilityFinding.count({ where: { agentId: agent.id, status: "OPEN" } }),
        prisma.zeroTrustFinding.findMany({
          where: { agentId: agent.id, status: "FAIL", condition: { enabled: true } },
          select: { agentId: true, status: true, condition: { select: { conditionKey: true } } },
        }),
        getLastPatchInstalledAtByAgent(agent.id),
        getLatestAgentUpdateTaskByAgent([agent.id]),
        getLatestMissingPatchByAgent(agent.id),
      ]);
    const overriddenForThisAgent = await getOverriddenKeysByAgent([agent.id]);
    const zeroTrustNonCompliantCount = excludeOverriddenFailures(
      nonCompliantZtFindingsRaw.map((f) => ({ agentId: f.agentId, status: f.status, conditionKey: f.condition.conditionKey })),
      overriddenForThisAgent,
    ).length;

    res.json({
      id: agent.id,
      hostname: agent.hostname,
      osPlatform: agent.osPlatform,
      osVersion: agent.osVersion,
      osArch: agent.osArch,
      agentVersion: agent.agentVersion,
      ipAddress: agent.ipAddress,
      macAddress: agent.macAddress,
      tags: JSON.parse(agent.tags) as string[],
      lifecycleStatus: agent.lifecycleStatus,
      groups: agent.groupMemberships.map((m) => ({ id: m.group.id, name: m.group.name })),
      customFieldValues,
      serialNumber: agent.serialNumber,
      vendor: agent.vendor,
      purchaseDate: agent.purchaseDate?.toISOString() ?? null,
      warrantyExpiryDate: agent.warrantyExpiryDate?.toISOString() ?? null,
      location: agent.location,
      ipGeoHint: buildIpGeoHint(agent),
      osEol: getWindowsEolInfo(agent.osVersion, extractOsEditionLabel(agent.inventory?.osInfo)),
      osEditionLabel: extractOsEditionLabel(agent.inventory?.osInfo),
      deviceTypeOverride: agent.deviceTypeOverride,
      deviceType: agent.deviceTypeOverride ?? deriveDeviceType(agent.inventory?.pcSystemType ?? null, extractOsEditionLabel(agent.inventory?.osInfo)),
      quarantined: agent.quarantined,
      paused: agent.paused,
      pausedAt: agent.pausedAt?.toISOString() ?? null,
      remoteAccessEnabled: agent.remoteAccessEnabled,
      remoteAccessEnabledAt: agent.remoteAccessEnabledAt?.toISOString() ?? null,
      remoteAccessAllowedIp: agent.remoteAccessAllowedIp,
      zeroTrustNonCompliantCount,
      openVulnerabilityCount,
      lastPatchInstalledAt: lastPatchInstalledByAgent.get(agent.id)?.toISOString() ?? null,
      latestUpdateTask: latestUpdateTaskByAgent.get(agent.id) ?? null,
      latestAvailablePatch,
      lastCheckinAt: effectiveLastCheckin(agent.id, agent.lastCheckinAt)?.toISOString() ?? null,
      status: computeStatus(effectiveLastCheckin(agent.id, agent.lastCheckinAt)),
      createdAt: agent.createdAt.toISOString(),
      inventory: agent.inventory
        ? {
            agentId: agent.inventory.agentId,
            cpuModel: agent.inventory.cpuModel,
            cpuCores: agent.inventory.cpuCores,
            cpuPhysicalCores: agent.inventory.cpuPhysicalCores,
            cpuSpeedGhz: agent.inventory.cpuSpeedGhz,
            totalMemBytes: agent.inventory.totalMemBytes?.toString() ?? null,
            memLayout: JSON.parse(agent.inventory.memLayout),
            osInfo: JSON.parse(agent.inventory.osInfo),
            osBuild: agent.inventory.osBuild,
            osLicenseStatus: agent.inventory.osLicenseStatus,
            osLicenseChannel: agent.inventory.osLicenseChannel,
            osPartialProductKey: agent.inventory.osPartialProductKey,
            lastLoggedOnUser: agent.inventory.lastLoggedOnUser,
            ...summarizeDiskLayout(agent.inventory.diskInfo),
            diskInfo: JSON.parse(agent.inventory.diskInfo),
            diskVolumes: JSON.parse(agent.inventory.diskVolumes),
            installedSoftware: await annotateWithLicenseStatus(JSON.parse(agent.inventory.installedSoftware)),
            battery: buildBatteryView(agent.inventory),
            collectedAt: agent.inventory.collectedAt.toISOString(),
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch("/agents/:id/lifecycle", async (req, res, next) => {
  try {
    const payload = updateLifecycleStatusRequestSchema.parse(req.body);
    await setAgentLifecycle(req.params.id, payload.lifecycleStatus);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminRouter.patch("/agents/:id/asset-details", async (req, res, next) => {
  try {
    const payload = updateAssetDetailsRequestSchema.parse(req.body);
    await updateAssetDetails(req.params.id, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/agents/:id/quarantine", async (req, res, next) => {
  try {
    const result = await quarantineAgents([req.params.id], req.adminId!);
    if (!result) return res.status(404).json({ error: "Agent not found" });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/agents/:id/release", async (req, res, next) => {
  try {
    const result = await releaseAgents([req.params.id], req.adminId!);
    if (!result) return res.status(404).json({ error: "Agent not found" });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/agents/:id/remote-access/enable", async (req, res, next) => {
  try {
    const adminIp = normalizeAdminIp(req.ip ?? "");
    if (!adminIp) return res.status(400).json({ error: "Could not determine the admin's source IP address" });
    const result = await enableRemoteAccess(req.params.id, adminIp, req.adminId!);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AgentNotFoundError) return res.status(404).json({ error: "Agent not found" });
    next(err);
  }
});

adminRouter.post("/agents/:id/remote-access/disable", async (req, res, next) => {
  try {
    const result = await disableRemoteAccess(req.params.id, req.adminId!);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AgentNotFoundError) return res.status(404).json({ error: "Agent not found" });
    next(err);
  }
});

adminRouter.post("/agents/:id/pause", async (req, res, next) => {
  try {
    await pauseAgent(req.params.id, req.adminId!);
    res.status(204).send();
  } catch (err) {
    if (err instanceof PauseAgentNotFoundError) return res.status(404).json({ error: "Agent not found" });
    next(err);
  }
});

adminRouter.post("/agents/:id/resume", async (req, res, next) => {
  try {
    await resumeAgent(req.params.id, req.adminId!);
    res.status(204).send();
  } catch (err) {
    if (err instanceof PauseAgentNotFoundError) return res.status(404).json({ error: "Agent not found" });
    next(err);
  }
});

adminRouter.post("/agents/:id/uninstall-software", async (req, res, next) => {
  try {
    const payload = uninstallSoftwareRequestSchema.parse(req.body);
    const result = await uninstallSoftwareOnAgent(req.params.id, payload.softwareName, req.adminId!);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// Same password this deployment's Tamper Protection uninstall check uses (Console ->
// Asset Settings) — required here too even though dispatching already needs an
// authenticated admin session, as a deliberate extra confirmation before an action that
// removes the agent from an endpoint entirely.
adminRouter.post("/agents/:id/uninstall-agent", async (req, res, next) => {
  try {
    const payload = verifyUninstallPasswordRequestSchema.parse(req.body);
    const result = await uninstallAgentRemotely(req.params.id, payload.password, req.adminId!);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof IncorrectUninstallPasswordError) {
      return res.status(401).json({ error: err.message });
    }
    next(err);
  }
});

adminRouter.post("/agents/quarantine-bulk", async (req, res, next) => {
  try {
    const payload = dispatchTargetRequestSchema.parse(req.body);
    const resolvedAgentIds = await resolveTargetAgentIds(payload.agentIds, payload.groupIds);
    if (resolvedAgentIds.length === 0) return res.status(400).json({ error: "No agents resolved from the given agentIds/groupIds" });
    const result = await quarantineAgents(resolvedAgentIds, req.adminId!);
    if (!result) return res.status(404).json({ error: "No matching agents found" });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/agents/release-bulk", async (req, res, next) => {
  try {
    const payload = dispatchTargetRequestSchema.parse(req.body);
    const resolvedAgentIds = await resolveTargetAgentIds(payload.agentIds, payload.groupIds);
    if (resolvedAgentIds.length === 0) return res.status(400).json({ error: "No agents resolved from the given agentIds/groupIds" });
    const result = await releaseAgents(resolvedAgentIds, req.adminId!);
    if (!result) return res.status(404).json({ error: "No matching agents found" });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

adminRouter.put("/agents/:id/groups", async (req, res, next) => {
  try {
    const payload = setAgentGroupsRequestSchema.parse(req.body);
    await setAgentGroups(req.params.id, payload.groupIds);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminRouter.put("/agents/:id/custom-fields", async (req, res, next) => {
  try {
    const payload = setCustomFieldValuesRequestSchema.parse(req.body);
    await setAgentCustomFieldValues(req.params.id, payload.values);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/agents/:id/notes", async (req, res, next) => {
  try {
    res.json(await listAgentNotes(req.params.id));
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/agents/:id/notes", async (req, res, next) => {
  try {
    const payload = createNoteRequestSchema.parse(req.body);
    res.status(201).json(await createAgentNote(req.params.id, req.adminId!, payload.body));
  } catch (err) {
    next(err);
  }
});

adminRouter.delete("/agents/:id", async (req, res, next) => {
  try {
    await prisma.agent.delete({ where: { id: req.params.id } });
    await incrementTotalAgentsUninstalled();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Surfaced from the Agent Updates page's "Duplicate Entries" panel - see
// findDuplicateAgents's own comment for exactly what counts as a duplicate here.
adminRouter.get("/agents/duplicates", async (_req, res, next) => {
  try {
    res.json(await findDuplicateAgents());
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/agents/duplicates/delete", async (req, res, next) => {
  try {
    const agentIds = Array.isArray(req.body?.agentIds) ? (req.body.agentIds as string[]) : [];
    const deletedCount = await deleteAgentsBulk(agentIds);
    res.json({ deletedCount });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/enrollment-tokens", async (req, res, next) => {
  try {
    const payload = createEnrollmentTokenRequestSchema.parse(req.body);
    const result = await createEnrollmentToken(payload);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/enrollment-tokens", async (_req, res, next) => {
  try {
    const tokens = await prisma.enrollmentToken.findMany({
      orderBy: { createdAt: "desc" },
      include: { group: { select: { name: true } } },
    });
    res.json(
      tokens.map((t) => ({
        id: t.id,
        label: t.label,
        usesRemaining: t.usesRemaining,
        expiresAt: t.expiresAt.toISOString(),
        revoked: t.revoked,
        createdAt: t.createdAt.toISOString(),
        groupId: t.groupId,
        groupName: t.group?.name ?? null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// Carries this server's addresses (Server connection details) but no token, so running it
// only asks for an enrollment token - see buildConfiguredSetupExe.
adminRouter.get("/agent-installer", async (_req, res, next) => {
  try {
    const exe = await buildConfiguredSetupExe();
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="EndpointProAgentSetup.exe"');
    res.send(exe);
  } catch (err) {
    if (err instanceof AgentInstallerMissingError) return res.status(404).json({ error: err.message });
    next(err);
  }
});

adminRouter.get("/agent-connection", async (_req, res, next) => {
  try {
    res.json(await getAgentConnectionSettings());
  } catch (err) {
    next(err);
  }
});

adminRouter.put("/agent-connection", async (req, res, next) => {
  try {
    const payload = updateAgentConnectionSettingsRequestSchema.parse(req.body);
    res.json(await setAgentConnectionSettings(payload));
  } catch (err) {
    next(err);
  }
});

// The same EndpointProAgentSetup.exe as GET /agent-installer, with this server's addresses and
// the given token appended (see buildConfiguredSetupExe) - double-click installs with no
// prompts. POST because the plaintext token only exists in the browser right after creating
// it (only its hash is stored); it must match this token id and still be usable.
adminRouter.post("/enrollment-tokens/:id/setup-exe", async (req, res, next) => {
  try {
    const { enrollmentToken } = downloadAgentSetupRequestSchema.parse(req.body);
    const token = await prisma.enrollmentToken.findUnique({ where: { id: req.params.id } });
    if (!token || token.tokenHash !== hashToken(enrollmentToken)) {
      return res.status(404).json({ error: "Enrollment token not found" });
    }
    if (token.revoked || token.expiresAt < new Date() || token.usesRemaining <= 0) {
      return res.status(400).json({ error: "This enrollment token is revoked, expired or used up" });
    }

    const exe = await buildConfiguredSetupExe(enrollmentToken);
    const safeLabel = token.label.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "agent";
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="EndpointProAgentSetup-${safeLabel}.exe"`);
    res.send(exe);
  } catch (err) {
    if (err instanceof AgentInstallerMissingError) return res.status(404).json({ error: err.message });
    next(err);
  }
});

adminRouter.delete("/enrollment-tokens/:id", async (req, res, next) => {
  try {
    await prisma.enrollmentToken.update({ where: { id: req.params.id }, data: { revoked: true } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// "Install on endpoint" (Enrollment Tokens page, step 2 right after creating a token - the
// plaintext token value only ever exists in the response of the create call above, never
// persisted, so this only works against a token created in the same browser session).
// Fire-and-forget on the service side - responds with a jobId immediately, console polls
// the GET below for progress. See remoteInstall.service.ts for why username/password never
// touch the database.
adminRouter.post("/remote-install", async (req, res, next) => {
  try {
    const payload = startRemoteInstallRequestSchema.parse(req.body);
    const result = await startRemoteInstall(payload, req.adminId!);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/remote-install/:jobId", async (req, res, next) => {
  try {
    const job = await getRemoteInstallJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Remote install job not found" });
    res.json(job);
  } catch (err) {
    next(err);
  }
});
