import { z } from "zod";

// Identity Governance -> User Risk.

export const USER_RISK_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type UserRiskSeverity = (typeof USER_RISK_SEVERITIES)[number];

export const USER_RISK_ALERT_STATUSES = ["NEW", "INVESTIGATING", "CLOSED_TRUE", "CLOSED_FALSE"] as const;
export type UserRiskAlertStatus = (typeof USER_RISK_ALERT_STATUSES)[number];

// Activity types in the per-user stream.
export const USER_ACTIVITY_TYPES = [
  "SCREENSHOT",
  "SCREENSHOT_DELETED",
  "SCREENSHOT_OPENED",
  "USB_COPY",
  "CLOUD_COPY",
  "SHARE_COPY",
  "DLP_EVENT",
  "EMAIL_BLOCKED",
  "USB_DEVICE_BLOCKED",
  "APP_BLOCKED",
  "SCREENSHOT_BLOCKED",
  "COMMAND_BLOCKED",
  "EDR_DETECTION",
  "LOGON",
  // Windows signals (agent securitySignals.ts)
  "FAILED_LOGON",
  "ADMIN_GROUP_ADD",
  "LOG_CLEARED",
  "SECURITY_OFF",
  "SOFTWARE_INSTALLED",
  "FILES_DELETED",
] as const;
export type UserActivityType = (typeof USER_ACTIVITY_TYPES)[number];

export const userRiskRuleSettingSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(1).max(100000).optional(),
  points: z.number().int().min(0).max(100),
  severity: z.enum(USER_RISK_SEVERITIES),
});
export type UserRiskRuleSetting = z.infer<typeof userRiskRuleSettingSchema>;

export const userRiskSettingsSchema = z.object({
  // IANA zone used for working hours and "per day" counts, e.g. Asia/Kolkata.
  timezone: z.string().min(1).max(64),
  workStartHour: z.number().int().min(0).max(23),
  workEndHour: z.number().int().min(1).max(24),
  workDays: z.array(z.number().int().min(0).max(6)).max(7), // 0 = Sunday
  excludedUsers: z.array(z.string().min(1).max(200)).max(500),
  retentionDays: z.number().int().min(7).max(730),
  rules: z.record(z.string(), userRiskRuleSettingSchema),
  // Email senders (email blocking) as the same person as a Windows user. Automatic when the
  // names match ignoring dots and spaces; a manual link wins, and linking an address to itself
  // keeps it separate.
  autoLinkEmails: z.boolean().default(true),
  identityLinks: z.array(z.object({ email: z.string().trim().toLowerCase().email().max(320), userKey: z.string().trim().min(1).max(320) })).max(2000).default([]),
});
export type UserRiskSettings = z.infer<typeof userRiskSettingsSchema>;

export const updateUserRiskAlertRequestSchema = z
  .object({
    status: z.enum(USER_RISK_ALERT_STATUSES).optional(),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((d) => d.status || d.note, { message: "Nothing to update" });
export type UpdateUserRiskAlertRequest = z.infer<typeof updateUserRiskAlertRequestSchema>;
