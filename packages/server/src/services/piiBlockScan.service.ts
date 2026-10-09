import type { AssignedPiiBlockResponse, PiiBlockSyncResultPayload, PiiPatternKey } from "@em/shared";
import { prisma } from "../db";
import { isAgentPaused } from "./pause.service";

async function groupIdsForAgent(agentId: string): Promise<string[]> {
  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  return memberships.map((m) => m.groupId);
}

// Flat, deduped PII category list across every enabled policy assigned to this agent
// (directly or via a group) — same "one combined declarative state" shape as Web Block's
// resolveAssignedRulesForAgent. Note: there is no agent-side content inspection/enforcement
// consuming this yet (see the PiiBlockPolicy model comment) — this endpoint exists so the
// policy layer is ready for whenever that ships.
export async function resolveAssignedRulesForAgent(agentId: string): Promise<AssignedPiiBlockResponse> {
  if (await isAgentPaused(agentId)) return { policyIds: [], patternKeys: [] };

  const groupIds = await groupIdsForAgent(agentId);

  const assignments = await prisma.piiBlockPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const policyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (policyIds.length === 0) return { policyIds: [], patternKeys: [] };

  const policies = await prisma.piiBlockPolicy.findMany({
    where: { id: { in: policyIds }, enabled: true },
    include: { rules: true },
  });

  const patternKeys = [...new Set(policies.flatMap((p) => p.rules.map((r) => r.value as PiiPatternKey)))];
  return { policyIds: policies.map((p) => p.id), patternKeys };
}

// Stamps lastSyncedAt/lastSyncStatus/lastSyncError on every assignment row (for this agent,
// direct or via one of its groups) belonging to a policy the agent just synced — a health
// snapshot, not an audit log (no per-category event stream exists for this module).
export async function recordSyncResult(agentId: string, payload: PiiBlockSyncResultPayload): Promise<void> {
  if (payload.policyIds.length === 0) return;
  const groupIds = await groupIdsForAgent(agentId);

  await prisma.piiBlockPolicyAssignment.updateMany({
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
