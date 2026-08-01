import type { AssignedDataMovementPolicyWire, DataMovementScanResultPayload } from "@em/shared";
import { prisma } from "../db";

export async function resolveAssignedPoliciesForAgent(agentId: string): Promise<AssignedDataMovementPolicyWire[]> {
  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);

  const assignments = await prisma.dataMovementPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const policyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (policyIds.length === 0) return [];

  // A paused policy (enabled: false) is skipped entirely, same semantics as every other module.
  const policies = await prisma.dataMovementPolicy.findMany({ where: { id: { in: policyIds }, enabled: true } });

  return policies.map((p) => ({
    policyId: p.id,
    monitorUsb: p.monitorUsb,
    monitorCloudSync: p.monitorCloudSync,
    monitorNetworkShare: p.monitorNetworkShare,
    extraCloudSyncPaths: JSON.parse(p.extraCloudSyncPaths) as string[],
  }));
}

// Loop + upsert per event, not createMany — Prisma has no createMany({skipDuplicates})
// support on SQL Server (same constraint noted in assetGroup.service.ts/patch.service.ts).
// The compound unique key (agentId, policyId, filePath, channel, fileModifiedAt) means a
// re-detection of the same physical copy in an overlapping scan window upserts into the
// same row instead of duplicating; a genuinely new copy (different mtime) still inserts.
export async function recordScanResult(agentId: string, payload: DataMovementScanResultPayload): Promise<void> {
  const policy = await prisma.dataMovementPolicy.findUnique({ where: { id: payload.policyId }, select: { id: true } });
  if (!policy) return; // policy deleted out from under an in-flight scan — drop, don't fail

  for (const e of payload.events) {
    await prisma.dataMovementEvent.upsert({
      where: {
        agentId_policyId_filePath_channel_fileModifiedAt: {
          agentId,
          policyId: payload.policyId,
          filePath: e.filePath,
          channel: e.channel,
          fileModifiedAt: new Date(e.fileModifiedAt),
        },
      },
      create: {
        agentId,
        policyId: payload.policyId,
        filePath: e.filePath,
        fileSizeBytes: BigInt(e.fileSizeBytes),
        fileModifiedAt: new Date(e.fileModifiedAt),
        channel: e.channel,
        channelDetail: JSON.stringify(e.channelDetail),
      },
      update: {},
    });
  }
}
