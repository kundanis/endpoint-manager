import type { ActivateResponse, LicenseModule, RevalidateResponse } from "@license/shared";
import { prisma } from "../db";
import { generateToken, hashToken, tokensMatch } from "../utils/tokens";

function parseModules(raw: string): LicenseModule[] {
  return JSON.parse(raw);
}

export class LicenseKeyNotFoundError extends Error {}
export class LicenseKeyRevokedError extends Error {}
export class LicenseKeyExpiredError extends Error {}
export class LicenseKeyAlreadyActivatedError extends Error {}
export class BindingMismatchError extends Error {}

function isExpired(validUntil: Date | null): boolean {
  return validUntil !== null && validUntil.getTime() < Date.now();
}

export async function activate(keyString: string, deploymentId: string): Promise<ActivateResponse> {
  const keyStringHash = hashToken(keyString);
  const existing = await prisma.licenseKey.findUnique({
    where: { keyStringHash },
    include: { entity: true },
  });
  if (!existing) throw new LicenseKeyNotFoundError();
  if (existing.status === "REVOKED") throw new LicenseKeyRevokedError();
  if (existing.status === "ACTIVATED") throw new LicenseKeyAlreadyActivatedError();
  if (isExpired(existing.validUntil)) throw new LicenseKeyExpiredError();

  const bindingToken = generateToken();
  const bindingTokenHash = hashToken(bindingToken);

  // Atomic compare-and-swap: the `status: "ISSUED"` filter guarantees only one of
  // two concurrent /activate calls on the same key can ever win this write.
  const result = await prisma.licenseKey.updateMany({
    where: { id: existing.id, status: "ISSUED" },
    data: {
      status: "ACTIVATED",
      boundDeploymentId: deploymentId,
      bindingTokenHash,
      activatedAt: new Date(),
    },
  });
  if (result.count !== 1) throw new LicenseKeyAlreadyActivatedError();

  return {
    entityName: existing.entity.name,
    maxAgents: existing.maxAgents,
    validityType: existing.validityType as ActivateResponse["validityType"],
    validUntil: existing.validUntil ? existing.validUntil.toISOString() : null,
    modules: parseModules(existing.modules),
    bindingToken,
  };
}

export async function revalidate(
  keyString: string,
  deploymentId: string,
  bindingToken: string
): Promise<RevalidateResponse> {
  const keyStringHash = hashToken(keyString);
  const existing = await prisma.licenseKey.findUnique({ where: { keyStringHash } });
  if (!existing) throw new LicenseKeyNotFoundError();

  if (existing.status === "ISSUED") throw new BindingMismatchError();
  if (existing.boundDeploymentId !== deploymentId) throw new BindingMismatchError();
  if (!existing.bindingTokenHash || !tokensMatch(hashToken(bindingToken), existing.bindingTokenHash)) {
    throw new BindingMismatchError();
  }

  const revoked = existing.status === "REVOKED" || isExpired(existing.validUntil);

  return {
    status: revoked ? "REVOKED" : "ACTIVATED",
    maxAgents: existing.maxAgents,
    validityType: existing.validityType as RevalidateResponse["validityType"],
    validUntil: existing.validUntil ? existing.validUntil.toISOString() : null,
    modules: parseModules(existing.modules),
  };
}
