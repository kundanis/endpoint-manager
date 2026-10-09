import type { AssignedZeroTrustPolicyWire, SecurityRuleOperator, ZeroTrustScanResultPayload } from "@em/shared";
import { prisma } from "../db";
import { evaluateRule } from "./securityConfigEvaluate.util";
import { isAgentPaused } from "./pause.service";

export async function resolveAssignedPoliciesForAgent(agentId: string): Promise<AssignedZeroTrustPolicyWire[]> {
  // Agent.paused (a whole endpoint being held back from management), not to be confused
  // with a policy's own `enabled: false` below.
  if (await isAgentPaused(agentId)) return [];

  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);

  const assignments = await prisma.zeroTrustPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const policyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (policyIds.length === 0) return [];

  // A paused policy (enabled: false) is skipped entirely — the agent doesn't even
  // fetch its conditions, let alone check them. Within an active policy, individual
  // disabled conditions are likewise excluded from what gets sent to check.
  const policies = await prisma.zeroTrustPolicy.findMany({
    where: { id: { in: policyIds }, enabled: true },
    include: { conditions: { where: { enabled: true } } },
  });

  return policies.map((p) => ({
    policyId: p.id,
    conditions: p.conditions.map((c) => ({ conditionId: c.id, checkPowerShell: c.checkPowerShell })),
  }));
}

// Grading happens here, server-side, same reasoning as securityConfigScan.service.ts —
// reuses the exact same evaluateRule util since the operator vocabulary is shared.
export async function recordScanResult(agentId: string, payload: ZeroTrustScanResultPayload): Promise<void> {
  const conditions = await prisma.zeroTrustCondition.findMany({
    where: { id: { in: payload.results.map((r) => r.conditionId) } },
  });
  const conditionById = new Map(conditions.map((c) => [c.id, c]));

  for (const result of payload.results) {
    const condition = conditionById.get(result.conditionId);
    if (!condition) continue; // condition deleted/policy changed out from under an in-flight scan

    const status = result.error
      ? "ERROR"
      : evaluateRule(condition.operator as SecurityRuleOperator, condition.expectedValue, result.actualValue);

    await prisma.zeroTrustFinding.upsert({
      where: { agentId_conditionId: { agentId, conditionId: result.conditionId } },
      create: { agentId, policyId: payload.policyId, conditionId: result.conditionId, actualValue: result.actualValue, status },
      update: { actualValue: result.actualValue, status, lastSeenAt: new Date() },
    });
  }
}
