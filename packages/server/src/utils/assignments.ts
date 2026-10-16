// Assigning a policy/benchmark to targets it's already assigned to used to add a second row
// each time, so "Currently assigned" listed the same endpoint or group repeatedly. Given the
// existing assignments, this returns only the targets that are new (and de-duplicates the
// request itself). The tables have no unique constraint - agentId/groupId are each nullable -
// so this check is what prevents duplicates.
export function newAssignmentTargets(
  existing: { agentId: string | null; groupId: string | null }[],
  agentIds: string[],
  groupIds: string[],
): { agentIds: string[]; groupIds: string[] } {
  const assignedAgents = new Set(existing.map((e) => e.agentId).filter((id): id is string => !!id));
  const assignedGroups = new Set(existing.map((e) => e.groupId).filter((id): id is string => !!id));
  return {
    agentIds: [...new Set(agentIds)].filter((id) => !assignedAgents.has(id)),
    groupIds: [...new Set(groupIds)].filter((id) => !assignedGroups.has(id)),
  };
}
