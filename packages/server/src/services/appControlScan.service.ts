import type { AppControlRuleType, AppControlRuleWire, AppControlScanResultPayload } from "@em/shared";
import { prisma } from "../db";
import { isPolicyExcepted } from "./policyAccessException.service";
import { isAgentPaused } from "./pause.service";

// The policies this agent enforces: assigned directly or via a group, enabled, not excepted for
// it, and none while the agent is paused.
async function activePolicyIdsForAgent(agentId: string): Promise<{ policyIds: string[]; groupIds: string[] }> {
  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);
  if (await isAgentPaused(agentId)) return { policyIds: [], groupIds };

  const assignments = await prisma.appControlPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const candidatePolicyIds = [...new Set(assignments.map((a) => a.policyId))];
  const excepted = await Promise.all(candidatePolicyIds.map((id) => isPolicyExcepted("APP_CONTROL", id, agentId)));
  const notExcepted = candidatePolicyIds.filter((_, i) => !excepted[i]);
  if (notExcepted.length === 0) return { policyIds: [], groupIds };

  const enabled = await prisma.appControlPolicy.findMany({ where: { id: { in: notExcepted }, enabled: true }, select: { id: true } });
  return { policyIds: enabled.map((p) => p.id), groupIds };
}

// Flat, deduped by (ruleType, value) across every policy this agent enforces — two policies
// both blocking "utorrent.exe" still produce one rule on the endpoint.
export async function resolveAssignedRulesForAgent(agentId: string): Promise<AppControlRuleWire[]> {
  const { policyIds } = await activePolicyIdsForAgent(agentId);
  if (policyIds.length === 0) return [];

  const policies = await prisma.appControlPolicy.findMany({
    where: { id: { in: policyIds } },
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

// Every sync stamps the endpoint's assignment rows (Sync status tab; the agent says APPLIED,
// stored as SUCCESS like the other blocking modules), then stores any blocked programs (Activity).
export async function recordScanResult(agentId: string, payload: AppControlScanResultPayload): Promise<void> {
  const { policyIds, groupIds } = await activePolicyIdsForAgent(agentId);
  if (policyIds.length > 0) {
    await prisma.appControlPolicyAssignment.updateMany({
      where: { policyId: { in: policyIds }, OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: payload.status === "APPLIED" ? "SUCCESS" : "FAILED",
        lastSyncError: payload.errorMessage?.slice(0, 1000) ?? null,
      },
    });
  }
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
