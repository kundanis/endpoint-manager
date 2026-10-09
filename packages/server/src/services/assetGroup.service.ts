import type { CreateAssetGroupRequest, UpdateAssetGroupRequest } from "@em/shared";
import { prisma } from "../db";

export async function createGroup(params: CreateAssetGroupRequest) {
  const group = await prisma.assetGroup.create({
    data: { name: params.name, description: params.description ?? null },
  });
  return serializeGroup(group, 0);
}

export async function listGroups() {
  const groups = await prisma.assetGroup.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } } },
  });
  return groups.map((g) => serializeGroup(g, g._count.members));
}

export async function getGroup(id: string) {
  const group = await prisma.assetGroup.findUnique({
    where: { id },
    include: { members: { include: { agent: { include: { inventory: { select: { lastLoggedOnUser: true } } } } } } },
  });
  if (!group) return null;

  return {
    ...serializeGroup(group, group.members.length),
    members: group.members.map((m) => ({
      agentId: m.agentId,
      hostname: m.agent.hostname,
      lastLoggedOnUser: m.agent.inventory?.lastLoggedOnUser ?? null,
    })),
  };
}

export async function updateGroup(id: string, params: UpdateAssetGroupRequest) {
  const group = await prisma.assetGroup.update({
    where: { id },
    data: { name: params.name, description: params.description },
  });
  const memberCount = await prisma.agentGroupMembership.count({ where: { groupId: id } });
  return serializeGroup(group, memberCount);
}

export async function deleteGroup(id: string): Promise<boolean> {
  try {
    await prisma.assetGroup.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function addGroupMembers(groupId: string, agentIds: string[]): Promise<void> {
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

function serializeGroup(g: { id: string; name: string; description: string | null; createdAt: Date }, memberCount: number) {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    memberCount,
    createdAt: g.createdAt.toISOString(),
  };
}
