import { z } from "zod";

// Spans every EPM module plus DLP — a policy type this exception can apply to. Mirrors the
// LICENSE_MODULES style of fixed string enum rather than a live cross-table FK, since a
// single column can't hold a foreign key into six different, unrelated policy tables.
export const POLICY_ACCESS_EXCEPTION_TYPES = [
  "APP_CONTROL",
  "WEB_BLOCK",
  "COMMAND_BLOCK",
  "IP_BLOCK",
  "USB_CONTROL",
  "DLP",
] as const;
export type PolicyAccessExceptionType = (typeof POLICY_ACCESS_EXCEPTION_TYPES)[number];

export const createPolicyAccessExceptionRequestSchema = z.object({
  policyType: z.enum(POLICY_ACCESS_EXCEPTION_TYPES),
  policyId: z.string().min(1),
  agentId: z.string().min(1),
  reason: z.string().min(1).max(1000),
  durationMinutes: z.number().int().positive().max(10080), // capped at 7 days
});
export type CreatePolicyAccessExceptionRequest = z.infer<typeof createPolicyAccessExceptionRequestSchema>;

export const resolvePolicyAccessExceptionRequestSchema = z.object({
  resolutionNote: z.string().max(1000).nullable().optional(),
});
export type ResolvePolicyAccessExceptionRequest = z.infer<typeof resolvePolicyAccessExceptionRequestSchema>;
