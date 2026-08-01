import { z } from "zod";
import { licenseModuleSchema, validityTypeSchema } from "@license/shared";

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
  maxAgents: z.number().int().positive(),
  validityType: validityTypeSchema,
  modules: z.array(licenseModuleSchema).min(1, "Select at least one module"),
});

export const resolveUnlockRequestSchema = z.object({
  resolutionNote: z.string().max(1000).optional(),
});
