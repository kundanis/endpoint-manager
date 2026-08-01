import { z } from "zod";

export const USB_CONTROL_RULE_TYPES = ["USB_SERIAL"] as const;
export type UsbControlRuleType = (typeof USB_CONTROL_RULE_TYPES)[number];

export const createUsbControlRuleRequestSchema = z.object({
  ruleType: z.enum(USB_CONTROL_RULE_TYPES).default("USB_SERIAL"),
  value: z.string().min(1).max(100), // the USB drive's serial number, as reported in its PNPDeviceID
  label: z.string().max(200).nullable().optional(),
});
export type CreateUsbControlRuleRequest = z.infer<typeof createUsbControlRuleRequestSchema>;

export const updateUsbControlRuleRequestSchema = createUsbControlRuleRequestSchema.partial();
export type UpdateUsbControlRuleRequest = z.infer<typeof updateUsbControlRuleRequestSchema>;

export const createUsbControlPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type CreateUsbControlPolicyRequest = z.infer<typeof createUsbControlPolicyRequestSchema>;

export const updateUsbControlPolicyRequestSchema = createUsbControlPolicyRequestSchema.partial();
export type UpdateUsbControlPolicyRequest = z.infer<typeof updateUsbControlPolicyRequestSchema>;

export const assignUsbControlPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignUsbControlPolicyRequest = z.infer<typeof assignUsbControlPolicyRequestSchema>;

// Flat, deduped serial whitelist across every enabled policy assigned to this agent — a
// device is allowed if its serial appears in ANY assigned policy's rule set (union, same
// shape as IP Block's combined address list). policyIds lets the agent report back which
// policies contributed, for per-assignment lastSyncedAt/status tracking.
export const assignedUsbControlResponseSchema = z.object({
  policyIds: z.array(z.string()),
  allowedSerials: z.array(z.string()),
});
export type AssignedUsbControlResponse = z.infer<typeof assignedUsbControlResponseSchema>;

export const usbControlEventPayloadSchema = z.object({
  serialNumber: z.string().max(100),
  deviceDescription: z.string().max(300).nullable(),
  action: z.literal("DISABLED"),
  occurredAt: z.string(),
});
export type UsbControlEventPayload = z.infer<typeof usbControlEventPayloadSchema>;

export const usbControlEventBatchPayloadSchema = z.object({
  events: z.array(usbControlEventPayloadSchema).max(200),
});
export type UsbControlEventBatchPayload = z.infer<typeof usbControlEventBatchPayloadSchema>;

export const usbControlSyncResultPayloadSchema = z.object({
  policyIds: z.array(z.string()),
  status: z.enum(["SUCCESS", "FAILED"]),
  errorMessage: z.string().nullable(),
});
export type UsbControlSyncResultPayload = z.infer<typeof usbControlSyncResultPayloadSchema>;
