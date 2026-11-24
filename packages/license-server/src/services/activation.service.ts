import type { ActivateResponse, LicenseModule, RegisterCallbackResponse, RevalidateResponse } from "@license/shared";
import { prisma } from "../db";
import { generateToken, hashToken, tokensMatch } from "../utils/tokens";

function parseModules(raw: string): LicenseModule[] {
  return JSON.parse(raw);
}

// null = everything in the licensed modules.
function parseFeatures(raw: string | null): string[] | null {
  return raw ? (JSON.parse(raw) as string[]) : null;
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
    features: parseFeatures(existing.features),
    bindingToken,
  };
}

// Proof of possession for an already-activated key: the key, the deployment it's bound to,
// and the bindingToken handed out at activation must all match.
export async function findBoundKey(keyString: string, deploymentId: string, bindingToken: string) {
  const keyStringHash = hashToken(keyString);
  const existing = await prisma.licenseKey.findUnique({ where: { keyStringHash } });
  if (!existing) throw new LicenseKeyNotFoundError();

  if (existing.status === "ISSUED") throw new BindingMismatchError();
  if (existing.boundDeploymentId !== deploymentId) throw new BindingMismatchError();
  if (!existing.bindingTokenHash || !tokensMatch(hashToken(bindingToken), existing.bindingTokenHash)) {
    throw new BindingMismatchError();
  }
  return existing;
}

// Kept for deployments still running a version that polls; current versions only call
// registerCallback and wait for a revoke notice instead.
export async function revalidate(
  keyString: string,
  deploymentId: string,
  bindingToken: string
): Promise<RevalidateResponse> {
  const existing = await findBoundKey(keyString, deploymentId, bindingToken);

  const revoked = existing.status === "REVOKED" || isExpired(existing.validUntil);

  return {
    status: revoked ? "REVOKED" : "ACTIVATED",
    maxAgents: existing.maxAgents,
    validityType: existing.validityType as RevalidateResponse["validityType"],
    validUntil: existing.validUntil ? existing.validUntil.toISOString() : null,
    modules: parseModules(existing.modules),
    features: parseFeatures(existing.features),
  };
}

// Records where the bound deployment can be reached for a revoke notice. The secret is
// generated once and handed back on every re-registration (e.g. after the deployment's
// address changes), so a deployment that lost the response can simply register again.
export async function registerCallback(
  keyString: string,
  deploymentId: string,
  bindingToken: string,
  callbackUrls: string[]
): Promise<RegisterCallbackResponse> {
  const existing = await findBoundKey(keyString, deploymentId, bindingToken);
  const revocationSecret = existing.revocationSecret ?? generateToken();
  const revoked = existing.status === "REVOKED";

  await prisma.licenseKey.update({
    where: { id: existing.id },
    data: {
      callbackUrls: JSON.stringify(callbackUrls),
      revocationSecret,
      // Revoked before the deployment had registered anywhere to be told - this response
      // tells it, so there's no separate notice left to deliver.
      ...(revoked && !existing.revokeNoticeDeliveredAt
        ? { revokeNoticeDeliveredAt: new Date(), revokeNoticeLastError: null }
        : {}),
    },
  });

  return { revocationSecret, status: revoked ? "REVOKED" : "ACTIVATED" };
}
