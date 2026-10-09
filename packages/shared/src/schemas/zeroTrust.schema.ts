import { z } from "zod";
import { SECURITY_RULE_OPERATORS } from "./securityConfig.schema";

// Reuses the same operator vocabulary as Security Configuration rules — grading
// semantics are identical (agent runs a check, server grades the raw value against
// expectedValue). Zero Trust is a separate module (policy → device-trust verdict)
// rather than a benchmark, but there's no reason to invent a second operator enum.
export const createZeroTrustPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  // Paused (false) policies are skipped entirely when the server resolves what an
  // agent should scan — no findings are produced for them and they don't affect
  // any device's trust verdict while paused.
  enabled: z.boolean().default(true),
});
export type CreateZeroTrustPolicyRequest = z.infer<typeof createZeroTrustPolicyRequestSchema>;

export const updateZeroTrustPolicyRequestSchema = createZeroTrustPolicyRequestSchema.partial();
export type UpdateZeroTrustPolicyRequest = z.infer<typeof updateZeroTrustPolicyRequestSchema>;

export const createZeroTrustConditionRequestSchema = z.object({
  conditionKey: z.string().min(1).max(50),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).nullable().optional(),
  checkPowerShell: z.string().min(1),
  operator: z.enum(SECURITY_RULE_OPERATORS),
  expectedValue: z.string().max(500),
  // Disabled conditions are excluded from what the agent fetches to check, and
  // don't count toward the device's trust verdict — a way to temporarily retire
  // a check without losing its authored definition/history.
  enabled: z.boolean().default(true),
});
export type CreateZeroTrustConditionRequest = z.infer<typeof createZeroTrustConditionRequestSchema>;

export const updateZeroTrustConditionRequestSchema = createZeroTrustConditionRequestSchema.partial();
export type UpdateZeroTrustConditionRequest = z.infer<typeof updateZeroTrustConditionRequestSchema>;

export const assignZeroTrustPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignZeroTrustPolicyRequest = z.infer<typeof assignZeroTrustPolicyRequestSchema>;

// Deliberately excludes operator/expectedValue — grading happens server-side on
// ingestion, same reasoning as the Security Configuration agent wire schema.
export const assignedZeroTrustConditionWireSchema = z.object({
  conditionId: z.string(),
  checkPowerShell: z.string(),
});
export type AssignedZeroTrustConditionWire = z.infer<typeof assignedZeroTrustConditionWireSchema>;

export const assignedZeroTrustPolicyWireSchema = z.object({
  policyId: z.string(),
  conditions: z.array(assignedZeroTrustConditionWireSchema),
});
export type AssignedZeroTrustPolicyWire = z.infer<typeof assignedZeroTrustPolicyWireSchema>;

export const zeroTrustScanResultItemSchema = z.object({
  conditionId: z.string(),
  actualValue: z.string().max(2000).nullable(),
  error: z.string().max(1000).nullable(),
});
export type ZeroTrustScanResultItem = z.infer<typeof zeroTrustScanResultItemSchema>;

export const zeroTrustScanResultPayloadSchema = z.object({
  scannedAt: z.string(),
  policyId: z.string(),
  results: z.array(zeroTrustScanResultItemSchema).max(500),
});
export type ZeroTrustScanResultPayload = z.infer<typeof zeroTrustScanResultPayloadSchema>;

// Bulk override: force specific conditionKeys to stop counting against selected devices'
// compliance verdict, regardless of real posture (e.g. a known false positive while a fix
// rolls out). Deliberately the only surface this concept exists on anywhere in the product —
// see zeroTrustOverride.service.ts.
export const zeroTrustOverrideBulkRequestSchema = z.object({
  agentIds: z.array(z.string().min(1)).min(1),
  conditionKeys: z.array(z.string().min(1)).min(1),
});
export type ZeroTrustOverrideBulkRequest = z.infer<typeof zeroTrustOverrideBulkRequestSchema>;
