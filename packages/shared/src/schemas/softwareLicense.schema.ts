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

export const createSoftwareLicenseRequestSchema = z.object({
  softwareName: z.string().min(1).max(300),
  vendor: z.string().max(200).nullable().optional(),
  licenseKey: z.string().max(500).nullable().optional(),
  licenseType: z.enum(LICENSE_TYPES),
  seatsPurchased: z.number().int().min(0),
  purchaseDate: z.coerce.date().nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  cost: z.number().min(0).nullable().optional(),
  billingCycle: z.enum(SOFTWARE_LICENSE_BILLING_CYCLES).default("YEARLY"),
  deploymentType: z.enum(SOFTWARE_LICENSE_DEPLOYMENT_TYPES).nullable().optional(),
  userDepartment: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreateSoftwareLicenseRequest = z.infer<typeof createSoftwareLicenseRequestSchema>;

export const updateSoftwareLicenseRequestSchema = createSoftwareLicenseRequestSchema.partial();
export type UpdateSoftwareLicenseRequest = z.infer<typeof updateSoftwareLicenseRequestSchema>;
