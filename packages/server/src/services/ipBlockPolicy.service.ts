import type {
  AssignIpBlockPolicyRequest,
  CreateIpBlockPolicyRequest,
  CreateIpBlockRuleRequest,
  IpBlockRuleType,
  UpdateIpBlockPolicyRequest,
  UpdateIpBlockRuleRequest,
} from "@em/shared";
import { prisma } from "../db";
import { resolveTargetAgentIds } from "./agentTargeting.service";

async function resolveAssignedAgentIdsForPolicy(policyId: string): Promise<string[]> {
  const assignments = await prisma.ipBlockPolicyAssignment.findMany({ where: { policyId } });
  const agentIds = assignments.filter((a) => a.agentId).map((a) => a.agentId!);
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  return resolveTargetAgentIds(agentIds, groupIds);
}

export async function createPolicy(params: CreateIpBlockPolicyRequest, createdByAdminId: string) {
  const policy = await prisma.ipBlockPolicy.create({
    data: { name: params.name, description: params.description ?? null, enabled: params.enabled, createdByAdminId },
  });
  return getPolicy(policy.id);
}

export async function listPolicies() {
  const policies = await prisma.ipBlockPolicy.findMany({
    orderBy: { createdAt: "asc" },
    include: { rules: { select: { id: true } } },
  });

  return Promise.all(
    policies.map(async (p) => {
      const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(p.id);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        enabled: p.enabled,
        ruleCount: p.rules.length,
        assignedAgentCount: assignedAgentIds.length,
        createdAt: p.createdAt.toISOString(),
      };
    }),
  );
}

export async function getPolicy(id: string) {
  const policy = await prisma.ipBlockPolicy.findUnique({
    where: { id },
    include: { rules: { orderBy: { createdAt: "asc" } } },
  });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(id);
  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    enabled: policy.enabled,
    ruleCount: policy.rules.length,
    assignedAgentCount: assignedAgentIds.length,
    createdAt: policy.createdAt.toISOString(),
    rules: policy.rules.map((r) => ({
      id: r.id,
      ruleType: r.ruleType as IpBlockRuleType,
      value: r.value,
      label: r.label,
    })),
  };
}

export async function updatePolicy(id: string, params: UpdateIpBlockPolicyRequest) {
  await prisma.ipBlockPolicy.update({
    where: { id },
    data: { name: params.name, description: params.description, enabled: params.enabled },
  });
  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  try {
    await prisma.ipBlockPolicy.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function addRule(policyId: string, params: CreateIpBlockRuleRequest) {
  await prisma.ipBlockRule.create({
    data: { policyId, ruleType: params.ruleType, value: params.value, label: params.label ?? null },
  });
  return getPolicy(policyId);
}

export async function updateRule(policyId: string, ruleId: string, params: UpdateIpBlockRuleRequest) {
  await prisma.ipBlockRule.update({
    where: { id: ruleId },
    data: { ruleType: params.ruleType, value: params.value, label: params.label },
  });
  return getPolicy(policyId);
}

export async function deleteRule(policyId: string, ruleId: string): Promise<boolean> {
  const result = await prisma.ipBlockRule.deleteMany({ where: { id: ruleId, policyId } });
  return result.count > 0;
}

export async function assignPolicy(policyId: string, params: AssignIpBlockPolicyRequest) {
  await prisma.ipBlockPolicyAssignment.createMany({
    data: [
      ...params.agentIds.map((agentId) => ({ policyId, agentId })),
      ...params.groupIds.map((groupId) => ({ policyId, groupId })),
    ],
  });
  return getPolicy(policyId);
}

export async function listAssignments(policyId: string) {
  const assignments = await prisma.ipBlockPolicyAssignment.findMany({
    where: { policyId },
    include: { agent: true, group: true },
  });
  return assignments.map((a) => ({
    id: a.id,
    agentId: a.agentId,
    hostname: a.agent?.hostname ?? null,
    groupId: a.groupId,
    groupName: a.group?.name ?? null,
    lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
    lastSyncStatus: a.lastSyncStatus,
    lastSyncError: a.lastSyncError,
  }));
}

export async function unassign(policyId: string, assignmentId: string): Promise<boolean> {
  const result = await prisma.ipBlockPolicyAssignment.deleteMany({ where: { id: assignmentId, policyId } });
  return result.count > 0;
}

// Resolves each assigned agent's most relevant assignment row (a direct assignment takes
// precedence over one inherited via a group) purely to surface its own lastSyncedAt/Status/
// Error — there is no event stream for this module, same reasoning as Web Block.
export async function getPolicyAgentBreakdown(policyId: string) {
  const policy = await prisma.ipBlockPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;

  const assignments = await prisma.ipBlockPolicyAssignment.findMany({ where: { policyId } });
  const directAgentIds = assignments.filter((a) => a.agentId).map((a) => a.agentId!);
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  const memberships =
    groupIds.length > 0
      ? await prisma.agentGroupMembership.findMany({ where: { groupId: { in: groupIds } }, select: { agentId: true, groupId: true } })
      : [];

  const agentIds = [...new Set([...directAgentIds, ...memberships.map((m) => m.agentId)])];
  if (agentIds.length === 0) return { policyId, name: policy.name, agents: [] };

  const agents = await prisma.agent.findMany({ where: { id: { in: agentIds } } });

  function assignmentForAgent(agentId: string) {
    const direct = assignments.find((a) => a.agentId === agentId);
    if (direct) return direct;
    const membership = memberships.find((m) => m.agentId === agentId);
    return membership ? (assignments.find((a) => a.groupId === membership.groupId) ?? null) : null;
  }

  return {
    policyId,
    name: policy.name,
    agents: agents.map((a) => {
      const assignment = assignmentForAgent(a.id);
      return {
        agentId: a.id,
        hostname: a.hostname,
        lastSyncedAt: assignment?.lastSyncedAt?.toISOString() ?? null,
        lastSyncStatus: assignment?.lastSyncStatus ?? null,
        lastSyncError: assignment?.lastSyncError ?? null,
      };
    }),
  };
}
