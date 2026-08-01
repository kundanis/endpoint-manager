import type {
  AssignDataDiscoveryPolicyRequest,
  CreateDataDiscoveryPolicyRequest,
  DataDiscoveryRegulation,
  UpdateDataDiscoveryPolicyRequest,
} from "@em/shared";
import { getPiiPatternLabel } from "@em/shared";
import { prisma } from "../db";
import { resolveTargetAgentIds } from "./agentTargeting.service";

async function resolveAssignedAgentIdsForPolicy(policyId: string): Promise<string[]> {
  const assignments = await prisma.dataDiscoveryPolicyAssignment.findMany({ where: { policyId } });
  const agentIds = assignments.filter((a) => a.agentId).map((a) => a.agentId!);
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  return resolveTargetAgentIds(agentIds, groupIds);
}

export async function createPolicy(params: CreateDataDiscoveryPolicyRequest, createdByAdminId: string) {
  const policy = await prisma.dataDiscoveryPolicy.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      regulation: params.regulation,
      targetPaths: JSON.stringify(params.targetPaths),
      enabled: params.enabled,
      createdByAdminId,
    },
  });
  return getPolicy(policy.id);
}

export async function listPolicies() {
  const policies = await prisma.dataDiscoveryPolicy.findMany({
    orderBy: { createdAt: "asc" },
    include: { findings: { select: { id: true } } },
  });

  return Promise.all(
    policies.map(async (p) => {
      const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(p.id);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        regulation: p.regulation as DataDiscoveryRegulation,
        targetPaths: JSON.parse(p.targetPaths) as string[],
        enabled: p.enabled,
        assignedAgentCount: assignedAgentIds.length,
        filesWithFindingsCount: p.findings.length,
        createdAt: p.createdAt.toISOString(),
      };
    }),
  );
}

export async function getPolicy(id: string) {
  const policy = await prisma.dataDiscoveryPolicy.findUnique({ where: { id }, include: { findings: { select: { id: true } } } });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(id);
  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    regulation: policy.regulation as DataDiscoveryRegulation,
    targetPaths: JSON.parse(policy.targetPaths) as string[],
    enabled: policy.enabled,
    assignedAgentCount: assignedAgentIds.length,
    filesWithFindingsCount: policy.findings.length,
    createdAt: policy.createdAt.toISOString(),
  };
}

export async function updatePolicy(id: string, params: UpdateDataDiscoveryPolicyRequest) {
  await prisma.dataDiscoveryPolicy.update({
    where: { id },
    data: {
      name: params.name,
      description: params.description,
      regulation: params.regulation,
      targetPaths: params.targetPaths ? JSON.stringify(params.targetPaths) : undefined,
      enabled: params.enabled,
    },
  });
  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  try {
    await prisma.dataDiscoveryPolicy.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function assignPolicy(policyId: string, params: AssignDataDiscoveryPolicyRequest) {
  await prisma.dataDiscoveryPolicyAssignment.createMany({
    data: [
      ...params.agentIds.map((agentId) => ({ policyId, agentId })),
      ...params.groupIds.map((groupId) => ({ policyId, groupId })),
    ],
  });
  return getPolicy(policyId);
}

export async function listAssignments(policyId: string) {
  const assignments = await prisma.dataDiscoveryPolicyAssignment.findMany({
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
  const result = await prisma.dataDiscoveryPolicyAssignment.deleteMany({ where: { id: assignmentId, policyId } });
  return result.count > 0;
}

// Delivered to the agent via the next checkin response (same mechanism as
// CommandTask/PatchTask dispatch) rather than any new push channel — the agent
// already polls every ~30s, so this reaches it far sooner than the 12-hour interval
// scan would on its own. Scoped to one agentId when given, otherwise every agent
// currently assigned the policy.
export async function requestScanNow(policyId: string, agentId?: string) {
  const policy = await prisma.dataDiscoveryPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(policyId);
  const targetAgentIds = agentId ? assignedAgentIds.filter((id) => id === agentId) : assignedAgentIds;

  for (const id of targetAgentIds) {
    await prisma.dataDiscoveryScanState.upsert({
      where: { agentId_policyId: { agentId: id, policyId } },
      create: { agentId: id, policyId, scanRequested: true },
      update: { scanRequested: true },
    });
  }

  return { requestedCount: targetAgentIds.length };
}

export async function getPolicyAgentBreakdown(policyId: string) {
  const policy = await prisma.dataDiscoveryPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(policyId);
  const agents = assignedAgentIds.length > 0 ? await prisma.agent.findMany({ where: { id: { in: assignedAgentIds } } }) : [];
  const findings = await prisma.dataDiscoveryFinding.findMany({ where: { policyId } });
  const scanStates = await prisma.dataDiscoveryScanState.findMany({ where: { policyId } });

  const findingsByAgent = new Map<string, typeof findings>();
  for (const f of findings) {
    const list = findingsByAgent.get(f.agentId) ?? [];
    list.push(f);
    findingsByAgent.set(f.agentId, list);
  }
  const scanStateByAgent = new Map(scanStates.map((s) => [s.agentId, s]));

  return {
    policyId,
    name: policy.name,
    agents: agents.map((a) => {
      const agentFindings = findingsByAgent.get(a.id) ?? [];
      const scanState = scanStateByAgent.get(a.id);
      return {
        agentId: a.id,
        hostname: a.hostname,
        scanned: scanState?.lastScannedAt != null,
        scanPending: scanState?.scanRequested ?? false,
        fileCount: agentFindings.length,
        lastScanAt: scanState?.lastScannedAt?.toISOString() ?? null,
      };
    }),
  };
}

export async function getFindingsForAgent(agentId: string) {
  const findings = await prisma.dataDiscoveryFinding.findMany({
    where: { agentId },
    include: { policy: true },
    orderBy: [{ lastSeenAt: "desc" }],
  });

  return findings.map((f) => {
    const matchedPatternKeys = JSON.parse(f.matchedPatternKeys) as string[];
    const matchCounts = JSON.parse(f.matchCounts) as Record<string, number>;
    const maskedSamples = JSON.parse(f.maskedSamples) as Record<string, string[]>;
    return {
      id: f.id,
      policyId: f.policyId,
      policyName: f.policy.name,
      filePath: f.filePath,
      fileSizeBytes: f.fileSizeBytes.toString(),
      fileModifiedAt: f.fileModifiedAt.toISOString(),
      matches: matchedPatternKeys.map((k) => ({
        label: getPiiPatternLabel(k),
        count: matchCounts[k] ?? 0,
        samples: maskedSamples[k] ?? [],
      })),
      detectedAt: f.detectedAt.toISOString(),
      lastSeenAt: f.lastSeenAt.toISOString(),
    };
  });
}
