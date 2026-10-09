import type {
  AssignedCommandBlockResponse,
  CommandBlockEnforcementMode,
  CommandBlockEventBatchPayload,
  CommandBlockRuleType,
} from "@em/shared";
import { prisma } from "../db";
import { isPolicyExcepted } from "./policyAccessException.service";
import { isAgentPaused } from "./pause.service";

// Flat, deduped across every enabled, non-excepted policy assigned to this agent (directly
// or via a group) — each match is independently attributable to the rule that fired, so
// unlike webBlock's merged domain list, no per-policy nesting is needed here either.
export async function resolveAssignedRulesForAgent(agentId: string): Promise<AssignedCommandBlockResponse> {
  if (await isAgentPaused(agentId)) return { rules: [] };

  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);

  const assignments = await prisma.commandBlockPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const candidatePolicyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (candidatePolicyIds.length === 0) return { rules: [] };

  const excepted = await Promise.all(candidatePolicyIds.map((id) => isPolicyExcepted("COMMAND_BLOCK", id, agentId)));
  const policyIds = candidatePolicyIds.filter((_, i) => !excepted[i]);
  if (policyIds.length === 0) return { rules: [] };

  const policies = await prisma.commandBlockPolicy.findMany({
    where: { id: { in: policyIds }, enabled: true },
    include: { rules: true },
  });

  // Dedup by (ruleType, value) rather than value alone — an EXACT_COMMAND_LINE rule and a
  // COMMAND_PATTERN rule can legitimately share the same string with different match
  // semantics. If the same key appears in two assigned policies with different
  // enforcementMode, BLOCK always wins — a stricter policy's intent must never be silently
  // downgraded to alert-only just because a laxer policy happens to define the same pattern.
  const byKey = new Map<
    string,
    { ruleId: string; ruleType: CommandBlockRuleType; pattern: string; enforcementMode: CommandBlockEnforcementMode }
  >();
  for (const policy of policies) {
    const mode = policy.enforcementMode as CommandBlockEnforcementMode;
    for (const rule of policy.rules) {
      const key = `${rule.ruleType}:${rule.value.toLowerCase()}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ruleId: rule.id, ruleType: rule.ruleType as CommandBlockRuleType, pattern: rule.value, enforcementMode: mode });
      } else if (mode === "BLOCK") {
        existing.enforcementMode = "BLOCK";
      }
    }
  }

  return { rules: [...byKey.values()] };
}

// Plain inserts, not upserts — each event is a distinct real-time occurrence (a process was
// matched and killed), not a current-state row.
export async function recordEvents(agentId: string, payload: CommandBlockEventBatchPayload): Promise<void> {
  if (payload.events.length === 0) return;

  const ruleIds = [...new Set(payload.events.map((e) => e.ruleId))];
  const rules = await prisma.commandBlockRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, policyId: true } });
  const policyIdByRuleId = new Map(rules.map((r) => [r.id, r.policyId]));

  await prisma.commandBlockEvent.createMany({
    data: payload.events.map((e) => ({
      agentId,
      // The rule's current policyId at ingestion time — a rule deleted between the block
      // happening and this report lands with policyId: null rather than failing the batch.
      policyId: policyIdByRuleId.get(e.ruleId) ?? null,
      ruleId: e.ruleId,
      matchedCommandLine: e.matchedCommandLine,
      processName: e.processName,
      action: e.action,
      occurredAt: new Date(e.occurredAt),
    })),
  });
}
