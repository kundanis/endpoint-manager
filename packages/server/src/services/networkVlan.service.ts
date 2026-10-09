import type { CreateNetworkVlanRequest, UpdateNetworkVlanRequest } from "@em/shared";
import { prisma } from "../db";
import {
  expandCidr,
  InvalidCidrError,
  resolveAgentHostnames,
  runNetworkScan,
  ScanAlreadyRunningError,
} from "./networkScan.service";

export class VlanNotFoundError extends Error {}

export async function createVlan(params: CreateNetworkVlanRequest & { createdByAdminId: string }) {
  expandCidr(params.cidr); // validates + enforces the size guard before saving
  return prisma.networkVlan.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      cidr: params.cidr,
      assignedAgentId: params.assignedAgentId ?? null,
      enabled: params.enabled,
      createdByAdminId: params.createdByAdminId,
    },
  });
}

export async function updateVlan(id: string, params: UpdateNetworkVlanRequest) {
  const existing = await prisma.networkVlan.findUnique({ where: { id } });
  if (!existing) throw new VlanNotFoundError();
  if (params.cidr !== undefined) expandCidr(params.cidr);

  return prisma.networkVlan.update({
    where: { id },
    data: {
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.cidr !== undefined && { cidr: params.cidr }),
      ...(params.assignedAgentId !== undefined && { assignedAgentId: params.assignedAgentId }),
      ...(params.enabled !== undefined && { enabled: params.enabled }),
    },
  });
}

export async function deleteVlan(id: string): Promise<void> {
  await prisma.networkVlan.delete({ where: { id } });
}

async function attachLatestRun(vlanId: string) {
  const latestRun = await prisma.networkScanRun.findFirst({
    where: { vlanId },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, hostsFound: true, startedAt: true },
  });
  return latestRun
    ? {
        id: latestRun.id,
        status: latestRun.status,
        hostsFound: latestRun.hostsFound,
        startedAt: latestRun.startedAt.toISOString(),
      }
    : null;
}

export async function listVlans() {
  const vlans = await prisma.networkVlan.findMany({ orderBy: { createdAt: "desc" } });
  const hostnameByAgentId = await resolveAgentHostnames(vlans.map((v) => v.assignedAgentId));

  return Promise.all(
    vlans.map(async (v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      cidr: v.cidr,
      assignedAgentId: v.assignedAgentId,
      assignedAgentHostname: v.assignedAgentId ? (hostnameByAgentId.get(v.assignedAgentId) ?? "(agent deleted)") : null,
      enabled: v.enabled,
      createdAt: v.createdAt.toISOString(),
      latestRun: await attachLatestRun(v.id),
    })),
  );
}

export async function getVlan(id: string) {
  const vlan = await prisma.networkVlan.findUnique({ where: { id } });
  if (!vlan) return null;
  const hostnameByAgentId = await resolveAgentHostnames([vlan.assignedAgentId]);

  return {
    id: vlan.id,
    name: vlan.name,
    description: vlan.description,
    cidr: vlan.cidr,
    assignedAgentId: vlan.assignedAgentId,
    assignedAgentHostname: vlan.assignedAgentId ? (hostnameByAgentId.get(vlan.assignedAgentId) ?? "(agent deleted)") : null,
    enabled: vlan.enabled,
    createdAt: vlan.createdAt.toISOString(),
  };
}

// The "one scan running" guard is scoped by execution target (agentId, with null meaning
// "the server itself"), not global and not per-VLAN — see networkScan.service.ts's startScan
// for the server-side bucket. Two VLANs assigned to the SAME agent must still serialize
// against each other (that agent can't run two concurrent ping sweeps), which this achieves
// automatically since they'd share the same targetAgentId bucket.
export async function triggerVlanScan(vlanId: string, adminId: string): Promise<{ id: string }> {
  const vlan = await prisma.networkVlan.findUnique({ where: { id: vlanId } });
  if (!vlan) throw new VlanNotFoundError();
  expandCidr(vlan.cidr); // defense in depth — already validated at save time

  const targetAgentId = vlan.assignedAgentId;
  const existingActive = await prisma.networkScanRun.findFirst({
    where: { status: { in: ["PENDING", "RUNNING"] }, agentId: targetAgentId },
  });
  if (existingActive) throw new ScanAlreadyRunningError(existingActive.id);

  if (!targetAgentId) {
    const run = await prisma.networkScanRun.create({
      data: {
        cidr: vlan.cidr,
        vlanId: vlan.id,
        vlanNameSnapshot: vlan.name,
        agentId: null,
        triggeredByAdminId: adminId,
      },
    });
    void runNetworkScan(run.id, vlan.cidr);
    return { id: run.id };
  }

  // assignedAgentId is a plain snapshot column, not a live FK (see schema.prisma) — the DB
  // won't auto-clear it if that agent was since deleted, so it's checked fresh here instead.
  const agent = await prisma.agent.findUnique({ where: { id: targetAgentId }, select: { id: true } });
  if (!agent) {
    throw new InvalidCidrError("This VLAN's assigned agent no longer exists — reassign or clear it before scanning");
  }

  const run = await prisma.networkScanRun.create({
    data: {
      cidr: vlan.cidr,
      vlanId: vlan.id,
      vlanNameSnapshot: vlan.name,
      agentId: targetAgentId,
      triggeredByAdminId: adminId,
      status: "PENDING",
      task: { create: {} },
    },
  });
  return { id: run.id };
}

export interface ScanAllResult {
  vlanId: string;
  scanRunId?: string;
  error?: string;
}

// Sequential, not parallel — two enabled VLANs sharing one assigned agent must serialize
// via triggerVlanScan's running-guard; firing them concurrently would race both past the
// "is one already active" check before either run row exists.
export async function scanAllEnabledVlans(adminId: string): Promise<ScanAllResult[]> {
  const vlans = await prisma.networkVlan.findMany({ where: { enabled: true } });
  const results: ScanAllResult[] = [];
  for (const vlan of vlans) {
    try {
      const { id } = await triggerVlanScan(vlan.id, adminId);
      results.push({ vlanId: vlan.id, scanRunId: id });
    } catch (err) {
      results.push({ vlanId: vlan.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

export interface NetworkDeviceVlanSummary {
  vlanId: string;
  vlanName: string;
  hasScan: boolean;
  total: number;
  managed: number;
  unmanaged: number;
}

export interface UnmanagedNetworkDevice {
  vlanName: string;
  ipAddress: string;
  macAddress: string | null;
  hostname: string | null;
  openPorts: number[];
}

// "Network devices" = unmanaged hosts (no matched agent) from each VLAN's LATEST scan run
// — reused by both the Dashboard's VLAN-wise pie and the Endpoints page's Network Devices
// panel, one query, two call sites. A VLAN with no scan run yet contributes hasScan:false
// (not 0/0, which would misleadingly read as "fully covered").
export async function getNetworkDeviceSummary(): Promise<{
  perVlan: NetworkDeviceVlanSummary[];
  unmanagedHosts: UnmanagedNetworkDevice[];
}> {
  const vlans = await prisma.networkVlan.findMany();
  const latestRunByVlan = await Promise.all(
    vlans.map((v) =>
      prisma.networkScanRun.findFirst({ where: { vlanId: v.id }, orderBy: { startedAt: "desc" }, select: { id: true } }),
    ),
  );

  const vlanNameByRunId = new Map<string, string>();
  vlans.forEach((v, i) => {
    const run = latestRunByVlan[i];
    if (run) vlanNameByRunId.set(run.id, v.name);
  });

  const runIds = [...vlanNameByRunId.keys()];
  const hosts =
    runIds.length > 0
      ? await prisma.discoveredHost.findMany({
          where: { scanRunId: { in: runIds } },
          select: { scanRunId: true, ipAddress: true, macAddress: true, hostname: true, matchedAgentId: true, openPorts: true },
        })
      : [];

  const hostsByRunId = new Map<string, typeof hosts>();
  for (const h of hosts) {
    const arr = hostsByRunId.get(h.scanRunId) ?? [];
    arr.push(h);
    hostsByRunId.set(h.scanRunId, arr);
  }

  const perVlan: NetworkDeviceVlanSummary[] = vlans.map((v, i) => {
    const run = latestRunByVlan[i];
    if (!run) return { vlanId: v.id, vlanName: v.name, hasScan: false, total: 0, managed: 0, unmanaged: 0 };
    const vlanHosts = hostsByRunId.get(run.id) ?? [];
    const managed = vlanHosts.filter((h) => h.matchedAgentId).length;
    return { vlanId: v.id, vlanName: v.name, hasScan: true, total: vlanHosts.length, managed, unmanaged: vlanHosts.length - managed };
  });

  const unmanagedHosts: UnmanagedNetworkDevice[] = hosts
    .filter((h) => !h.matchedAgentId)
    .map((h) => ({
      vlanName: vlanNameByRunId.get(h.scanRunId) ?? "Unknown VLAN",
      ipAddress: h.ipAddress,
      macAddress: h.macAddress,
      hostname: h.hostname,
      openPorts: JSON.parse(h.openPorts) as number[],
    }));

  return { perVlan, unmanagedHosts };
}
