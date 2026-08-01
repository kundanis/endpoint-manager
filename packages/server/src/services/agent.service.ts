import type { UpdateAssetDetailsRequest } from "@em/shared";
import { prisma } from "../db";
import { createCommandJob } from "./command.service";
import { buildUninstallScript, UNINSTALL_TIMEOUT_SEC } from "./vulnerabilityRemediation.service";

export async function setAgentLifecycle(agentId: string, lifecycleStatus: string) {
  await prisma.agent.update({ where: { id: agentId }, data: { lifecycleStatus } });
}

export async function updateAssetDetails(agentId: string, params: UpdateAssetDetailsRequest) {
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      serialNumber: params.serialNumber,
      vendor: params.vendor,
      purchaseDate: params.purchaseDate,
      warrantyExpiryDate: params.warrantyExpiryDate,
      deviceTypeOverride: params.deviceTypeOverride,
      location: params.location,
    },
  });
}

export async function setAgentGroups(agentId: string, groupIds: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.agentGroupMembership.deleteMany({ where: { agentId } }),
    ...groupIds.map((groupId) => prisma.agentGroupMembership.create({ data: { agentId, groupId } })),
  ]);
}

export async function setAgentCustomFieldValues(
  agentId: string,
  values: { fieldDefinitionId: string; value: string }[],
): Promise<void> {
  for (const v of values) {
    await prisma.agentCustomFieldValue.upsert({
      where: { agentId_fieldDefinitionId: { agentId, fieldDefinitionId: v.fieldDefinitionId } },
      create: { agentId, fieldDefinitionId: v.fieldDefinitionId, value: v.value },
      update: { value: v.value, updatedAt: new Date() },
    });
  }
}

export async function getAgentCustomFieldValues(agentId: string) {
  const values = await prisma.agentCustomFieldValue.findMany({ where: { agentId } });
  return values.map((v) => ({ fieldDefinitionId: v.fieldDefinitionId, value: v.value }));
}

// Reuses the exact same registry-lookup uninstall script vulnerability remediation
// already dispatches (see vulnerabilityRemediation.service.ts's buildUninstallScript for
// the MSI-vs-EXE/silent-uninstall caveats) — this is just that same mechanism reachable
// from an arbitrary installed-software row, not only a CVE-flagged one.
export async function uninstallSoftwareOnAgent(
  agentId: string,
  softwareName: string,
  createdByAdminId: string,
): Promise<{ jobId: string }> {
  return createCommandJob({
    agentIds: [agentId],
    groupIds: [],
    shell: "powershell",
    script: buildUninstallScript(softwareName),
    timeoutSec: UNINSTALL_TIMEOUT_SEC,
    createdByAdminId,
  });
}

export async function listAgentNotes(agentId: string) {
  const notes = await prisma.assetNote.findMany({
    where: { agentId },
    include: { createdByAdmin: true },
    orderBy: { createdAt: "desc" },
  });
  return notes.map((n) => ({
    id: n.id,
    body: n.body,
    createdByAdminEmail: n.createdByAdmin.email,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function createAgentNote(agentId: string, createdByAdminId: string, body: string) {
  const note = await prisma.assetNote.create({
    data: { agentId, createdByAdminId, body },
    include: { createdByAdmin: true },
  });
  return {
    id: note.id,
    body: note.body,
    createdByAdminEmail: note.createdByAdmin.email,
    createdAt: note.createdAt.toISOString(),
  };
}
