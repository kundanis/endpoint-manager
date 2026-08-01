import type { AssignedIpBlockResponse, IpBlockSyncResultPayload } from "@em/shared";
import { prisma } from "../db";
import { isPolicyExcepted } from "./policyAccessException.service";

async function groupIdsForAgent(agentId: string): Promise<string[]> {
  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  return memberships.map((m) => m.groupId);
}

// Flat, deduped address list across every enabled, non-excepted policy assigned to this
// agent (directly or via a group) — the agent applies one combined pair of firewall rules,
// not independent per-policy rules.
export async function resolveAssignedRulesForAgent(agentId: string): Promise<AssignedIpBlockResponse> {
  const groupIds = await groupIdsForAgent(agentId);

  const assignments = await prisma.ipBlockPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const candidatePolicyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (candidatePolicyIds.length === 0) return { policyIds: [], addresses: [] };

  const excepted = await Promise.all(candidatePolicyIds.map((id) => isPolicyExcepted("IP_BLOCK", id, agentId)));
  const policyIds = candidatePolicyIds.filter((_, i) => !excepted[i]);
  if (policyIds.length === 0) return { policyIds: [], addresses: [] };

  const policies = await prisma.ipBlockPolicy.findMany({
    where: { id: { in: policyIds }, enabled: true },
    include: { rules: true },
  });

  const addresses = [...new Set(policies.flatMap((p) => p.rules.map((r) => r.value)))];
  return { policyIds: policies.map((p) => p.id), addresses };
}

// Stamps lastSyncedAt/lastSyncStatus/lastSyncError on every assignment row (for this agent,
// direct or via one of its groups) belonging to a policy the agent just synced — a health
// snapshot, not an audit log (no per-address event stream exists for this module).
export async function recordSyncResult(agentId: string, payload: IpBlockSyncResultPayload): Promise<void> {
  if (payload.policyIds.length === 0) return;
  const groupIds = await groupIdsForAgent(agentId);

  await prisma.ipBlockPolicyAssignment.updateMany({
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
