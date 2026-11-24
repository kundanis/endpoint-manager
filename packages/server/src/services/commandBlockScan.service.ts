import type {
  AssignedCommandBlockResponse,
  CommandBlockEnforcementMode,
  CommandBlockEventBatchPayload,
  CommandBlockRuleType,
  CommandBlockSyncResultPayload,
} from "@em/shared";
import { commandProtection, type CommandProtectionOs } from "@em/shared";
import { prisma } from "../db";
import { isPolicyExcepted } from "./policyAccessException.service";
import { isAgentPaused } from "./pause.service";
import { effectiveMemberships } from "./groupTree.service";

// Flat, deduped across every enabled, non-excepted policy assigned to this agent (directly
// or via a group) — each match is independently attributable to the rule that fired, so
// unlike webBlock's merged domain list, no per-policy nesting is needed here either.
// The policies this agent enforces: assigned directly or via a group, enabled, not excepted for
// it, and none while the agent is paused.
async function activePolicyIdsForAgent(agentId: string): Promise<{ policyIds: string[]; groupIds: string[] }> {
  const memberships = await effectiveMemberships(agentId);
  const groupIds = memberships.map((m) => m.groupId);
  if (await isAgentPaused(agentId)) return { policyIds: [], groupIds };

  const assignments = await prisma.commandBlockPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const candidatePolicyIds = [...new Set(assignments.map((a) => a.policyId))];
  const excepted = await Promise.all(candidatePolicyIds.map((id) => isPolicyExcepted("COMMAND_BLOCK", id, agentId)));
  const notExcepted = candidatePolicyIds.filter((_, i) => !excepted[i]);
  if (notExcepted.length === 0) return { policyIds: [], groupIds };

  const enabled = await prisma.commandBlockPolicy.findMany({ where: { id: { in: notExcepted }, enabled: true }, select: { id: true } });
  return { policyIds: enabled.map((p) => p.id), groupIds };
}

// Stamps the endpoint's latest sync on its assignment rows (direct or via a group) for every
// policy it enforces - the Sync status tab.
export async function recordSyncResult(agentId: string, payload: CommandBlockSyncResultPayload): Promise<void> {
  const { policyIds, groupIds } = await activePolicyIdsForAgent(agentId);
  if (policyIds.length === 0) return;
  await prisma.commandBlockPolicyAssignment.updateMany({
    where: { policyId: { in: policyIds }, OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    data: { lastSyncedAt: new Date(), lastSyncStatus: payload.status, lastSyncError: payload.errorMessage },
  });
}

export async function resolveAssignedRulesForAgent(agentId: string): Promise<AssignedCommandBlockResponse> {
  const { policyIds } = await activePolicyIdsForAgent(agentId);
  if (policyIds.length === 0) return { rules: [] };

  const policies = await prisma.commandBlockPolicy.findMany({
    where: { id: { in: policyIds } },
    include: { rules: true },
  });

  // Only protections from the catalogue are enforced, always in Block mode: each becomes the
  // command patterns for this endpoint's OS, carrying the protection rule's id so events point
  // back to it. Custom rules stored before the catalogue existed are no longer sent.
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { osPlatform: true } });
  const os = agent?.osPlatform as CommandProtectionOs | undefined;
  const byPattern = new Map<
    string,
    { ruleId: string; ruleType: CommandBlockRuleType; pattern: string; enforcementMode: CommandBlockEnforcementMode }
  >();
  for (const policy of policies) {
    for (const rule of policy.rules) {
      if (rule.ruleType !== "PROTECTION" || !os) continue;
      for (const pattern of commandProtection(rule.value)?.patterns[os] ?? []) {
        if (!byPattern.has(pattern)) byPattern.set(pattern, { ruleId: rule.id, ruleType: "COMMAND_PATTERN", pattern, enforcementMode: "BLOCK" });
      }
    }
  }

  return { rules: [...byPattern.values()] };
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
