import type {
  AssignZeroTrustPolicyRequest,
  CreateZeroTrustConditionRequest,
  CreateZeroTrustPolicyRequest,
  SecurityRuleOperator,
  UpdateZeroTrustConditionRequest,
  UpdateZeroTrustPolicyRequest,
} from "@em/shared";
import { prisma } from "../db";
import { resolveTargetAgentIds } from "./agentTargeting.service";
import { excludeOverriddenFailures, getOverriddenKeysByAgent } from "./zeroTrustOverride.service";

async function resolveAssignedAgentIdsForPolicy(policyId: string): Promise<string[]> {
  const assignments = await prisma.zeroTrustPolicyAssignment.findMany({ where: { policyId } });
  const agentIds = assignments.filter((a) => a.agentId).map((a) => a.agentId!);
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  return resolveTargetAgentIds(agentIds, groupIds);
}

export async function createPolicy(params: CreateZeroTrustPolicyRequest, createdByAdminId: string) {
  const policy = await prisma.zeroTrustPolicy.create({
    data: { name: params.name, description: params.description ?? null, enabled: params.enabled, createdByAdminId },
  });
  return getPolicy(policy.id);
}

export async function listPolicies() {
  const policies = await prisma.zeroTrustPolicy.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      conditions: { select: { id: true } },
      // Only enabled conditions' findings count toward the compliance figure —
      // a disabled condition's stale finding shouldn't drag the number down.
      findings: { where: { condition: { enabled: true } }, select: { agentId: true, status: true, condition: { select: { conditionKey: true } } } },
    },
  });

  const allAgentIds = [...new Set(policies.flatMap((p) => p.findings.map((f) => f.agentId)))];
  const overriddenByAgent = await getOverriddenKeysByAgent(allAgentIds);

  return Promise.all(
    policies.map(async (p) => {
      const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(p.id);
      const findings = excludeOverriddenFailures(
        p.findings.map((f) => ({ agentId: f.agentId, status: f.status, conditionKey: f.condition.conditionKey })),
        overriddenByAgent,
      );
      const passCount = findings.filter((f) => f.status === "PASS").length;
      const gradedCount = findings.filter((f) => f.status === "PASS" || f.status === "FAIL").length;
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        enabled: p.enabled,
        conditionCount: p.conditions.length,
        assignedAgentCount: assignedAgentIds.length,
        compliancePercent: gradedCount > 0 ? Math.round((passCount / gradedCount) * 100) : null,
        createdAt: p.createdAt.toISOString(),
      };
    }),
  );
}

export async function getPolicy(id: string) {
  const policy = await prisma.zeroTrustPolicy.findUnique({
    where: { id },
    include: { conditions: { orderBy: { conditionKey: "asc" } } },
  });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(id);
  const findings = await prisma.zeroTrustFinding.findMany({ where: { policyId: id } });
  const conditionKeyById = new Map(policy.conditions.map((c) => [c.id, c.conditionKey]));
  const overriddenByAgent = await getOverriddenKeysByAgent([...new Set(findings.map((f) => f.agentId))]);

  const findingsByCondition = new Map<string, { pass: number; fail: number; error: number }>();
  for (const f of findings) {
    // A FAIL with an active override for its own conditionKey stops counting against this
    // condition's tally — the row itself (and its real actualValue) isn't touched.
    if (f.status === "FAIL" && overriddenByAgent.get(f.agentId)?.has(conditionKeyById.get(f.conditionId) ?? "")) continue;
    const bucket = findingsByCondition.get(f.conditionId) ?? { pass: 0, fail: 0, error: 0 };
    if (f.status === "PASS") bucket.pass++;
    else if (f.status === "ERROR") bucket.error++;
    else bucket.fail++;
    findingsByCondition.set(f.conditionId, bucket);
  }

  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    enabled: policy.enabled,
    assignedAgentCount: assignedAgentIds.length,
    createdAt: policy.createdAt.toISOString(),
    conditions: policy.conditions.map((c) => {
      const bucket = findingsByCondition.get(c.id);
      return {
        id: c.id,
        conditionKey: c.conditionKey,
        title: c.title,
        description: c.description,
        checkPowerShell: c.checkPowerShell,
        operator: c.operator as SecurityRuleOperator,
        expectedValue: c.expectedValue,
        enabled: c.enabled,
        passCount: bucket?.pass ?? 0,
        failCount: bucket?.fail ?? 0,
        errorCount: bucket?.error ?? 0,
      };
    }),
  };
}

export async function updatePolicy(id: string, params: UpdateZeroTrustPolicyRequest) {
  await prisma.zeroTrustPolicy.update({
    where: { id },
    data: { name: params.name, description: params.description, enabled: params.enabled },
  });
  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  try {
    await prisma.zeroTrustPolicy.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function addCondition(policyId: string, params: CreateZeroTrustConditionRequest) {
  await prisma.zeroTrustCondition.create({
    data: {
      policyId,
      conditionKey: params.conditionKey,
      title: params.title,
      description: params.description ?? null,
      checkPowerShell: params.checkPowerShell,
      operator: params.operator,
      expectedValue: params.expectedValue,
      enabled: params.enabled,
    },
  });
  return getPolicy(policyId);
}

export async function updateCondition(policyId: string, conditionId: string, params: UpdateZeroTrustConditionRequest) {
  await prisma.zeroTrustCondition.update({
    where: { id: conditionId },
    data: {
      conditionKey: params.conditionKey,
      title: params.title,
      description: params.description,
      checkPowerShell: params.checkPowerShell,
      operator: params.operator,
      expectedValue: params.expectedValue,
      enabled: params.enabled,
    },
  });
  return getPolicy(policyId);
}

export async function deleteCondition(policyId: string, conditionId: string): Promise<boolean> {
  const result = await prisma.zeroTrustCondition.deleteMany({ where: { id: conditionId, policyId } });
  return result.count > 0;
}

export async function assignPolicy(policyId: string, params: AssignZeroTrustPolicyRequest) {
  await prisma.zeroTrustPolicyAssignment.createMany({
    data: [
      ...params.agentIds.map((agentId) => ({ policyId, agentId })),
      ...params.groupIds.map((groupId) => ({ policyId, groupId })),
    ],
  });
  return getPolicy(policyId);
}

export async function listAssignments(policyId: string) {
  const assignments = await prisma.zeroTrustPolicyAssignment.findMany({
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
  const result = await prisma.zeroTrustPolicyAssignment.deleteMany({ where: { id: assignmentId, policyId } });
  return result.count > 0;
}

export async function getPolicyAgentBreakdown(policyId: string) {
  const policy = await prisma.zeroTrustPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(policyId);
  const agents = assignedAgentIds.length > 0 ? await prisma.agent.findMany({ where: { id: { in: assignedAgentIds } } }) : [];
  // Only enabled conditions' findings count toward pass/fail/trust — a disabled
  // condition is excluded from evaluation entirely, not just informationally hidden.
  const findings = await prisma.zeroTrustFinding.findMany({
    where: { policyId, condition: { enabled: true } },
    include: { condition: { select: { conditionKey: true } } },
  });
  const overriddenByAgent = await getOverriddenKeysByAgent([...new Set(findings.map((f) => f.agentId))]);

  const findingsByAgent = new Map<string, typeof findings>();
  for (const f of findings) {
    const list = findingsByAgent.get(f.agentId) ?? [];
    list.push(f);
    findingsByAgent.set(f.agentId, list);
  }

  const conditions = await prisma.zeroTrustCondition.findMany({
    where: { policyId, enabled: true },
    select: { id: true, conditionKey: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  const conditionCount = conditions.length;

  return {
    policyId,
    name: policy.name,
    // Enabled conditions only, so the console can show per-condition non-compliance.
    conditions,
    agents: agents.map((a) => {
      // Kept as the FULL raw list (including any overridden-fail rows) for `scanned`/
      // completeness below — an override suppresses a failure from counting against
      // trust, it doesn't make the condition un-scanned.
      const agentFindings = findingsByAgent.get(a.id) ?? [];
      const overriddenKeys = overriddenByAgent.get(a.id);
      const failCount = agentFindings.filter((f) => f.status === "FAIL" && !overriddenKeys?.has(f.condition.conditionKey)).length;
      const errorCount = agentFindings.filter((f) => f.status === "ERROR").length;
      return {
        agentId: a.id,
        hostname: a.hostname,
        scanned: agentFindings.length > 0,
        passCount: agentFindings.filter((f) => f.status === "PASS").length,
        failCount,
        errorCount,
        // Conditions this endpoint currently fails (an overridden failure doesn't count,
        // same as failCount) or errored on — what the per-condition tiles count.
        nonCompliantConditionIds: agentFindings
          .filter(
            (f) => (f.status === "FAIL" && !overriddenKeys?.has(f.condition.conditionKey)) || f.status === "ERROR",
          )
          .map((f) => f.conditionId),
        // A device is trusted only once every condition in the policy has actually
        // been scanned and passed — unscanned/ERRORed conditions must not silently
        // read as trusted.
        trusted: agentFindings.length > 0 && agentFindings.length >= conditionCount && failCount === 0 && errorCount === 0,
      };
    }),
  };
}

// Fleet-wide trust, for the Dashboard — reuses getPolicyAgentBreakdown's real trust
// predicate per enabled policy rather than re-deriving it (avoids the two ever drifting
// apart). An agent assigned to multiple policies must pass every one of them to count as
// trusted; an agent assigned to zero enabled policies is "not assessed", not silently
// bucketed into either trusted or not-trusted.
export async function getFleetTrustSummary(): Promise<{ trusted: number; notTrusted: number; notAssigned: number }> {
  const policies = await prisma.zeroTrustPolicy.findMany({ where: { enabled: true }, select: { id: true } });

  const perAgentTrustFlags = new Map<string, boolean[]>();
  for (const policy of policies) {
    const breakdown = await getPolicyAgentBreakdown(policy.id);
    if (!breakdown) continue;
    for (const row of breakdown.agents) {
      const flags = perAgentTrustFlags.get(row.agentId) ?? [];
      flags.push(row.trusted);
      perAgentTrustFlags.set(row.agentId, flags);
    }
  }

  const totalAgents = await prisma.agent.count();
  let trusted = 0;
  let notTrusted = 0;
  for (const flags of perAgentTrustFlags.values()) {
    if (flags.every(Boolean)) trusted++;
    else notTrusted++;
  }

  return { trusted, notTrusted, notAssigned: totalAgents - perAgentTrustFlags.size };
}

export async function getFindingsForAgent(agentId: string) {
  const findings = await prisma.zeroTrustFinding.findMany({
    where: { agentId, condition: { enabled: true } },
    include: { condition: true, policy: true },
    orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
  });

  return findings.map((f) => ({
    id: f.id,
    policyId: f.policyId,
    policyName: f.policy.name,
    conditionId: f.conditionId,
    conditionKey: f.condition.conditionKey,
    title: f.condition.title,
    expectedValue: f.condition.expectedValue,
    actualValue: f.actualValue,
    status: f.status as "PASS" | "FAIL" | "ERROR",
    lastSeenAt: f.lastSeenAt.toISOString(),
  }));
}
