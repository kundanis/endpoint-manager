import type { CreateAssetGroupRequest, UpdateAssetGroupRequest } from "@em/shared";
import { prisma } from "../db";
import { assertCanJoinGroup, assertCanMoveGroup } from "./policyExclusivity.service";
import { assertCanMove, forgetGroupTree, groupPaths, GroupTreeError, withDescendants } from "./groupTree.service";

// Group hierarchy: groups can sit under other groups, any depth (groupTree.service.ts).

async function assertNameFree(name: string, parentId: string | null, exceptId?: string) {
  const same = await prisma.assetGroup.findFirst({ where: { name, parentId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (same) throw new GroupTreeError(parentId ? `This group already has a sub group named "${name}".` : `A main group named "${name}" already exists.`);
}

async function assertParentExists(parentId: string | null | undefined) {
  if (!parentId) return;
  if (!(await prisma.assetGroup.findUnique({ where: { id: parentId }, select: { id: true } }))) throw new GroupTreeError("The parent group doesn't exist.");
}

export async function createGroup(params: CreateAssetGroupRequest) {
  const parentId = params.parentId ?? null;
  await assertParentExists(parentId);
  await assertNameFree(params.name, parentId);
  const group = await prisma.assetGroup.create({
    data: { name: params.name, description: params.description ?? null, parentId },
  });
  forgetGroupTree();
  return serializeGroup(group, 0, (await groupPaths()).get(group.id) ?? group.name);
}

export async function listGroups() {
  const groups = await prisma.assetGroup.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } } },
  });
  const paths = await groupPaths();
  return groups.map((g) => serializeGroup(g, g._count.members, paths.get(g.id) ?? g.name));
}

export async function getGroup(id: string) {
  const group = await prisma.assetGroup.findUnique({
    where: { id },
    include: { members: { include: { agent: { include: { inventory: { select: { lastLoggedOnUser: true } } } } } } },
  });
  if (!group) return null;

  return {
    ...serializeGroup(group, group.members.length, (await groupPaths()).get(group.id) ?? group.name),
    members: group.members.map((m) => ({
      agentId: m.agentId,
      hostname: m.agent.hostname,
      lastLoggedOnUser: m.agent.inventory?.lastLoggedOnUser ?? null,
    })),
  };
}

export async function updateGroup(id: string, params: UpdateAssetGroupRequest) {
  const existing = await prisma.assetGroup.findUnique({ where: { id }, select: { name: true, parentId: true } });
  if (!existing) throw new GroupTreeError("Group not found.");
  const moving = params.parentId !== undefined && params.parentId !== existing.parentId;
  const parentId = params.parentId !== undefined ? params.parentId : existing.parentId;
  if (moving) {
    await assertParentExists(parentId);
    await assertCanMove(id, parentId);
    // The endpoints below it mustn't end up with two policies of an allow/block module.
    await assertCanMoveGroup(id, parentId);
  }
  if (moving || (params.name && params.name !== existing.name)) await assertNameFree(params.name ?? existing.name, parentId, id);
  const group = await prisma.assetGroup.update({
    where: { id },
    data: { name: params.name, description: params.description, ...(moving ? { parentId } : {}) },
  });
  forgetGroupTree();
  const memberCount = await prisma.agentGroupMembership.count({ where: { groupId: id } });
  return serializeGroup(group, memberCount, (await groupPaths()).get(group.id) ?? group.name);
}

// A group with sub groups isn't deleted: move or delete them first (their endpoints and policies
// would otherwise silently lose what they inherited).
export async function deleteGroup(id: string): Promise<boolean> {
  if ((await withDescendants([id])).size > 1) throw new GroupTreeError("This group has sub groups. Move or delete them first.");
  try {
    await prisma.assetGroup.delete({ where: { id } });
    forgetGroupTree();
    return true;
  } catch {
    return false;
  }
}

export async function addGroupMembers(groupId: string, agentIds: string[]): Promise<void> {
  // Joining mustn't give an endpoint a second policy of an allow/block module.
  await assertCanJoinGroup(groupId, agentIds);
  // Prisma has no createMany({ skipDuplicates: true }) support on SQL Server —
  // loop + upsert per id, same shape already used in patch.service.ts's recordPatchScan.
  for (const agentId of agentIds) {
    await prisma.agentGroupMembership.upsert({
      where: { agentId_groupId: { agentId, groupId } },
      create: { agentId, groupId },
      update: {},
    });
  }
}

export async function removeGroupMember(groupId: string, agentId: string): Promise<void> {
  await prisma.agentGroupMembership.deleteMany({ where: { groupId, agentId } });
}

function serializeGroup(g: { id: string; name: string; description: string | null; createdAt: Date; parentId: string | null }, memberCount: number, path: string) {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    parentId: g.parentId,
    path, // "Mumbai › Andheri"
    memberCount,
    createdAt: g.createdAt.toISOString(),
  };
}
