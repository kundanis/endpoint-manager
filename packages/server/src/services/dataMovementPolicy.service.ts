import type { AssignDataMovementPolicyRequest, CreateDataMovementPolicyRequest, UpdateDataMovementPolicyRequest } from "@em/shared";
import { prisma } from "../db";
import { resolveTargetAgentIds } from "./agentTargeting.service";

async function resolveAssignedAgentIdsForPolicy(policyId: string): Promise<string[]> {
  const assignments = await prisma.dataMovementPolicyAssignment.findMany({ where: { policyId } });
  const agentIds = assignments.filter((a) => a.agentId).map((a) => a.agentId!);
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  return resolveTargetAgentIds(agentIds, groupIds);
}

export async function createPolicy(params: CreateDataMovementPolicyRequest, createdByAdminId: string) {
  const policy = await prisma.dataMovementPolicy.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      monitorUsb: params.monitorUsb,
      monitorCloudSync: params.monitorCloudSync,
      monitorNetworkShare: params.monitorNetworkShare,
      extraCloudSyncPaths: JSON.stringify(params.extraCloudSyncPaths),
      enabled: params.enabled,
      createdByAdminId,
    },
  });
  return getPolicy(policy.id);
}

export async function listPolicies() {
  const policies = await prisma.dataMovementPolicy.findMany({
    orderBy: { createdAt: "asc" },
    include: { events: { select: { id: true } } },
  });

  return Promise.all(
    policies.map(async (p) => {
      const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(p.id);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        monitorUsb: p.monitorUsb,
        monitorCloudSync: p.monitorCloudSync,
        monitorNetworkShare: p.monitorNetworkShare,
        extraCloudSyncPaths: JSON.parse(p.extraCloudSyncPaths) as string[],
        enabled: p.enabled,
        assignedAgentCount: assignedAgentIds.length,
        eventCount: p.events.length,
        createdAt: p.createdAt.toISOString(),
      };
    }),
  );
}

export async function getPolicy(id: string) {
  const policy = await prisma.dataMovementPolicy.findUnique({ where: { id }, include: { events: { select: { id: true } } } });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(id);
  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    monitorUsb: policy.monitorUsb,
    monitorCloudSync: policy.monitorCloudSync,
    monitorNetworkShare: policy.monitorNetworkShare,
    extraCloudSyncPaths: JSON.parse(policy.extraCloudSyncPaths) as string[],
    enabled: policy.enabled,
    assignedAgentCount: assignedAgentIds.length,
    eventCount: policy.events.length,
    createdAt: policy.createdAt.toISOString(),
  };
}

export async function updatePolicy(id: string, params: UpdateDataMovementPolicyRequest) {
  await prisma.dataMovementPolicy.update({
    where: { id },
    data: {
      name: params.name,
      description: params.description,
      monitorUsb: params.monitorUsb,
      monitorCloudSync: params.monitorCloudSync,
      monitorNetworkShare: params.monitorNetworkShare,
      extraCloudSyncPaths: params.extraCloudSyncPaths ? JSON.stringify(params.extraCloudSyncPaths) : undefined,
      enabled: params.enabled,
    },
  });
  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  try {
    await prisma.dataMovementPolicy.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function assignPolicy(policyId: string, params: AssignDataMovementPolicyRequest) {
  await prisma.dataMovementPolicyAssignment.createMany({
    data: [
      ...params.agentIds.map((agentId) => ({ policyId, agentId })),
      ...params.groupIds.map((groupId) => ({ policyId, groupId })),
    ],
  });
  return getPolicy(policyId);
}

export async function listAssignments(policyId: string) {
  const assignments = await prisma.dataMovementPolicyAssignment.findMany({
    where: { policyId },
    include: { agent: true, group: true },
  });
  return assignments.map((a) => ({
    id: a.id,
    agentId: a.agentId,
    hostname: a.agent?.hostname ?? null,
    groupId: a.groupId,
    groupName: a.group?.name ?? null,
  }));
}

export async function unassign(policyId: string, assignmentId: string): Promise<boolean> {
  const result = await prisma.dataMovementPolicyAssignment.deleteMany({ where: { id: assignmentId, policyId } });
  return result.count > 0;
}

export async function getPolicyAgentBreakdown(policyId: string) {
  const policy = await prisma.dataMovementPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(policyId);
  const agents = assignedAgentIds.length > 0 ? await prisma.agent.findMany({ where: { id: { in: assignedAgentIds } } }) : [];
  const events = await prisma.dataMovementEvent.findMany({ where: { policyId }, orderBy: { detectedAt: "desc" } });

  const eventsByAgent = new Map<string, typeof events>();
  for (const e of events) {
    const list = eventsByAgent.get(e.agentId) ?? [];
    list.push(e);
    eventsByAgent.set(e.agentId, list);
  }

  return {
    policyId,
    name: policy.name,
    agents: agents.map((a) => {
      const agentEvents = eventsByAgent.get(a.id) ?? [];
      return {
        agentId: a.id,
        hostname: a.hostname,
        eventCount: agentEvents.length,
        usbCount: agentEvents.filter((e) => e.channel === "USB").length,
        cloudSyncCount: agentEvents.filter((e) => e.channel === "CLOUD_SYNC").length,
        networkShareCount: agentEvents.filter((e) => e.channel === "NETWORK_SHARE").length,
        lastEventAt: agentEvents[0]?.detectedAt.toISOString() ?? null,
      };
    }),
  };
}

export async function getEventsForAgent(agentId: string) {
  const events = await prisma.dataMovementEvent.findMany({
    where: { agentId },
    include: { policy: true },
    orderBy: { detectedAt: "desc" },
    take: 200,
  });

  return events.map((e) => ({
    id: e.id,
    policyId: e.policyId,
    policyName: e.policy.name,
    filePath: e.filePath,
    fileSizeBytes: e.fileSizeBytes.toString(),
    fileModifiedAt: e.fileModifiedAt.toISOString(),
    channel: e.channel as "USB" | "CLOUD_SYNC" | "NETWORK_SHARE",
    channelDetail: JSON.parse(e.channelDetail) as Record<string, string | null>,
    detectedAt: e.detectedAt.toISOString(),
  }));
}
