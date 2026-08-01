import type { LicenseModule, ValidityType } from "@license/shared";
import { prisma } from "../db";
import { generateLicenseKey, keySuffix } from "../utils/licenseKeyGenerator";
import { hashToken } from "../utils/tokens";
import { EntityNotFoundError } from "./entity.service";

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

// modules is stored as a denormalized JSON string (see schema.prisma's comment) - every
// API consumer should only ever see a real string[], never the raw JSON text.
function withParsedModules<T extends { modules: string }>(row: T): Omit<T, "modules"> & { modules: LicenseModule[] } {
  return { ...row, modules: JSON.parse(row.modules) };
}

export interface IssueLicenseKeyInput {
  entityId: string;
  maxAgents: number;
  validityType: ValidityType;
  modules: LicenseModule[];
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
      maxAgents: input.maxAgents,
      validityType: input.validityType,
      modules: JSON.stringify(input.modules),
      validUntil,
      issuedByAdminId: input.issuedByAdminId,
    },
    // Without this, the response has no nested `entity` object — the console's
    // one-time reveal panel reads justIssued.entity.name and crashes the whole
    // component (unmounting it) when that's undefined, exactly like listLicenseKeys/
    // getLicenseKeyById already include it for the same reason.
    include: { entity: true },
  });

  return { licenseKey: withParsedModules(licenseKey), keyString };
}

export async function listLicenseKeys() {
  const rows = await prisma.licenseKey.findMany({
    orderBy: { issuedAt: "desc" },
    include: { entity: true },
  });
  return rows.map(withParsedModules);
}

export async function getLicenseKeyById(id: string) {
  const licenseKey = await prisma.licenseKey.findUnique({
    where: { id },
    include: { entity: true, unlockRequests: true },
  });
  if (!licenseKey) throw new LicenseKeyNotFoundError();
  return withParsedModules(licenseKey);
}

export async function revokeLicenseKey(id: string) {
  const result = await prisma.licenseKey.updateMany({
    where: { id, status: { in: ["ISSUED", "ACTIVATED"] } },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  if (result.count !== 1) throw new LicenseKeyNotRevocableError();
  return getLicenseKeyById(id);
}
