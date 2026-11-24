import { prisma } from "../db";

// Group hierarchy (Main group -> sub group -> ... -> endpoints, any depth; endpoints at any level).
//
// AgentGroupMembership holds only the groups an endpoint was put in directly. Everything that
// asks "which groups is this endpoint in" (policy assignment, exceptions, pauses) also counts the
// groups above them - a policy on Mumbai applies in Andheri - and everything that asks "which
// endpoints are in this group" (filters, targeting, sync status) also counts the groups below.
// Every such question goes through this file.

type Tree = { parentOf: Map<string, string | null>; childrenOf: Map<string, string[]> };

// Groups change rarely and are few; the tree is read at most once a second.
let cached: { at: number; tree: Promise<Tree> } | null = null;
const CACHE_MS = 1000;

async function readTree(): Promise<Tree> {
  const rows = await prisma.assetGroup.findMany({ select: { id: true, parentId: true } });
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    parentOf.set(r.id, r.parentId);
    if (r.parentId) childrenOf.set(r.parentId, [...(childrenOf.get(r.parentId) ?? []), r.id]);
  }
  return { parentOf, childrenOf };
}

export function groupTree(): Promise<Tree> {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) cached = { at: now, tree: readTree() };
  return cached.tree;
}

// After a group is created, moved or deleted.
export function forgetGroupTree(): void {
  cached = null;
}

// The groups and every group above them (each group itself included).
export async function withAncestors(groupIds: Iterable<string>): Promise<Set<string>> {
  const { parentOf } = await groupTree();
  const out = new Set<string>();
  for (const id of groupIds) {
    let at: string | null | undefined = id;
    // The depth guard only matters for a corrupt tree (a loop can't be saved, see assertCanMove).
    for (let depth = 0; at && !out.has(at) && depth < 100; depth++) {
      out.add(at);
      at = parentOf.get(at);
    }
  }
  return out;
}

// The groups and every group below them (each group itself included).
export async function withDescendants(groupIds: Iterable<string>): Promise<Set<string>> {
  const { childrenOf } = await groupTree();
  const out = new Set<string>();
  const queue = [...groupIds];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

// The groups an endpoint is in, directly or through a sub group - same shape as
// agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } }).
export async function effectiveMemberships(agentId: string): Promise<{ groupId: string }[]> {
  const direct = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  return [...(await withAncestors(direct.map((m) => m.groupId)))].map((groupId) => ({ groupId }));
}

// The same for several endpoints: one row per endpoint and group it is in, directly or not.
export async function effectiveMembershipsOf(agentIds: string[]): Promise<{ agentId: string; groupId: string }[]> {
  if (agentIds.length === 0) return [];
  const direct = await prisma.agentGroupMembership.findMany({ where: { agentId: { in: agentIds } }, select: { agentId: true, groupId: true } });
  const byAgent = new Map<string, string[]>();
  for (const m of direct) byAgent.set(m.agentId, [...(byAgent.get(m.agentId) ?? []), m.groupId]);
  const out: { agentId: string; groupId: string }[] = [];
  for (const [agentId, groups] of byAgent) for (const groupId of await withAncestors(groups)) out.push({ agentId, groupId });
  return out;
}

// The endpoints in these groups or any group below them (each once).
export async function membersOfGroups(groupIds: string[]): Promise<{ agentId: string }[]> {
  if (groupIds.length === 0) return [];
  const all = await withDescendants(groupIds);
  const rows = await prisma.agentGroupMembership.findMany({ where: { groupId: { in: [...all] } }, select: { agentId: true } });
  return [...new Set(rows.map((r) => r.agentId))].map((agentId) => ({ agentId }));
}

// For each of these groups, the endpoints in it or below it, reported as members of that group -
// same shape as agentGroupMembership.findMany({ where: { groupId: { in } }, select: { agentId, groupId } }).
export async function membershipsUnderGroups(groupIds: string[], agentIds?: string[]): Promise<{ agentId: string; groupId: string }[]> {
  if (groupIds.length === 0) return [];
  const { childrenOf } = await groupTree();
  const below = new Map<string, Set<string>>(); // given group -> it and its descendants
  for (const g of groupIds) {
    const set = new Set<string>();
    const queue = [g];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (set.has(id)) continue;
      set.add(id);
      queue.push(...(childrenOf.get(id) ?? []));
    }
    below.set(g, set);
  }
  const all = new Set([...below.values()].flatMap((s) => [...s]));
  const rows = await prisma.agentGroupMembership.findMany({
    where: { groupId: { in: [...all] }, ...(agentIds ? { agentId: { in: agentIds } } : {}) },
    select: { agentId: true, groupId: true },
  });
  const out = new Map<string, { agentId: string; groupId: string }>();
  for (const [g, set] of below) {
    for (const r of rows) if (set.has(r.groupId)) out.set(`${r.agentId}|${g}`, { agentId: r.agentId, groupId: g });
  }
  return [...out.values()];
}

export class GroupTreeError extends Error {}

// A group can't be moved under itself or under one of its own sub groups.
export async function assertCanMove(groupId: string, newParentId: string | null): Promise<void> {
  if (!newParentId) return;
  if (newParentId === groupId) throw new GroupTreeError("A group can't be its own parent.");
  const below = await withDescendants([groupId]);
  if (below.has(newParentId)) throw new GroupTreeError("A group can't be moved under one of its own sub groups.");
}

// "Mumbai › Andheri", for messages and lists.
export async function groupPaths(): Promise<Map<string, string>> {
  const groups = await prisma.assetGroup.findMany({ select: { id: true, name: true, parentId: true } });
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out = new Map<string, string>();
  for (const g of groups) {
    const names: string[] = [];
    let at: typeof g | undefined = g;
    for (let depth = 0; at && depth < 100; depth++) {
      names.unshift(at.name);
      at = at.parentId ? byId.get(at.parentId) : undefined;
    }
    out.set(g.id, names.join(" › "));
  }
  return out;
}
