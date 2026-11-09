import type {
  CreateSoftwareLicenseRequest,
  InstalledSoftwareEntry,
  SoftwareLicenseAccessType,
  SoftwareLicenseBillingCycle,
  SoftwareLicenseDeploymentType,
  UpdateSoftwareLicenseRequest,
} from "@em/shared";
import { SOFTWARE_LICENSE_CYCLES_PER_YEAR } from "@em/shared";
import { prisma } from "../db";
import { decryptFieldOrNull, encryptFieldOrNull } from "../utils/fieldEncryption";
import { isSystemOrFreeSoftware } from "./softwareClassify.util";
import { GENERIC_MATCH_TOKENS, compact, normalizeName, tokenize } from "./softwareNameMatch.util";

// Licence name -> matcher. A licence matches an installed program when the compacted names are
// equal, or when every meaningful word of one name appears in the other: licence "Adobe Acrobat"
// matches "Adobe Acrobat (64-bit)", and installed "Adobe Acrobat" (how Acrobat Pro installs)
// matches licence "Adobe Acrobat Pro" - that reverse direction needs at least two words, so a
// bare "Adobe" entry doesn't match. Numbers and words like "microsoft", "windows", "server" or
// "tools" are ignored. One shared word is no longer enough: before, a licence such as
// "Microsoft Office" marked every program sharing any word with it as licensed.
interface LicenseMatcher {
  compactName: string;
  tokens: string[];
}

function toMatcher(softwareName: string): LicenseMatcher | null {
  const normalized = normalizeName(softwareName);
  const compactName = compact(normalized);
  const tokens = tokenize(normalized).filter((t) => !GENERIC_MATCH_TOKENS.has(t));
  if (!compactName && tokens.length === 0) return null;
  return { compactName, tokens };
}

function matchesInstalled(m: LicenseMatcher, entryName: string): boolean {
  const entryNormalized = normalizeName(entryName);
  if (m.compactName && compact(entryNormalized) === m.compactName) return true;
  if (m.tokens.length === 0) return false;
  const entryTokens = tokenize(entryNormalized).filter((t) => !GENERIC_MATCH_TOKENS.has(t));
  if (m.tokens.every((t) => entryTokens.includes(t))) return true;
  return entryTokens.length >= 2 && entryTokens.every((t) => m.tokens.includes(t));
}

// Estimates seats-in-use by name-matching against every agent's installed-software
// inventory - no manual per-device assignment step, so the count self-corrects as
// software gets installed/removed.
async function countAgentsWithMatchingSoftware(softwareName: string): Promise<number> {
  const matcher = toMatcher(softwareName);
  if (!matcher) return 0;

  const snapshots = await prisma.inventorySnapshot.findMany({ select: { installedSoftware: true } });

  let count = 0;
  for (const snap of snapshots) {
    const installed: InstalledSoftwareEntry[] = JSON.parse(snap.installedSoftware);
    if (installed.some((entry) => matchesInstalled(matcher, entry.name))) count++;
  }
  return count;
}

// A manually-entered seatsInUseOverride always wins over the heuristic - and skips the
// inventory scan entirely in that case, since the whole point of the override is "don't
// trust/bother with automatic detection for this license".
async function resolveSeatsInUse(softwareName: string, seatsInUseOverride: number | null): Promise<number> {
  if (seatsInUseOverride !== null) return seatsInUseOverride;
  return countAgentsWithMatchingSoftware(softwareName);
}

export type InstalledSoftwareLicenseStatus = "LICENSED" | "SYSTEM" | "NONE";

// For the endpoint Software tab: LICENSED when a recorded licence matches (same rule as the
// seat count), SYSTEM for drivers / runtimes / OS components / OEM utilities / free apps that
// need no licence, otherwise NONE ("no licence recorded"). Fetches all licences once.
export async function annotateWithLicenseStatus(
  installed: InstalledSoftwareEntry[],
): Promise<Array<InstalledSoftwareEntry & { licensed: boolean; licenseStatus: InstalledSoftwareLicenseStatus }>> {
  const licenses = await prisma.softwareLicense.findMany({ select: { softwareName: true } });
  const matchers = licenses.map((l) => toMatcher(l.softwareName)).filter((m): m is LicenseMatcher => m !== null);

  return installed.map((entry) => {
    const licensed = matchers.some((m) => matchesInstalled(m, entry.name));
    const licenseStatus: InstalledSoftwareLicenseStatus = licensed
      ? "LICENSED"
      : isSystemOrFreeSoftware(entry.name, entry.publisher)
        ? "SYSTEM"
        : "NONE";
    return { ...entry, licensed, licenseStatus };
  });
}

export async function createLicense(params: CreateSoftwareLicenseRequest, createdByAdminId: string) {
  const license = await prisma.softwareLicense.create({
    data: {
      softwareName: params.softwareName,
      version: params.version ?? null,
      vendor: params.vendor ?? null,
      licenseKey: encryptFieldOrNull(params.licenseKey),
      licenseType: params.licenseType,
      seatsPurchased: params.seatsPurchased,
      seatsInUseOverride: params.seatsInUseOverride ?? null,
      purchaseDate: params.purchaseDate ?? null,
      expiryDate: params.expiryDate ?? null,
      cost: params.cost ?? null,
      billingCycle: params.billingCycle,
      deploymentType: params.deploymentType ?? null,
      accessType: params.accessType ?? null,
      userDepartment: params.userDepartment ?? null,
      notes: params.notes ?? null,
      createdByAdminId,
    },
  });
  return serializeLicense(license, await resolveSeatsInUse(license.softwareName, license.seatsInUseOverride));
}

// Plain multi-row insert, not the upsert-loop pattern used elsewhere (e.g.
// assetGroup.service.ts's addGroupMembers) for SQL Server's missing createMany
// skipDuplicates support - SoftwareLicense has no unique constraint to conflict on, so
// there's nothing to skip/upsert against.
export async function importLicenses(licenses: CreateSoftwareLicenseRequest[], createdByAdminId: string): Promise<{ count: number }> {
  const result = await prisma.softwareLicense.createMany({
    data: licenses.map((params) => ({
      softwareName: params.softwareName,
      version: params.version ?? null,
      vendor: params.vendor ?? null,
      licenseKey: encryptFieldOrNull(params.licenseKey ?? null),
      licenseType: params.licenseType,
      seatsPurchased: params.seatsPurchased,
      seatsInUseOverride: params.seatsInUseOverride ?? null,
      purchaseDate: params.purchaseDate ?? null,
      expiryDate: params.expiryDate ?? null,
      cost: params.cost ?? null,
      billingCycle: params.billingCycle,
      deploymentType: params.deploymentType ?? null,
      accessType: params.accessType ?? null,
      userDepartment: params.userDepartment ?? null,
      notes: params.notes ?? null,
      createdByAdminId,
    })),
  });
  return { count: result.count };
}

export async function listLicenses() {
  const licenses = await prisma.softwareLicense.findMany({ orderBy: { softwareName: "asc" } });
  return Promise.all(
    licenses.map(async (l) => serializeLicense(l, await resolveSeatsInUse(l.softwareName, l.seatsInUseOverride))),
  );
}

export async function getLicense(id: string) {
  const license = await prisma.softwareLicense.findUnique({ where: { id } });
  if (!license) return null;
  return serializeLicense(license, await resolveSeatsInUse(license.softwareName, license.seatsInUseOverride));
}

export async function updateLicense(id: string, params: UpdateSoftwareLicenseRequest) {
  const license = await prisma.softwareLicense.update({
    where: { id },
    data: {
      softwareName: params.softwareName,
      version: params.version,
      vendor: params.vendor,
      licenseKey: encryptFieldOrNull(params.licenseKey),
      licenseType: params.licenseType,
      seatsPurchased: params.seatsPurchased,
      seatsInUseOverride: params.seatsInUseOverride,
      purchaseDate: params.purchaseDate,
      expiryDate: params.expiryDate,
      cost: params.cost,
      billingCycle: params.billingCycle,
      deploymentType: params.deploymentType,
      accessType: params.accessType,
      userDepartment: params.userDepartment,
      notes: params.notes,
    },
  });
  return serializeLicense(license, await resolveSeatsInUse(license.softwareName, license.seatsInUseOverride));
}

export async function deleteLicense(id: string): Promise<boolean> {
  try {
    await prisma.softwareLicense.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

interface LicenseRow {
  id: string;
  softwareName: string;
  version: string | null;
  vendor: string | null;
  licenseKey: string | null;
  licenseType: string;
  seatsPurchased: number;
  seatsInUseOverride: number | null;
  purchaseDate: Date | null;
  expiryDate: Date | null;
  cost: number | null;
  billingCycle: string;
  deploymentType: string | null;
  accessType: string | null;
  userDepartment: string | null;
  notes: string | null;
  createdByAdminId: string;
  createdAt: Date;
}

function serializeLicense(l: LicenseRow, seatsInUse: number) {
  const billingCycle = l.billingCycle as SoftwareLicenseBillingCycle;
  return {
    id: l.id,
    softwareName: l.softwareName,
    version: l.version,
    vendor: l.vendor,
    licenseKey: decryptFieldOrNull(l.licenseKey),
    licenseType: l.licenseType as "PERPETUAL" | "SUBSCRIPTION" | "VOLUME" | "OEM",
    seatsPurchased: l.seatsPurchased,
    seatsInUse,
    seatsInUseOverride: l.seatsInUseOverride,
    overCompliance: seatsInUse > l.seatsPurchased,
    purchaseDate: l.purchaseDate?.toISOString() ?? null,
    expiryDate: l.expiryDate?.toISOString() ?? null,
    cost: l.cost,
    billingCycle,
    // Annualized, not stored - derived on read the same way warranty/battery-health
    // status are elsewhere in this codebase, so it's always consistent with whatever
    // cost/billingCycle currently say rather than a separately-maintained value that
    // could drift out of sync.
    annualCost: l.cost != null ? l.cost * SOFTWARE_LICENSE_CYCLES_PER_YEAR[billingCycle] : null,
    deploymentType: l.deploymentType as SoftwareLicenseDeploymentType | null,
    accessType: l.accessType as SoftwareLicenseAccessType | null,
    userDepartment: l.userDepartment,
    notes: l.notes,
    createdByAdminId: l.createdByAdminId,
    createdAt: l.createdAt.toISOString(),
  };
}
