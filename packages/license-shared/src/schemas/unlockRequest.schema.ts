import { z } from "zod";

// Deliberately requires no proof of possession (no bindingToken) — this is precisely
// the recovery path for when that token is lost, mismatched, or was never received
// (e.g. the activation response never reached the caller). The lack of a cryptographic
// check is compensated by requiring manual vendor review before anything unlocks; see
// UnlockRequest.status in the License Server's own schema.
export const unlockRequestRequestSchema = z.object({
  keyString: z.string().min(1).max(64),
  deploymentId: z.string().min(1).max(100),
  reason: z.string().min(1).max(2000),
});
export type UnlockRequestRequest = z.infer<typeof unlockRequestRequestSchema>;

export const unlockRequestResponseSchema = z.object({
  status: z.literal("PENDING"),
});
export type UnlockRequestResponse = z.infer<typeof unlockRequestResponseSchema>;
