import { z } from "zod";
import { licenseFeatureListSchema, licenseModuleSchema, licenseProductSchema, validityTypeSchema } from "@license/shared";

// Admin-console-facing request shapes. Deliberately NOT part of @license/shared —
// that package is the cross-system wire contract between License Server and each
// Endpoint Manager deployment; these shapes are internal to this admin console only.

export const createEntityRequestSchema = z.object({
  name: z.string().min(1).max(200),
  contactEmail: z.string().email().optional(),
});

export const updateEntityRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  contactEmail: z.string().email().nullable().optional(),
});

export const issueLicenseKeyRequestSchema = z.object({
  entityId: z.string().uuid(),
  product: licenseProductSchema.default("ENDPOINT_ONE"),
  maxAgents: z.number().int().positive(),
  validityType: validityTypeSchema,
  modules: z.array(licenseModuleSchema).min(1, "Select at least one module"),
  // Features within the modules; null or absent = everything in them.
  features: licenseFeatureListSchema.optional(),
});

// A change to an activated key, pushed to its deployment to accept or reject.
export const createChangeRequestRequestSchema = z.object({
  modules: z.array(licenseModuleSchema).min(1, "Select at least one module"),
  features: licenseFeatureListSchema.optional(),
  maxAgents: z.number().int().positive(),
  validUntil: z.string().datetime().nullable(), // null = perpetual
  message: z.string().max(1000).optional(),
});

export const createAdminRequestSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
});

export const changeAdminPasswordRequestSchema = z.object({
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
  otp: z.string().min(1, "Enter the OTP").max(20),
});

export const resolveUnlockRequestSchema = z.object({
  resolutionNote: z.string().max(1000).optional(),
});
