import { z } from "zod";
import { PII_PATTERN_KEYS } from "../data/piiPatterns";

export const PII_EMAIL_BLOCK_RULE_TYPES = ["PII_PATTERN"] as const;
export type PiiEmailBlockRuleType = (typeof PII_EMAIL_BLOCK_RULE_TYPES)[number];

export const createPiiEmailBlockRuleRequestSchema = z.object({
  ruleType: z.enum(PII_EMAIL_BLOCK_RULE_TYPES).default("PII_PATTERN"),
  value: z.enum(PII_PATTERN_KEYS),
  label: z.string().max(200).nullable().optional(),
});
export type CreatePiiEmailBlockRuleRequest = z.infer<typeof createPiiEmailBlockRuleRequestSchema>;

export const createPiiEmailBlockPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type CreatePiiEmailBlockPolicyRequest = z.infer<typeof createPiiEmailBlockPolicyRequestSchema>;

export const updatePiiEmailBlockPolicyRequestSchema = createPiiEmailBlockPolicyRequestSchema.partial();
export type UpdatePiiEmailBlockPolicyRequest = z.infer<typeof updatePiiEmailBlockPolicyRequestSchema>;

export const assignPiiEmailBlockRequestSchema = z.object({
  emailAddresses: z.array(z.string().trim().toLowerCase().email()).min(1).max(500),
});
export type AssignPiiEmailBlockRequest = z.infer<typeof assignPiiEmailBlockRequestSchema>;

// Public (unauthenticated) response the Outlook add-in fetches by the signed-in user's own
// email address (Office.js provides that directly, trusted from Outlook itself — no login
// flow needed for this lookup). Flat, deduped across every enabled policy assigned to that
// address, same "one combined declarative state" shape as Web Block/PII Data Blocking.
export const piiEmailBlockPolicyForUserResponseSchema = z.object({
  patternKeys: z.array(z.enum(PII_PATTERN_KEYS)),
});
export type PiiEmailBlockPolicyForUserResponse = z.infer<typeof piiEmailBlockPolicyForUserResponseSchema>;

export const PII_EMAIL_BLOCK_EVENT_ACTIONS = ["BLOCKED", "ALLOWED_WARNED"] as const;
export type PiiEmailBlockEventAction = (typeof PII_EMAIL_BLOCK_EVENT_ACTIONS)[number];

// Reported by the add-in after every send it evaluated — labels only (e.g. "Credit/debit
// card number"), never the matched text itself, since content never leaves the mail client.
export const piiEmailBlockEventReportSchema = z.object({
  senderEmail: z.string().trim().toLowerCase().email(),
  attachmentName: z.string().min(1).max(500),
  action: z.enum(PII_EMAIL_BLOCK_EVENT_ACTIONS),
  matchedCategoryLabels: z.array(z.string().max(200)).max(20),
});
export type PiiEmailBlockEventReport = z.infer<typeof piiEmailBlockEventReportSchema>;
