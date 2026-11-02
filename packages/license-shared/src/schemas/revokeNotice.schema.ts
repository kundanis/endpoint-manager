import { z } from "zod";

// Once activated, a deployment never polls the License Server again - its license stays
// valid offline indefinitely (until validUntil). Revocation instead flows the other way:
// the License Server pushes a revoke notice to the deployment. For that the deployment
// registers where it can be reached, proving possession of its binding (same proof as
// /revalidate), and gets back the secret the License Server will present on that notice.
export const registerCallbackRequestSchema = z.object({
  keyString: z.string().min(1).max(64),
  deploymentId: z.string().min(1).max(100),
  bindingToken: z.string().min(1),
  // Base URLs of the deployment's server, tried in order (e.g. web URL, public IP, LAN).
  callbackUrls: z
    .array(z.string().url().max(500).refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL"))
    .min(1)
    .max(5),
});
export type RegisterCallbackRequest = z.infer<typeof registerCallbackRequestSchema>;

export const registerCallbackResponseSchema = z.object({
  revocationSecret: z.string(),
  // REVOKED when the key was revoked before the deployment registered - there was nowhere
  // to send the notice then, so this response is the notice.
  status: z.enum(["ACTIVATED", "REVOKED"]),
});
export type RegisterCallbackResponse = z.infer<typeof registerCallbackResponseSchema>;

// What the License Server POSTs to {callbackUrl}/api/license-callback/revoke.
export const revokeNoticeRequestSchema = z.object({
  deploymentId: z.string().min(1).max(100),
  revocationSecret: z.string().min(1).max(200),
});
export type RevokeNoticeRequest = z.infer<typeof revokeNoticeRequestSchema>;

export const REVOKE_NOTICE_PATH = "/api/license-callback/revoke";
