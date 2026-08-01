import type { AssignedDlpPolicyWire, DlpEnforcementMode, DlpEventBatchPayload, DlpRuleType } from "@em/shared";
import { prisma } from "../db";
import { isPolicyExcepted } from "./policyAccessException.service";

export async function resolveAssignedPoliciesForAgent(agentId: string): Promise<AssignedDlpPolicyWire[]> {
  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);

  const assignments = await prisma.dlpPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const candidatePolicyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (candidatePolicyIds.length === 0) return [];

  const excepted = await Promise.all(candidatePolicyIds.map((id) => isPolicyExcepted("DLP", id, agentId)));
  const policyIds = candidatePolicyIds.filter((_, i) => !excepted[i]);
  if (policyIds.length === 0) return [];

  const policies = await prisma.dlpPolicy.findMany({
    where: { id: { in: policyIds }, enabled: true },
    include: { rules: true },
  });

  return policies.map((p) => ({
    policyId: p.id,
    enforcementMode: p.enforcementMode as DlpEnforcementMode,
    removableMediaOnly: p.removableMediaOnly,
    rules: p.rules.map((r) => ({ ruleId: r.id, ruleType: r.ruleType as DlpRuleType, value: r.value })),
  }));
}

// Plain inserts, not upserts — each event is a distinct real-time occurrence (a rule
// matched), not a current-state row like a Data Discovery finding. The agent never
// inspects file content itself; whatever produced this payload (Phase 2's native
// sidecar) already did the matching and masking.
export async function recordEvents(agentId: string, payload: DlpEventBatchPayload): Promise<void> {
  if (payload.events.length === 0) return;

  const policyIds = [...new Set(payload.events.map((e) => e.policyId))];
  const validPolicyIds = new Set((await prisma.dlpPolicy.findMany({ where: { id: { in: policyIds } }, select: { id: true } })).map((p) => p.id));

  await prisma.dlpEvent.createMany({
    data: payload.events
      .filter((e) => validPolicyIds.has(e.policyId)) // policy deleted out from under an in-flight event — drop, don't fail the batch
      .map((e) => ({
        agentId,
        policyId: e.policyId,
        filePath: e.filePath,
        processName: e.processName,
        destinationIsRemovable: e.destinationIsRemovable,
        action: e.action,
        matchedRuleIds: JSON.stringify(e.matchedRuleIds),
        maskedSamples: JSON.stringify(e.maskedSamples),
        occurredAt: new Date(e.occurredAt),
      })),
  });
}
