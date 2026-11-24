import type { AssignedWebBlockResponse, WebBlockSyncResultPayload } from "@em/shared";
import { prisma } from "../db";
import { isPolicyExcepted } from "./policyAccessException.service";
import { isAgentPaused } from "./pause.service";
import { AI_GUARD_SYNC_PREFIX, activeAiPoliciesForAgent, aiGuardBlockedDomains, recordAiGuardSync } from "./aiGuard.service";
import { effectiveMemberships } from "./groupTree.service";
import { isFeatureLicensed } from "./licenseActivation.service";

async function groupIdsForAgent(agentId: string): Promise<string[]> {
  const memberships = await effectiveMemberships(agentId);
  return memberships.map((m) => m.groupId);
}

// Flat, deduped domain list across every enabled, non-excepted policy assigned to this
// agent (directly or via a group) — the agent applies one combined hosts-file block + one
// combined browser URLBlocklist, not independent per-policy actions.
export async function resolveAssignedRulesForAgent(agentId: string): Promise<AssignedWebBlockResponse> {
  if (await isAgentPaused(agentId)) return { policyIds: [], domains: [] };
  // Web & email blocking policies are licensed on their own (EPM_WEB); AI Guard's blocks below
  // aren't part of it.
  const own = (await isFeatureLicensed("EPM_WEB")) ? await resolveWebBlockPolicies(agentId) : { policyIds: [], domains: [] };
  // AI Guard's blocked AI websites ride on the same enforcement (aiGuard.service.ts); its policy
  // ids travel as "aiguard:<id>" so the sync the agent reports back covers them too.
  const aiPolicies = await activeAiPoliciesForAgent(agentId);
  if (aiPolicies.length === 0) return own;
  const aiDomains = await aiGuardBlockedDomains(agentId);
  return {
    policyIds: [...own.policyIds, ...aiPolicies.map((p) => `${AI_GUARD_SYNC_PREFIX}${p.id}`)],
    domains: [...new Set([...own.domains, ...aiDomains])],
  };
}

async function resolveWebBlockPolicies(agentId: string): Promise<AssignedWebBlockResponse> {
  const groupIds = await groupIdsForAgent(agentId);

  const assignments = await prisma.webBlockPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const candidatePolicyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (candidatePolicyIds.length === 0) return { policyIds: [], domains: [] };

  const excepted = await Promise.all(candidatePolicyIds.map((id) => isPolicyExcepted("WEB_BLOCK", id, agentId)));
  const policyIds = candidatePolicyIds.filter((_, i) => !excepted[i]);
  if (policyIds.length === 0) return { policyIds: [], domains: [] };

  const policies = await prisma.webBlockPolicy.findMany({
    where: { id: { in: policyIds }, enabled: true },
    include: { rules: true },
  });

  const domains = [...new Set(policies.flatMap((p) => p.rules.map((r) => r.value.toLowerCase())))];
  return { policyIds: policies.map((p) => p.id), domains };
}

// Stamps lastSyncedAt/lastSyncStatus/lastSyncError on every assignment row (for this agent,
// direct or via one of its groups) belonging to a policy the agent just synced — a health
// snapshot, not an audit log (no per-domain event stream exists for this module).
export async function recordSyncResult(agentId: string, payload: WebBlockSyncResultPayload): Promise<void> {
  if (payload.policyIds.length === 0) return;
  await recordAiGuardSync(agentId, payload);
  const groupIds = await groupIdsForAgent(agentId);

  await prisma.webBlockPolicyAssignment.updateMany({
    where: {
      policyId: { in: payload.policyIds },
      OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])],
    },
    data: {
      lastSyncedAt: new Date(),
      lastSyncStatus: payload.status,
      lastSyncError: payload.errorMessage,
    },
  });
}
