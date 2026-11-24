import { commandProtection } from "@em/shared";
import type {
  AssignCommandBlockPolicyRequest,
  CommandBlockRuleType,
  CreateCommandBlockPolicyRequest,
  CreateCommandBlockRuleRequest,
  UpdateCommandBlockPolicyRequest,
  UpdateCommandBlockRuleRequest,
} from "@em/shared";
import { commandBlockRuleProblem } from "@em/shared";
import { prisma } from "../db";
import { assertAssignable } from "./policyExclusivity.service";
import { newAssignmentTargets } from "../utils/assignments";
import { resolveTargetAgentIds } from "./agentTargeting.service";
import { membershipsUnderGroups } from "./groupTree.service";

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
      enforcementMode: "BLOCK", // protections are always enforced
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

export class UnsafeRuleError extends Error {}

// Only protections from the catalogue can be added (no custom commands); see @em/shared
// commandProtections.ts and endpointSafety.
function assertSafe(ruleType: string, value: string) {
  if (ruleType !== "PROTECTION") throw new UnsafeRuleError("Custom commands can't be added. Choose protections from the list.");
  const problem = commandBlockRuleProblem(ruleType, value);
  if (problem) throw new UnsafeRuleError(problem);
}

export async function addRule(policyId: string, params: CreateCommandBlockRuleRequest) {
  assertSafe(params.ruleType, params.value);
  const existing = await prisma.commandBlockRule.findFirst({ where: { policyId, ruleType: params.ruleType, value: params.value } });
  if (existing) return getPolicy(policyId); // already ticked
  await prisma.commandBlockRule.create({
    data: { policyId, ruleType: params.ruleType, value: params.value, label: params.label ?? null },
  });
  return getPolicy(policyId);
}

export async function updateRule(policyId: string, ruleId: string, params: UpdateCommandBlockRuleRequest) {
  if (params.value !== undefined || params.ruleType !== undefined) {
    const current = await prisma.commandBlockRule.findUnique({ where: { id: ruleId } });
    if (current) assertSafe(params.ruleType ?? current.ruleType, params.value ?? current.value);
  }
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
  // Only targets not already assigned - repeat assignments used to add duplicate rows.
  const existing = await prisma.commandBlockPolicyAssignment.findMany({ where: { policyId }, select: { agentId: true, groupId: true } });
  const fresh = newAssignmentTargets(existing, params.agentIds, params.groupIds);
  // One COMMAND_BLOCK policy per endpoint (policyExclusivity.service.ts).
  await assertAssignable("COMMAND_BLOCK", policyId, fresh.agentIds, fresh.groupIds);
  if (fresh.agentIds.length + fresh.groupIds.length > 0) {
    await prisma.commandBlockPolicyAssignment.createMany({
      data: [
        ...fresh.agentIds.map((agentId) => ({ policyId, agentId })),
        ...fresh.groupIds.map((groupId) => ({ policyId, groupId })),
      ],
    });
  }
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
  const agents =
    assignedAgentIds.length > 0
      ? await prisma.agent.findMany({ where: { id: { in: assignedAgentIds } }, include: { inventory: { select: { lastLoggedOnUser: true } } } })
      : [];
  // Each endpoint's own assignment row (a direct one wins over one via a group) holds its sync status.
  const assignments = await prisma.commandBlockPolicyAssignment.findMany({ where: { policyId }, include: { group: true } });
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  const memberships =
    groupIds.length > 0 && assignedAgentIds.length > 0
      ? await membershipsUnderGroups(groupIds, assignedAgentIds)
      : [];
  const assignmentForAgent = (agentId: string) =>
    assignments.find((a) => a.agentId === agentId) ??
    assignments.find((a) => a.groupId && memberships.some((m) => m.agentId === agentId && m.groupId === a.groupId)) ??
    null;
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
      const assignment = assignmentForAgent(a.id);
      return {
        agentId: a.id,
        hostname: a.hostname,
        groupName: assignment?.group?.name ?? null,
        lastLoggedOnUser: a.inventory?.lastLoggedOnUser ?? null,
        lastSyncedAt: assignment?.lastSyncedAt?.toISOString() ?? null,
        lastSyncStatus: assignment?.lastSyncStatus ?? null,
        lastSyncError: assignment?.lastSyncError ?? null,
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
      ruleLabel: rule?.label || (rule?.ruleType === "PROTECTION" ? commandProtection(rule.value)?.title : rule?.value) || "(deleted rule)",
      matchedCommandLine: e.matchedCommandLine,
      processName: e.processName,
      action: e.action,
      occurredAt: e.occurredAt.toISOString(),
    };
  });
}

// Events tab: one endpoint's matched commands under this policy, newest first, with the rule
// that matched (described by its last-known value if it has since been deleted).
export async function getPolicyEventsForAgent(policyId: string, agentId: string) {
  const events = await prisma.commandBlockEvent.findMany({ where: { policyId, agentId }, orderBy: { occurredAt: "desc" }, take: 500 });
  const ruleIds = [...new Set(events.map((e) => e.ruleId))];
  const rules = ruleIds.length > 0 ? await prisma.commandBlockRule.findMany({ where: { id: { in: ruleIds } } }) : [];
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  return events.map((e) => {
    const rule = ruleById.get(e.ruleId);
    return {
      id: e.id,
      occurredAt: e.occurredAt.toISOString(),
      ruleType: rule?.ruleType ?? null,
      ruleValue: rule?.value ?? null,
      ruleLabel: rule?.label ?? null,
      ruleDeleted: !rule,
      matchedCommandLine: e.matchedCommandLine,
      processName: e.processName,
      action: e.action,
    };
  });
}
