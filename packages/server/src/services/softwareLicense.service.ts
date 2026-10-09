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
import { compact, normalizeName, tokenize } from "./softwareNameMatch.util";

// Estimates seats-in-use by name-matching against every agent's installed-software
// inventory — no manual per-device assignment step, so the count self-corrects as
// software gets installed/removed. Same heuristic tolerance tradeoffs as the CVE
// matcher: token-overlap can both over-count (generic name collisions) and under-count
// (naming divergence from what the admin typed).
async function countAgentsWithMatchingSoftware(softwareName: string): Promise<number> {
  const licenseNormalized = normalizeName(softwareName);
  const licenseTokens = tokenize(licenseNormalized);
  const licenseCompact = compact(licenseNormalized);
  if (licenseTokens.length === 0 && !licenseCompact) return 0;

  const snapshots = await prisma.inventorySnapshot.findMany({ select: { installedSoftware: true } });

  let count = 0;
  for (const snap of snapshots) {
    const installed: InstalledSoftwareEntry[] = JSON.parse(snap.installedSoftware);
    const matched = installed.some((entry) => {
      const entryNormalized = normalizeName(entry.name);
      if (compact(entryNormalized) === licenseCompact) return true;
      const entryTokens = tokenize(entryNormalized);
      return entryTokens.some((t) => licenseTokens.includes(t));
    });
    if (matched) count++;
  }
  return count;
}

// A manually-entered seatsInUseOverride always wins over the heuristic — and skips the
// inventory scan entirely in that case, since the whole point of the override is "don't
// trust/bother with automatic detection for this license".
async function resolveSeatsInUse(softwareName: string, seatsInUseOverride: number | null): Promise<number> {
  if (seatsInUseOverride !== null) return seatsInUseOverride;
  return countAgentsWithMatchingSoftware(softwareName);
}

// Inverse of countAgentsWithMatchingSoftware — same heuristic (compact-name equality or
// any shared token), applied per installed-software entry against every license record,
// for AgentDetailPage's "Licensed" badge/filter. Fetches all licenses once regardless of
// installed-software list size, not once per entry.
export async function annotateWithLicenseStatus(
  installed: InstalledSoftwareEntry[],
): Promise<Array<InstalledSoftwareEntry & { licensed: boolean }>> {
  const licenses = await prisma.softwareLicense.findMany({ select: { softwareName: true } });
  const matchers = licenses.map((l) => {
    const normalized = normalizeName(l.softwareName);
    return { compactName: compact(normalized), tokens: tokenize(normalized) };
  });

  return installed.map((entry) => {
    const entryNormalized = normalizeName(entry.name);
    const entryCompact = compact(entryNormalized);
    const entryTokens = tokenize(entryNormalized);
    const licensed = matchers.some(
      (m) => m.compactName === entryCompact || m.tokens.some((t) => entryTokens.includes(t)),
    );
    return { ...entry, licensed };
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
