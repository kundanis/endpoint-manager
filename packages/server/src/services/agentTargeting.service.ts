import { prisma } from "../db";

// Expands groupIds to member agentIds and unions with explicitly-picked agentIds.
// Used by all three dispatch routes (commands/deployments/patches) — the existing
// task-fan-out logic in each createXJob function is untouched, it just receives a
// larger, deduped agentIds list.
export async function resolveTargetAgentIds(agentIds: string[], groupIds: string[]): Promise<string[]> {
  if (groupIds.length === 0) return [...new Set(agentIds)];

  const memberships = await prisma.agentGroupMembership.findMany({
    where: { groupId: { in: groupIds } },
    select: { agentId: true },
  });

  return [...new Set([...agentIds, ...memberships.map((m) => m.agentId)])];
}
