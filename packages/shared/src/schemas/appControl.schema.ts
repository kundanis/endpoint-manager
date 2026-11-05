import { z } from "zod";

// EXECUTABLE also matches a renamed copy by the original file name stored inside the program;
// PRODUCT and PUBLISHER match what is stored inside / signed onto the program, so they survive
// renames and new versions.
export const APP_CONTROL_RULE_TYPES = ["EXTENSION", "EXECUTABLE", "PRODUCT", "PUBLISHER"] as const;
export type AppControlRuleType = (typeof APP_CONTROL_RULE_TYPES)[number];

export const createAppControlRuleRequestSchema = z.object({
  ruleType: z.enum(APP_CONTROL_RULE_TYPES),
  // EXTENSION: e.g. ".vbs" (blocked as a Script-collection SRP path rule "*.vbs").
  // EXECUTABLE: a filename (e.g. "utorrent.exe") or full path.
  // PRODUCT: the product name inside the program (e.g. "AnyDesk"); * wildcards allowed.
  // PUBLISHER: the company the program is signed by or names (e.g. "AnyDesk Software GmbH").
  value: z.string().min(1).max(500),
  label: z.string().max(200).nullable().optional(),
});
export type CreateAppControlRuleRequest = z.infer<typeof createAppControlRuleRequestSchema>;

export const updateAppControlRuleRequestSchema = createAppControlRuleRequestSchema.partial();
export type UpdateAppControlRuleRequest = z.infer<typeof updateAppControlRuleRequestSchema>;

export const createAppControlPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type CreateAppControlPolicyRequest = z.infer<typeof createAppControlPolicyRequestSchema>;

export const updateAppControlPolicyRequestSchema = createAppControlPolicyRequestSchema.partial();
export type UpdateAppControlPolicyRequest = z.infer<typeof updateAppControlPolicyRequestSchema>;

export const assignAppControlPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignAppControlPolicyRequest = z.infer<typeof assignAppControlPolicyRequestSchema>;

export const appControlRuleWireSchema = z.object({
  ruleId: z.string(),
  ruleType: z.enum(APP_CONTROL_RULE_TYPES),
  value: z.string(),
});
export type AppControlRuleWire = z.infer<typeof appControlRuleWireSchema>;

// Flat, deduped across every policy assigned to this agent — enforcement is one combined
// SRP registry state, not independent per-policy actions (no per-policy enforcement
// parameters like DLP's enforcementMode exist here), so there's no need for per-policy nesting.
export const assignedAppControlResponseSchema = z.object({
  rules: z.array(appControlRuleWireSchema),
});
export type AssignedAppControlResponse = z.infer<typeof assignedAppControlResponseSchema>;

// ruleId is nullable - an event can't always be matched back to the rule that caused it.
export const appControlEventPayloadSchema = z.object({
  ruleId: z.string().nullable(),
  matchedPath: z.string().max(1000).nullable(),
  processName: z.string().max(300).nullable(),
  occurredAt: z.string(),
});
export type AppControlEventPayload = z.infer<typeof appControlEventPayloadSchema>;

export const appControlScanResultPayloadSchema = z.object({
  status: z.enum(["APPLIED", "FAILED"]),
  errorMessage: z.string().nullable(),
  events: z.array(appControlEventPayloadSchema).max(200),
});
export type AppControlScanResultPayload = z.infer<typeof appControlScanResultPayloadSchema>;
