import { z } from "zod";

// COMMAND_PATTERN: value is a regex matched against a process's full command line - the
// most powerful option, and the one with the most false-positive risk if written too
// broadly. EXACT_COMMAND_LINE/PROCESS_NAME are lower-risk, precise alternatives for when an
// admin knows exactly what they want to match and doesn't need (or want) regex power.
export const COMMAND_BLOCK_RULE_TYPES = ["COMMAND_PATTERN", "EXACT_COMMAND_LINE", "PROCESS_NAME"] as const;
export type CommandBlockRuleType = (typeof COMMAND_BLOCK_RULE_TYPES)[number];

// Same two-mode shape as DLP's enforcementMode. New policies default to ALERT_ONLY - a
// fresh rule logs matches as events without killing anything until an admin has reviewed
// them and deliberately flips the policy to BLOCK. (The underlying DB column defaults
// existing/pre-existing rows to BLOCK instead - see schema.prisma comment - so this
// zod-level default only ever applies to newly created policies, never silently changes
// the behavior of one that already exists.)
export const COMMAND_BLOCK_ENFORCEMENT_MODES = ["ALERT_ONLY", "BLOCK"] as const;
export type CommandBlockEnforcementMode = (typeof COMMAND_BLOCK_ENFORCEMENT_MODES)[number];

export const createCommandBlockRuleRequestSchema = z.object({
  ruleType: z.enum(COMMAND_BLOCK_RULE_TYPES).default("COMMAND_PATTERN"),
  value: z.string().min(1).max(500),
  label: z.string().max(200).nullable().optional(),
});
export type CreateCommandBlockRuleRequest = z.infer<typeof createCommandBlockRuleRequestSchema>;

export const updateCommandBlockRuleRequestSchema = createCommandBlockRuleRequestSchema.partial();
export type UpdateCommandBlockRuleRequest = z.infer<typeof updateCommandBlockRuleRequestSchema>;

export const createCommandBlockPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().default(true),
  enforcementMode: z.enum(COMMAND_BLOCK_ENFORCEMENT_MODES).default("ALERT_ONLY"),
});
export type CreateCommandBlockPolicyRequest = z.infer<typeof createCommandBlockPolicyRequestSchema>;

export const updateCommandBlockPolicyRequestSchema = createCommandBlockPolicyRequestSchema.partial();
export type UpdateCommandBlockPolicyRequest = z.infer<typeof updateCommandBlockPolicyRequestSchema>;

export const assignCommandBlockPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignCommandBlockPolicyRequest = z.infer<typeof assignCommandBlockPolicyRequestSchema>;

export const commandBlockRuleWireSchema = z.object({
  ruleId: z.string(),
  ruleType: z.enum(COMMAND_BLOCK_RULE_TYPES),
  pattern: z.string(),
  // Carried per-rule, not once for the whole response - rules from different assigned
  // policies can be flattened together with different modes. See
  // commandBlockScan.service.ts for how a duplicate value across two policies resolves.
  enforcementMode: z.enum(COMMAND_BLOCK_ENFORCEMENT_MODES),
});
export type CommandBlockRuleWire = z.infer<typeof commandBlockRuleWireSchema>;

// Flat, deduped across every enabled policy assigned to this agent — each rule is
// independently enforced (unlike webBlock's merged-domain-list, each match here is
// individually attributable to the rule that fired), so no per-policy nesting is needed.
export const assignedCommandBlockResponseSchema = z.object({
  rules: z.array(commandBlockRuleWireSchema),
});
export type AssignedCommandBlockResponse = z.infer<typeof assignedCommandBlockResponseSchema>;

export const COMMAND_BLOCK_EVENT_ACTIONS = ["ALERTED", "BLOCKED"] as const;
export type CommandBlockEventAction = (typeof COMMAND_BLOCK_EVENT_ACTIONS)[number];

// matchedCommandLine is stored unmasked, unlike DLP's masked-sample discipline — here the
// full command line IS the audit signal an admin needs to understand what was blocked and
// tune the rule, not incidental personal data. (Can occasionally contain a secret, e.g. a
// password on a `net use` command — worth the admin's awareness.)
export const commandBlockEventPayloadSchema = z.object({
  ruleId: z.string(),
  matchedCommandLine: z.string().max(2000),
  processName: z.string().max(300).nullable(),
  action: z.enum(COMMAND_BLOCK_EVENT_ACTIONS),
  occurredAt: z.string(),
});
export type CommandBlockEventPayload = z.infer<typeof commandBlockEventPayloadSchema>;

export const commandBlockEventBatchPayloadSchema = z.object({
  events: z.array(commandBlockEventPayloadSchema).max(200),
});
export type CommandBlockEventBatchPayload = z.infer<typeof commandBlockEventBatchPayloadSchema>;
