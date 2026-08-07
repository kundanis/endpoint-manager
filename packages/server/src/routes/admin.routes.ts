import fs from "node:fs";
import { Router } from "express";
import {
  createEnrollmentTokenRequestSchema,
  createNoteRequestSchema,
  dispatchTargetRequestSchema,
  getWindowsEolInfo,
  setAgentGroupsRequestSchema,
  setCustomFieldValuesRequestSchema,
  uninstallSoftwareRequestSchema,
  updateAssetDetailsRequestSchema,
  updateLifecycleStatusRequestSchema,
  verifyUninstallPasswordRequestSchema,
} from "@em/shared";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { prisma } from "../db";
import { config } from "../config";
import { createEnrollmentToken } from "../services/enrollment.service";
import { annotateWithLicenseStatus } from "../services/softwareLicense.service";
import {
  createAgentNote,
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
import { quarantineAgents, releaseAgents } from "../services/quarantine.service";
import { AgentNotFoundError, disableRemoteAccess, enableRemoteAccess, normalizeAdminIp } from "../services/remoteAccess.service";
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

    // Per-agent counts for the endpoint list's summary row — computed once for the
    // whole list rather than N+1 queries per row.
    const [openVulnFindings, nonCompliantZtFindings] = await Promise.all([
      prisma.vulnerabilityFinding.findMany({ where: { status: "OPEN" }, select: { agentId: true } }),
      // Only enabled conditions count — matches the same filter used everywhere else
      // a Zero Trust compliance figure is computed.
      prisma.zeroTrustFinding.findMany({ where: { status: "FAIL", condition: { enabled: true } }, select: { agentId: true } }),
    ]);
    const vulnCountByAgent = new Map<string, number>();
    for (const f of openVulnFindings) vulnCountByAgent.set(f.agentId, (vulnCountByAgent.get(f.agentId) ?? 0) + 1);
    const ztCountByAgent = new Map<string, number>();
    for (const f of nonCompliantZtFindings) ztCountByAgent.set(f.agentId, (ztCountByAgent.get(f.agentId) ?? 0) + 1);

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
        osEol: getWindowsEolInfo(a.osVersion),
        osEditionLabel: extractOsEditionLabel(a.inventory?.osInfo),
        deviceTypeOverride: a.deviceTypeOverride,
        deviceType: a.deviceTypeOverride ?? deriveDeviceType(a.inventory?.pcSystemType ?? null, extractOsEditionLabel(a.inventory?.osInfo)),
        quarantined: a.quarantined,
        zeroTrustNonCompliantCount: ztCountByAgent.get(a.id) ?? 0,
        openVulnerabilityCount: vulnCountByAgent.get(a.id) ?? 0,
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
        lastCheckinAt: a.lastCheckinAt?.toISOString() ?? null,
        status: computeStatus(a.lastCheckinAt),
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
    const [openVulnerabilityCount, zeroTrustNonCompliantCount] = await Promise.all([
      prisma.vulnerabilityFinding.count({ where: { agentId: agent.id, status: "OPEN" } }),
      prisma.zeroTrustFinding.count({ where: { agentId: agent.id, status: "FAIL", condition: { enabled: true } } }),
    ]);

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
      osEol: getWindowsEolInfo(agent.osVersion),
      osEditionLabel: extractOsEditionLabel(agent.inventory?.osInfo),
      deviceTypeOverride: agent.deviceTypeOverride,
      deviceType: agent.deviceTypeOverride ?? deriveDeviceType(agent.inventory?.pcSystemType ?? null, extractOsEditionLabel(agent.inventory?.osInfo)),
      quarantined: agent.quarantined,
      remoteAccessEnabled: agent.remoteAccessEnabled,
      remoteAccessEnabledAt: agent.remoteAccessEnabledAt?.toISOString() ?? null,
      remoteAccessAllowedIp: agent.remoteAccessAllowedIp,
      zeroTrustNonCompliantCount,
      openVulnerabilityCount,
      lastCheckinAt: agent.lastCheckinAt?.toISOString() ?? null,
      status: computeStatus(agent.lastCheckinAt),
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
    res.status(204).send();
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

adminRouter.get("/agent-installer", async (_req, res, next) => {
  try {
    if (!fs.existsSync(config.agentInstallerPath)) {
      return res.status(404).json({
        error:
          "No agent installer has been published on this server yet. Build one with " +
          "'npm run package -w @em/agent' and place EndpointProAgentSetup.exe in the " +
          "configured AGENT_INSTALLER_DIR.",
      });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="EndpointProAgentSetup.exe"');
    const stream = fs.createReadStream(config.agentInstallerPath);
    stream.on("error", next);
    stream.pipe(res);
  } catch (err) {
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
