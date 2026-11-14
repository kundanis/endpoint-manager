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
  // Sold separately (also as its own edition): Microsoft Defender management + YARA threat
  // scanning. Not in the default module set, so existing keys don't include it.
  "THREAT_PROTECTION",
] as const;
export const licenseModuleSchema = z.enum(LICENSE_MODULES);
export type LicenseModule = z.infer<typeof licenseModuleSchema>;

// Which product a key is sold for. Both products gate features on the same
// LICENSE_MODULES keys above - Endpoint IQ just names them differently (Endpoint Hub,
// Network Insight, ...) - so the product is a record on the key, not part of the
// activate/revalidate wire contract, and any key still activates any deployment.
export const LICENSE_PRODUCTS = ["ENDPOINT_ONE", "ENDPOINT_IQ"] as const;
export const licenseProductSchema = z.enum(LICENSE_PRODUCTS);
export type LicenseProduct = z.infer<typeof licenseProductSchema>;
