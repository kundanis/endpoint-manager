import { z } from "zod";

export const VALIDITY_TYPES = ["ONE_YEAR", "TWO_YEAR", "THREE_YEAR", "PERPETUAL"] as const;
export const validityTypeSchema = z.enum(VALIDITY_TYPES);
export type ValidityType = z.infer<typeof validityTypeSchema>;

export const LICENSE_KEY_STATUSES = ["ISSUED", "ACTIVATED", "REVOKED"] as const;
export const licenseKeyStatusSchema = z.enum(LICENSE_KEY_STATUSES);
export type LicenseKeyStatus = z.infer<typeof licenseKeyStatusSchema>;

// Matches Endpoint Manager's top-level nav modules exactly (packages/console/src/
// navConfig.ts) - Dashboard and Licensing itself are deliberately not in this list,
// since both stay accessible regardless of which modules a license includes.
export const LICENSE_MODULES = [
  "ENDPOINT_MANAGER",
  "NETWORK_MANAGER",
  "SOFTWARE_MANAGER",
  "SECURITY_MANAGER",
  "DATA_MANAGER",
  "USER_MANAGER",
] as const;
export const licenseModuleSchema = z.enum(LICENSE_MODULES);
export type LicenseModule = z.infer<typeof licenseModuleSchema>;
