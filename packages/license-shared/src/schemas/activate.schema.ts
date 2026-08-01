import { z } from "zod";
import { licenseModuleSchema, validityTypeSchema } from "./common.schema";

// The License Server's public, rate-limited activation endpoint — called once by an
// Endpoint Manager install to redeem a key. Deliberately minimal: no admin auth, since
// the calling deployment has no prior relationship with this server yet — the key
// itself IS the credential.
export const activateRequestSchema = z.object({
  keyString: z.string().min(1).max(64),
  // Generated once by the calling deployment and persisted locally — identifies WHICH
  // install redeemed the key, distinct from any admin/agent identity on that side.
  deploymentId: z.string().min(1).max(100),
});
export type ActivateRequest = z.infer<typeof activateRequestSchema>;

export const activateResponseSchema = z.object({
  entityName: z.string(),
  maxAgents: z.number().int().positive(),
  validityType: validityTypeSchema,
  validUntil: z.string().nullable(), // null for PERPETUAL
  // Which top-level console modules this license unlocks — see common.schema.ts.
  modules: z.array(licenseModuleSchema),
  // Returned exactly once, in plaintext — the License Server never stores this value
  // itself, only its hash, and can never show it again after this response.
  bindingToken: z.string(),
});
export type ActivateResponse = z.infer<typeof activateResponseSchema>;
