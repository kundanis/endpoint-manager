import { storedFeatures } from "./features.util";
import type { LicenseModule, LicenseProduct, ValidityType } from "@license/shared";
import { prisma } from "../db";
import { generateLicenseKey, keySuffix } from "../utils/licenseKeyGenerator";
import { hashToken } from "../utils/tokens";
import { EntityNotFoundError } from "./entity.service";
import { deliverRevokeNotice } from "./revokeNotice.service";
import { cancelOpenRequestsForKey } from "./changeRequest.service";

export class LicenseKeyNotFoundError extends Error {}
export class LicenseKeyNotRevocableError extends Error {}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function computeValidUntil(validityType: ValidityType, from: Date): Date | null {
  switch (validityType) {
    case "ONE_YEAR":
      return new Date(from.getTime() + YEAR_MS);
    case "TWO_YEAR":
      return new Date(from.getTime() + 2 * YEAR_MS);
    case "THREE_YEAR":
      return new Date(from.getTime() + 3 * YEAR_MS);
    case "PERPETUAL":
      return null;
  }
}

// modules and callbackUrls are stored as denormalized JSON strings (see schema.prisma's
// comment) - every API consumer should only ever see real string[]s, never the raw JSON
// text. revocationSecret never leaves this server except on the revoke notice itself.
function toApiRow<T extends { modules: string; features: string | null; callbackUrls: string | null; revocationSecret: string | null }>(row: T) {
  const { revocationSecret: _secret, ...rest } = row;
  return {
    ...rest,
    modules: JSON.parse(row.modules) as LicenseModule[],
    features: row.features ? (JSON.parse(row.features) as string[]) : null, // null = everything in the modules
    callbackUrls: row.callbackUrls ? (JSON.parse(row.callbackUrls) as string[]) : [],
  };
}

export interface IssueLicenseKeyInput {
  entityId: string;
  product: LicenseProduct;
  maxAgents: number;
  validityType: ValidityType;
  modules: LicenseModule[];
  features?: string[] | null; // null/absent = everything in the modules
  issuedByAdminId: string;
}

// Returns the plaintext key exactly once — callers must surface it to the admin
// immediately, mirroring EnrollmentTokensPage's "copy it now" UX. It is never
// recoverable from storage after this call returns (only keyStringHash + keySuffix persist).
export async function issueLicenseKey(input: IssueLicenseKeyInput) {
  const entity = await prisma.entity.findUnique({ where: { id: input.entityId } });
  if (!entity) throw new EntityNotFoundError();

  const keyString = generateLicenseKey();
  const validUntil = computeValidUntil(input.validityType, new Date());

  const licenseKey = await prisma.licenseKey.create({
    data: {
      keyStringHash: hashToken(keyString),
      keySuffix: keySuffix(keyString),
      entityId: input.entityId,
      product: input.product,
      maxAgents: input.maxAgents,
      validityType: input.validityType,
      modules: JSON.stringify(input.modules),
      features: storedFeatures(input.modules, input.features),
      validUntil,
      issuedByAdminId: input.issuedByAdminId,
    },
    // Without this, the response has no nested `entity` object — the console's
    // one-time reveal panel reads justIssued.entity.name and crashes the whole
    // component (unmounting it) when that's undefined, exactly like listLicenseKeys/
    // getLicenseKeyById already include it for the same reason.
    include: { entity: true },
  });

  return { licenseKey: toApiRow(licenseKey), keyString };
}

export async function listLicenseKeys() {
  const rows = await prisma.licenseKey.findMany({
    orderBy: { issuedAt: "desc" },
    include: { entity: true },
  });
  return rows.map(toApiRow);
}

export async function getLicenseKeyById(id: string) {
  const licenseKey = await prisma.licenseKey.findUnique({
    where: { id },
    include: { entity: true, unlockRequests: true },
  });
  if (!licenseKey) throw new LicenseKeyNotFoundError();
  return toApiRow(licenseKey);
}

export async function revokeLicenseKey(id: string) {
  const result = await prisma.licenseKey.updateMany({
    where: { id, status: { in: ["ISSUED", "ACTIVATED"] } },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  if (result.count !== 1) throw new LicenseKeyNotRevocableError();
  await cancelOpenRequestsForKey(id);
  // Activated deployments never poll, so the revoke only reaches them via this notice.
  // Waited on so the console shows straight away whether it landed; a failure is retried.
  await deliverRevokeNotice(id);
  return getLicenseKeyById(id);
}
