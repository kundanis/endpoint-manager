import { z } from "zod";

export const LICENSE_TYPES = ["PERPETUAL", "SUBSCRIPTION", "VOLUME", "OEM"] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

// How often `cost` recurs - lets a single entered amount (e.g. a monthly subscription
// fee) be annualized for comparison against yearly/perpetual licenses, without asking
// the admin to do that math themselves. YEARLY is the default for both new records and
// the migration backfill of existing rows - for a pre-existing row that just means "the
// cost already entered is treated as the yearly figure", i.e. no change to what it
// displays until an admin deliberately picks a different cycle.
export const SOFTWARE_LICENSE_BILLING_CYCLES = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"] as const;
export type SoftwareLicenseBillingCycle = (typeof SOFTWARE_LICENSE_BILLING_CYCLES)[number];

export const SOFTWARE_LICENSE_CYCLES_PER_YEAR: Record<SoftwareLicenseBillingCycle, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  HALF_YEARLY: 2,
  YEARLY: 1,
};

export const SOFTWARE_LICENSE_DEPLOYMENT_TYPES = ["ON_PREMISE", "VENDOR_CLOUD", "SYSTEMATIX_CLOUD", "HYBRID"] as const;
export type SoftwareLicenseDeploymentType = (typeof SOFTWARE_LICENSE_DEPLOYMENT_TYPES)[number];

// How this software is reached by its users - independent of deploymentType (where the
// software itself runs) since e.g. an on-premise app can still be exposed publicly or
// only over VPN.
export const SOFTWARE_LICENSE_ACCESS_TYPES = ["INTERNAL", "PUBLIC", "VPN"] as const;
export type SoftwareLicenseAccessType = (typeof SOFTWARE_LICENSE_ACCESS_TYPES)[number];

export const createSoftwareLicenseRequestSchema = z.object({
  softwareName: z.string().min(1).max(300),
  version: z.string().max(50).nullable().optional(),
  vendor: z.string().max(200).nullable().optional(),
  licenseKey: z.string().max(500).nullable().optional(),
  licenseType: z.enum(LICENSE_TYPES),
  seatsPurchased: z.number().int().min(0),
  // Manual override for "seats in use" — leave unset to keep the automatic estimate
  // (name-matched against agent inventory, see softwareLicense.service.ts). Set this when
  // that heuristic doesn't fit (e.g. software installed under a name it can't match, or a
  // license whose usage isn't tracked via installed-software at all).
  seatsInUseOverride: z.number().int().min(0).nullable().optional(),
  purchaseDate: z.coerce.date().nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  cost: z.number().min(0).nullable().optional(),
  billingCycle: z.enum(SOFTWARE_LICENSE_BILLING_CYCLES).default("YEARLY"),
  deploymentType: z.enum(SOFTWARE_LICENSE_DEPLOYMENT_TYPES).nullable().optional(),
  accessType: z.enum(SOFTWARE_LICENSE_ACCESS_TYPES).nullable().optional(),
  userDepartment: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreateSoftwareLicenseRequest = z.infer<typeof createSoftwareLicenseRequestSchema>;

export const updateSoftwareLicenseRequestSchema = createSoftwareLicenseRequestSchema.partial();
export type UpdateSoftwareLicenseRequest = z.infer<typeof updateSoftwareLicenseRequestSchema>;

// Bulk import (CSV upload) - same per-row shape as a single create, capped well above any
// realistic software inventory so a malformed/huge file fails fast with a clear error
// instead of a slow giant insert.
export const importSoftwareLicensesRequestSchema = z.object({
  licenses: z.array(createSoftwareLicenseRequestSchema).min(1).max(1000),
});
export type ImportSoftwareLicensesRequest = z.infer<typeof importSoftwareLicensesRequestSchema>;
