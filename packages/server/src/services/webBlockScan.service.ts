import type { AssignedWebBlockResponse, WebBlockSyncResultPayload } from "@em/shared";
import { prisma } from "../db";
import { isPolicyExcepted } from "./policyAccessException.service";

async function groupIdsForAgent(agentId: string): Promise<string[]> {
  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  return memberships.map((m) => m.groupId);
}

// Flat, deduped domain list across every enabled, non-excepted policy assigned to this
// agent (directly or via a group) — the agent applies one combined hosts-file block + one
// combined browser URLBlocklist, not independent per-policy actions.
export async function resolveAssignedRulesForAgent(agentId: string): Promise<AssignedWebBlockResponse> {
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
