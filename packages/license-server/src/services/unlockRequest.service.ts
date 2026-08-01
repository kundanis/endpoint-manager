import { prisma } from "../db";
import { hashToken } from "../utils/tokens";
import { LicenseKeyNotFoundError } from "./activation.service";

export class UnlockRequestNotFoundError extends Error {}
export class UnlockRequestNotPendingError extends Error {}

export async function createUnlockRequest(keyString: string, deploymentId: string, reason: string) {
  const keyStringHash = hashToken(keyString);
  const licenseKey = await prisma.licenseKey.findUnique({ where: { keyStringHash } });
  if (!licenseKey) throw new LicenseKeyNotFoundError();

  await prisma.unlockRequest.create({
    data: {
      licenseKeyId: licenseKey.id,
      requestingDeploymentId: deploymentId,
      reason,
    },
  });

  return { status: "PENDING" as const };
}

export function listUnlockRequests() {
  return prisma.unlockRequest.findMany({
    orderBy: { requestedAt: "desc" },
    include: { licenseKey: { include: { entity: true } } },
  });
}

async function resolvePending(id: string) {
  const unlockRequest = await prisma.unlockRequest.findUnique({ where: { id } });
  if (!unlockRequest) throw new UnlockRequestNotFoundError();
  if (unlockRequest.status !== "PENDING") throw new UnlockRequestNotPendingError();
  return unlockRequest;
}

// Approving unlocks the key for re-activation: rolls it back to ISSUED and clears
// the previous binding, so the entity can run /activate again (a fresh bindingToken
// is issued at that point — see the v1 simplification note on activation.service.ts).
export async function approveUnlockRequest(id: string, resolvedByAdminId: string, resolutionNote?: string) {
  const unlockRequest = await resolvePending(id);

  await prisma.licenseKey.update({
    where: { id: unlockRequest.licenseKeyId },
    data: {
      status: "ISSUED",
      boundDeploymentId: null,
      bindingTokenHash: null,
      activatedAt: null,
    },
  });

  return prisma.unlockRequest.update({
    where: { id },
    data: { status: "APPROVED", resolvedAt: new Date(), resolvedByAdminId, resolutionNote },
  });
}

export async function rejectUnlockRequest(id: string, resolvedByAdminId: string, resolutionNote?: string) {
  await resolvePending(id);

  return prisma.unlockRequest.update({
    where: { id },
    data: { status: "REJECTED", resolvedAt: new Date(), resolvedByAdminId, resolutionNote },
  });
}
