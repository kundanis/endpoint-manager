import { z } from "zod";
import { licenseModuleSchema, validityTypeSchema } from "./common.schema";

// Called periodically (not per-agent-enrollment) by an already-activated deployment to
// confirm its license hasn't been revoked/expired centrally, and to pick up any change
// the vendor made (e.g. a raised agent cap). Requires the bindingToken issued at
// activation time as proof of possession — the keyString alone is not enough once a
// key has moved past ISSUED, since it's already locked to one deployment.
export const revalidateRequestSchema = z.object({
  keyString: z.string().min(1).max(64),
  deploymentId: z.string().min(1).max(100),
  bindingToken: z.string().min(1),
});
export type RevalidateRequest = z.infer<typeof revalidateRequestSchema>;

export const revalidateResponseSchema = z.object({
  status: z.enum(["ACTIVATED", "REVOKED"]),
  maxAgents: z.number().int().positive(),
  validityType: validityTypeSchema,
  validUntil: z.string().nullable(),
  modules: z.array(licenseModuleSchema),
});
export type RevalidateResponse = z.infer<typeof revalidateResponseSchema>;
