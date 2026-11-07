import { z } from "zod";
import { PII_PATTERN_KEYS } from "../data/piiPatterns";

// PII_PATTERN: a personal-data category to check for (value is a PiiPatternKey).
// TRUSTED_DOMAIN: a recipient email domain (e.g. "company.com", subdomains included). When every
// recipient of an email is on a trusted domain, nothing in it is checked - mail within the
// organization is never stopped. One recipient outside is enough for the normal checks to run.
export const PII_EMAIL_BLOCK_RULE_TYPES = ["PII_PATTERN", "TRUSTED_DOMAIN"] as const;
export type PiiEmailBlockRuleType = (typeof PII_EMAIL_BLOCK_RULE_TYPES)[number];

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// "@Company.com", "*.company.com" and "company.com" are all stored as "company.com".
export function normalizeTrustedDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\*\./, "").replace(/^@/, "").replace(/\.$/, "");
}

export const createPiiEmailBlockRuleRequestSchema = z
  .object({
    ruleType: z.enum(PII_EMAIL_BLOCK_RULE_TYPES).default("PII_PATTERN"),
    value: z.string().trim().min(1).max(255),
    label: z.string().max(200).nullable().optional(),
  })
  .transform((r) => (r.ruleType === "TRUSTED_DOMAIN" ? { ...r, value: normalizeTrustedDomain(r.value) } : r))
  .superRefine((r, ctx) => {
    if (r.ruleType === "PII_PATTERN" && !(PII_PATTERN_KEYS as readonly string[]).includes(r.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Unknown PII category." });
    }
    if (r.ruleType === "TRUSTED_DOMAIN" && !DOMAIN_RE.test(r.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Enter a domain such as company.com." });
    }
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
  // Recipient domains that skip the checks (see TRUSTED_DOMAIN above).
  trustedDomains: z.array(z.string()),
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
