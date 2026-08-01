import { z } from "zod";

// Alert-only just logs a match; Block additionally denies the write (Phase 2 — requires
// the native kernel-driver sidecar; a policy can be authored/assigned in BLOCK mode
// before that sidecar exists, it just has no teeth yet on an agent without one running).
export const DLP_ENFORCEMENT_MODES = ["ALERT_ONLY", "BLOCK"] as const;
export type DlpEnforcementMode = (typeof DLP_ENFORCEMENT_MODES)[number];

export const DLP_EVENT_ACTIONS = ["ALERTED", "BLOCKED"] as const;
export type DlpEventAction = (typeof DLP_EVENT_ACTIONS)[number];

// A DLP policy is a set of admin-authored rules, not a regulation checkbox — DLP
// detects whatever the admin actually cares about (project codenames, invoice number
// formats, specific destinations, specific identifiers), which is a different job
// from Data Discovery's regulation-scoped at-rest sweep. CONTENT_PATTERN is the one
// rule type that reuses Data Discovery's built-in identifier catalog, but it's picked
// per-rule (e.g. just "Aadhaar number"), not gated behind a DPDP/GDPR toggle.
export const DLP_RULE_TYPES = [
  "CONTENT_KEYWORD", // literal, case-insensitive substring — e.g. "Project Falcon"
  "CONTENT_REGEX", // admin-authored regex, trusted the same way custom PowerShell is elsewhere in this app
  "CONTENT_PATTERN", // one key from PII_PATTERN_KEYS (packages/shared/src/data/piiPatterns.ts)
  "BLOCKED_PATH", // destination path substring — write is blocked regardless of content
  "TRUSTED_PROCESS", // process image name — writes from this process are never inspected
  "FILE_EXTENSION", // if any FILE_EXTENSION rules exist on a policy, it only applies to writes with a matching extension
] as const;
export type DlpRuleType = (typeof DLP_RULE_TYPES)[number];

export const createDlpRuleRequestSchema = z.object({
  ruleType: z.enum(DLP_RULE_TYPES),
  // Keyword text, regex source, a PII_PATTERN_KEYS value, a path substring, a process
  // image name, or a file extension (e.g. ".csv") — meaning depends on ruleType.
  value: z.string().min(1).max(500),
  label: z.string().max(200).nullable().optional(),
});
export type CreateDlpRuleRequest = z.infer<typeof createDlpRuleRequestSchema>;

export const updateDlpRuleRequestSchema = createDlpRuleRequestSchema.partial();
export type UpdateDlpRuleRequest = z.infer<typeof updateDlpRuleRequestSchema>;

export const createDlpPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  enforcementMode: z.enum(DLP_ENFORCEMENT_MODES).default("ALERT_ONLY"),
  // The common DLP starting point (block exfil to USB) rather than every file write
  // everywhere, which is far more invasive and disruptive if something misfires.
  removableMediaOnly: z.boolean().default(true),
  enabled: z.boolean().default(true),
});
export type CreateDlpPolicyRequest = z.infer<typeof createDlpPolicyRequestSchema>;

export const updateDlpPolicyRequestSchema = createDlpPolicyRequestSchema.partial();
export type UpdateDlpPolicyRequest = z.infer<typeof updateDlpPolicyRequestSchema>;

export const assignDlpPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignDlpPolicyRequest = z.infer<typeof assignDlpPolicyRequestSchema>;

export const dlpRuleWireSchema = z.object({
  ruleId: z.string(),
  ruleType: z.enum(DLP_RULE_TYPES),
  value: z.string(),
});
export type DlpRuleWire = z.infer<typeof dlpRuleWireSchema>;

export const assignedDlpPolicyWireSchema = z.object({
  policyId: z.string(),
  enforcementMode: z.enum(DLP_ENFORCEMENT_MODES),
  removableMediaOnly: z.boolean(),
  rules: z.array(dlpRuleWireSchema),
});
export type AssignedDlpPolicyWire = z.infer<typeof assignedDlpPolicyWireSchema>;

// Reported by whatever is doing the actual inline enforcement (the Phase 2 native
// sidecar) — the Node.js agent only relays these, it never inspects file content
// itself. matchedRuleIds/maskedSamples follow the exact same "never the raw value"
// discipline as Data Discovery findings — a BLOCKED_PATH/TRUSTED_PROCESS/FILE_EXTENSION
// rule triggering has no content sample (maskedSamples just has no entry for it);
// only CONTENT_* rule matches carry a masked preview.
export const dlpEventPayloadSchema = z.object({
  policyId: z.string(),
  filePath: z.string().max(1000),
  processName: z.string().max(300).nullable(),
  destinationIsRemovable: z.boolean(),
  action: z.enum(DLP_EVENT_ACTIONS),
  matchedRuleIds: z.array(z.string()).max(20),
  maskedSamples: z.record(z.string(), z.array(z.string().max(200)).max(20)),
  occurredAt: z.string(),
});
export type DlpEventPayload = z.infer<typeof dlpEventPayloadSchema>;

// Batched, not one-per-request — events are asynchronous, real-time occurrences (not a
// periodic scan result), so the agent accumulates whatever fired since its last flush
// and reports them together.
export const dlpEventBatchPayloadSchema = z.object({
  events: z.array(dlpEventPayloadSchema).max(200),
});
export type DlpEventBatchPayload = z.infer<typeof dlpEventBatchPayloadSchema>;
