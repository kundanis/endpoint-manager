import type {
  AssignCommandBlockPolicyRequest,
  CommandBlockRuleType,
  CreateCommandBlockPolicyRequest,
  CreateCommandBlockRuleRequest,
  UpdateCommandBlockPolicyRequest,
  UpdateCommandBlockRuleRequest,
} from "@em/shared";
import { prisma } from "../db";
import { resolveTargetAgentIds } from "./agentTargeting.service";

async function resolveAssignedAgentIdsForPolicy(policyId: string): Promise<string[]> {
  const assignments = await prisma.commandBlockPolicyAssignment.findMany({ where: { policyId } });
  const agentIds = assignments.filter((a) => a.agentId).map((a) => a.agentId!);
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  return resolveTargetAgentIds(agentIds, groupIds);
}

export async function createPolicy(params: CreateCommandBlockPolicyRequest, createdByAdminId: string) {
  const policy = await prisma.commandBlockPolicy.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      enabled: params.enabled,
      enforcementMode: params.enforcementMode,
      createdByAdminId,
    },
  });
  return getPolicy(policy.id);
}

export async function listPolicies() {
  const policies = await prisma.commandBlockPolicy.findMany({
    orderBy: { createdAt: "asc" },
    include: { events: { select: { id: true } }, rules: { select: { id: true } } },
  });

  return Promise.all(
    policies.map(async (p) => {
      const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(p.id);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        enabled: p.enabled,
        enforcementMode: p.enforcementMode,
        ruleCount: p.rules.length,
        assignedAgentCount: assignedAgentIds.length,
        eventCount: p.events.length,
        createdAt: p.createdAt.toISOString(),
      };
    }),
  );
}

export async function getPolicy(id: string) {
  const policy = await prisma.commandBlockPolicy.findUnique({
    where: { id },
    include: { events: { select: { id: true } }, rules: { orderBy: { createdAt: "asc" } } },
  });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(id);
  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    enabled: policy.enabled,
    enforcementMode: policy.enforcementMode,
    ruleCount: policy.rules.length,
    assignedAgentCount: assignedAgentIds.length,
    eventCount: policy.events.length,
    createdAt: policy.createdAt.toISOString(),
    rules: policy.rules.map((r) => ({
      id: r.id,
      ruleType: r.ruleType as CommandBlockRuleType,
      value: r.value,
      label: r.label,
    })),
  };
}

export async function updatePolicy(id: string, params: UpdateCommandBlockPolicyRequest) {
  await prisma.commandBlockPolicy.update({
    where: { id },
    data: {
      name: params.name,
      description: params.description,
      enabled: params.enabled,
      enforcementMode: params.enforcementMode,
    },
  });
  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  try {
    await prisma.commandBlockPolicy.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function addRule(policyId: string, params: CreateCommandBlockRuleRequest) {
  await prisma.commandBlockRule.create({
    data: { policyId, ruleType: params.ruleType, value: params.value, label: params.label ?? null },
  });
  return getPolicy(policyId);
}

export async function updateRule(policyId: string, ruleId: string, params: UpdateCommandBlockRuleRequest) {
  await prisma.commandBlockRule.update({
    where: { id: ruleId },
    data: { ruleType: params.ruleType, value: params.value, label: params.label },
  });
  return getPolicy(policyId);
}

export async function deleteRule(policyId: string, ruleId: string): Promise<boolean> {
  const result = await prisma.commandBlockRule.deleteMany({ where: { id: ruleId, policyId } });
  return result.count > 0;
}

export async function assignPolicy(policyId: string, params: AssignCommandBlockPolicyRequest) {
  await prisma.commandBlockPolicyAssignment.createMany({
    data: [
      ...params.agentIds.map((agentId) => ({ policyId, agentId })),
      ...params.groupIds.map((groupId) => ({ policyId, groupId })),
    ],
  });
  return getPolicy(policyId);
}

export async function listAssignments(policyId: string) {
  const assignments = await prisma.commandBlockPolicyAssignment.findMany({
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
  const result = await prisma.commandBlockPolicyAssignment.deleteMany({ where: { id: assignmentId, policyId } });
  return result.count > 0;
}

export async function getPolicyAgentBreakdown(policyId: string) {
  const policy = await prisma.commandBlockPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(policyId);
  const agents = assignedAgentIds.length > 0 ? await prisma.agent.findMany({ where: { id: { in: assignedAgentIds } } }) : [];
  const events = await prisma.commandBlockEvent.findMany({ where: { policyId }, orderBy: { occurredAt: "desc" } });

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
        lastEventAt: agentEvents[0]?.occurredAt.toISOString() ?? null,
      };
    }),
  };
}

export async function getEventsForAgent(agentId: string) {
  const events = await prisma.commandBlockEvent.findMany({
    where: { agentId },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });

  const ruleIds = [...new Set(events.map((e) => e.ruleId))];
  const rules = ruleIds.length > 0 ? await prisma.commandBlockRule.findMany({ where: { id: { in: ruleIds } } }) : [];
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  return events.map((e) => {
    const rule = ruleById.get(e.ruleId);
    return {
      id: e.id,
      // A rule can be deleted after it produced past events — describe it by its
      // last-known value rather than dropping the match from history.
      ruleLabel: rule?.label || rule?.value || "(deleted rule)",
      matchedCommandLine: e.matchedCommandLine,
      processName: e.processName,
      action: e.action,
      occurredAt: e.occurredAt.toISOString(),
    };
  });
}
