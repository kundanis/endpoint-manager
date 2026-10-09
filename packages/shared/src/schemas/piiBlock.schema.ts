import { z } from "zod";
import { PII_PATTERN_KEYS } from "../data/piiPatterns";

// A single rule type — a rule's value is always one key from PII_PATTERN_KEYS (the same
// catalog Data Discovery and DLP's CONTENT_PATTERN rule type already use), not free text.
export const PII_BLOCK_RULE_TYPES = ["PII_PATTERN"] as const;
export type PiiBlockRuleType = (typeof PII_BLOCK_RULE_TYPES)[number];

export const createPiiBlockRuleRequestSchema = z.object({
  ruleType: z.enum(PII_BLOCK_RULE_TYPES).default("PII_PATTERN"),
  value: z.enum(PII_PATTERN_KEYS),
  label: z.string().max(200).nullable().optional(),
});
export type CreatePiiBlockRuleRequest = z.infer<typeof createPiiBlockRuleRequestSchema>;

export const createPiiBlockPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type CreatePiiBlockPolicyRequest = z.infer<typeof createPiiBlockPolicyRequestSchema>;

export const updatePiiBlockPolicyRequestSchema = createPiiBlockPolicyRequestSchema.partial();
export type UpdatePiiBlockPolicyRequest = z.infer<typeof updatePiiBlockPolicyRequestSchema>;

export const assignPiiBlockPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignPiiBlockPolicyRequest = z.infer<typeof assignPiiBlockPolicyRequestSchema>;

// Flat, deduped PII category list across every enabled policy assigned to this agent — same
// "one combined declarative state, not independent per-policy actions" shape as Web Block's
// AssignedWebBlockResponse. policyIds lets the agent report back which policies contributed
// to this sync (for per-assignment lastSyncedAt/status tracking) without per-category nesting.
export const assignedPiiBlockResponseSchema = z.object({
  policyIds: z.array(z.string()),
  patternKeys: z.array(z.enum(PII_PATTERN_KEYS)),
});
export type AssignedPiiBlockResponse = z.infer<typeof assignedPiiBlockResponseSchema>;

export const piiBlockSyncResultPayloadSchema = z.object({
  policyIds: z.array(z.string()),
  status: z.enum(["SUCCESS", "FAILED"]),
  errorMessage: z.string().nullable(),
});
export type PiiBlockSyncResultPayload = z.infer<typeof piiBlockSyncResultPayloadSchema>;
