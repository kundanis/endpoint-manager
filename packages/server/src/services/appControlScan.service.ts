import type { AppControlRuleType, AppControlRuleWire, AppControlScanResultPayload } from "@em/shared";
import { prisma } from "../db";
import { isPolicyExcepted } from "./policyAccessException.service";
import { isAgentPaused } from "./pause.service";

// Flat, deduped by (ruleType, value) across every enabled, non-excepted policy assigned to
// this agent — two different policies both blocking "utorrent.exe" should still only
// produce ONE SRP registry entry, not two colliding writes.
export async function resolveAssignedRulesForAgent(agentId: string): Promise<AppControlRuleWire[]> {
  if (await isAgentPaused(agentId)) return [];

  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);

  const assignments = await prisma.appControlPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const candidatePolicyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (candidatePolicyIds.length === 0) return [];

  const excepted = await Promise.all(candidatePolicyIds.map((id) => isPolicyExcepted("APP_CONTROL", id, agentId)));
  const policyIds = candidatePolicyIds.filter((_, i) => !excepted[i]);
  if (policyIds.length === 0) return [];

  const policies = await prisma.appControlPolicy.findMany({
    where: { id: { in: policyIds }, enabled: true },
    include: { rules: true },
  });

  const seen = new Set<string>();
  const rules: AppControlRuleWire[] = [];
  for (const p of policies) {
    for (const r of p.rules) {
      const key = `${r.ruleType}:${r.value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push({ ruleId: r.id, ruleType: r.ruleType as AppControlRuleType, value: r.value });
    }
  }
  return rules;
}

// status/errorMessage from the scan cycle aren't persisted anywhere for this module today
// (no per-assignment health-check row like WebBlockPolicyAssignment) — fresh AppControlEvent
// rows and the policy's assignedAgentCount are the observable signal for now.
export async function recordScanResult(agentId: string, payload: AppControlScanResultPayload): Promise<void> {
  if (payload.events.length === 0) return;

  // Resolve each event's ruleId to its CURRENT policyId at ingestion time (the agent
  // doesn't carry policyId itself) — if the rule's since been deleted, policyId is left
  // null rather than failing the batch.
  const ruleIds = [...new Set(payload.events.map((e) => e.ruleId).filter((id): id is string => Boolean(id)))];
  const rules =
    ruleIds.length > 0
      ? await prisma.appControlRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, policyId: true } })
      : [];
  const policyIdByRuleId = new Map(rules.map((r) => [r.id, r.policyId]));

  await prisma.appControlEvent.createMany({
    data: payload.events.map((e) => ({
      agentId,
      policyId: e.ruleId ? (policyIdByRuleId.get(e.ruleId) ?? null) : null,
      ruleId: e.ruleId,
      matchedPath: e.matchedPath,
      processName: e.processName,
      occurredAt: new Date(e.occurredAt),
    })),
  });
}
