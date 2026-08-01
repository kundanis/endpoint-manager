import { z } from "zod";

export const WEB_BLOCK_RULE_TYPES = ["DOMAIN"] as const;
export type WebBlockRuleType = (typeof WEB_BLOCK_RULE_TYPES)[number];

export const createWebBlockRuleRequestSchema = z.object({
  ruleType: z.enum(WEB_BLOCK_RULE_TYPES).default("DOMAIN"),
  value: z.string().min(1).max(255), // a domain, e.g. "drive.google.com"
  label: z.string().max(200).nullable().optional(),
});
export type CreateWebBlockRuleRequest = z.infer<typeof createWebBlockRuleRequestSchema>;

export const updateWebBlockRuleRequestSchema = createWebBlockRuleRequestSchema.partial();
export type UpdateWebBlockRuleRequest = z.infer<typeof updateWebBlockRuleRequestSchema>;

export const createWebBlockPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type CreateWebBlockPolicyRequest = z.infer<typeof createWebBlockPolicyRequestSchema>;

export const updateWebBlockPolicyRequestSchema = createWebBlockPolicyRequestSchema.partial();
export type UpdateWebBlockPolicyRequest = z.infer<typeof updateWebBlockPolicyRequestSchema>;

export const assignWebBlockPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignWebBlockPolicyRequest = z.infer<typeof assignWebBlockPolicyRequestSchema>;

// Flat, deduped domain list across every enabled policy assigned to this agent — the agent
// applies ONE combined hosts-file block + ONE combined browser-policy list, not independent
// per-policy actions. policyIds lets the agent report back which policies contributed to
// this sync (for per-assignment lastSyncedAt/status tracking) without needing per-domain nesting.
export const assignedWebBlockResponseSchema = z.object({
  policyIds: z.array(z.string()),
  domains: z.array(z.string()),
});
export type AssignedWebBlockResponse = z.infer<typeof assignedWebBlockResponseSchema>;

export const webBlockSyncResultPayloadSchema = z.object({
  policyIds: z.array(z.string()),
  status: z.enum(["SUCCESS", "FAILED"]),
  errorMessage: z.string().nullable(),
});
export type WebBlockSyncResultPayload = z.infer<typeof webBlockSyncResultPayloadSchema>;
