import { z } from "zod";

// Windows signals the agent reads for Identity Governance -> User Risk: failed sign-ins, users
// added to local Administrators, cleared event logs, antivirus / firewall switched off, newly
// installed software and bursts of file deletions. They go straight into the User Risk activity
// stream (UserActivityEvent), not a table of their own.

export const SECURITY_SIGNAL_TYPES = ["FAILED_LOGON", "ADMIN_GROUP_ADD", "LOG_CLEARED", "SECURITY_OFF", "SOFTWARE_INSTALLED", "FILES_DELETED"] as const;
export type SecuritySignalType = (typeof SECURITY_SIGNAL_TYPES)[number];

export const securitySignalSchema = z.object({
  key: z.string().min(1).max(100), // unique per endpoint, e.g. "Security:123456" - re-sends are ignored
  type: z.enum(SECURITY_SIGNAL_TYPES),
  occurredAt: z.string(),
  username: z.string().max(300).nullable(), // null = whoever was signed in at the time
  summary: z.string().max(500),
  detail: z.record(z.string(), z.unknown()),
});
export type SecuritySignal = z.infer<typeof securitySignalSchema>;

export const securitySignalsPayloadSchema = z.object({
  signals: z.array(securitySignalSchema).max(1000),
});
export type SecuritySignalsPayload = z.infer<typeof securitySignalsPayloadSchema>;
