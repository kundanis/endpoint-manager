import { z } from "zod";

export const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

// Mirrors the License Server's LICENSE_MODULES keys exactly (the same 6 product module
// boundaries) but is its own independent source of truth, not an import - same "never
// import runtime values across the licensing wire boundary" convention already used for
// every other per-module label map in this codebase (see console's RequireModule.tsx).
// A super admin implicitly has every one of these; grants only matter for a plain ADMIN.
export const ADMIN_MODULE_KEYS = [
  "ENDPOINT_MANAGER",
  "NETWORK_MANAGER",
  "SOFTWARE_MANAGER",
  "SECURITY_MANAGER",
  "DATA_MANAGER",
  "USER_MANAGER",
] as const;
export type AdminModuleKey = (typeof ADMIN_MODULE_KEYS)[number];

export const createAdminUserRequestSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(72),
  role: z.enum(ADMIN_ROLES).default("ADMIN"),
  // Ignored server-side when role is SUPER_ADMIN (they get everything) - still accepted
  // here rather than rejected, so a caller doesn't need to conditionally omit the field.
  moduleGrants: z.array(z.enum(ADMIN_MODULE_KEYS)).max(ADMIN_MODULE_KEYS.length).default([]),
});
export type CreateAdminUserRequest = z.infer<typeof createAdminUserRequestSchema>;

// Password is optional here - present only when resetting it, absent means "leave
// unchanged". Role/moduleGrants are each independently optional so a caller can update
// just one without resending the other.
export const updateAdminUserRequestSchema = z.object({
  role: z.enum(ADMIN_ROLES).optional(),
  moduleGrants: z.array(z.enum(ADMIN_MODULE_KEYS)).max(ADMIN_MODULE_KEYS.length).optional(),
  password: z.string().min(8).max(72).optional(),
});
export type UpdateAdminUserRequest = z.infer<typeof updateAdminUserRequestSchema>;
