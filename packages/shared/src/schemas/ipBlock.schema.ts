import { z } from "zod";

export const IP_BLOCK_RULE_TYPES = ["IP_ADDRESS"] as const;
export type IpBlockRuleType = (typeof IP_BLOCK_RULE_TYPES)[number];

// A single IPv4/IPv6 address, or CIDR notation (e.g. "203.0.113.0/24") to block a whole
// range — permissive on purpose (full IPv6/CIDR validation is genuinely fiddly); a value
// Windows Firewall itself rejects at apply time surfaces as a FAILED sync, same as any
// other agent-side apply failure in this module.
const IP_OR_CIDR_PATTERN = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

export const createIpBlockRuleRequestSchema = z.object({
  ruleType: z.enum(IP_BLOCK_RULE_TYPES).default("IP_ADDRESS"),
  value: z.string().min(1).max(64).regex(IP_OR_CIDR_PATTERN, "Must be an IP address or CIDR range"),
  label: z.string().max(200).nullable().optional(),
});
export type CreateIpBlockRuleRequest = z.infer<typeof createIpBlockRuleRequestSchema>;

export const updateIpBlockRuleRequestSchema = createIpBlockRuleRequestSchema.partial();
export type UpdateIpBlockRuleRequest = z.infer<typeof updateIpBlockRuleRequestSchema>;

export const createIpBlockPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type CreateIpBlockPolicyRequest = z.infer<typeof createIpBlockPolicyRequestSchema>;

export const updateIpBlockPolicyRequestSchema = createIpBlockPolicyRequestSchema.partial();
export type UpdateIpBlockPolicyRequest = z.infer<typeof updateIpBlockPolicyRequestSchema>;

export const assignIpBlockPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignIpBlockPolicyRequest = z.infer<typeof assignIpBlockPolicyRequestSchema>;

// Flat, deduped address list across every enabled policy assigned to this agent — the
// agent applies ONE combined pair of firewall rules (inbound+outbound), not independent
// per-policy rules. policyIds lets the agent report back which policies contributed to
// this sync (for per-assignment lastSyncedAt/status tracking) without per-address nesting.
export const assignedIpBlockResponseSchema = z.object({
  policyIds: z.array(z.string()),
  addresses: z.array(z.string()),
});
export type AssignedIpBlockResponse = z.infer<typeof assignedIpBlockResponseSchema>;

export const ipBlockSyncResultPayloadSchema = z.object({
  policyIds: z.array(z.string()),
  status: z.enum(["SUCCESS", "FAILED"]),
  errorMessage: z.string().nullable(),
});
export type IpBlockSyncResultPayload = z.infer<typeof ipBlockSyncResultPayloadSchema>;
