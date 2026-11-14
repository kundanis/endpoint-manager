import { z } from "zod";

export const setUninstallPasswordRequestSchema = z.object({
  password: z.string().min(8).max(200),
});
export type SetUninstallPasswordRequest = z.infer<typeof setUninstallPasswordRequestSchema>;

export const verifyUninstallPasswordRequestSchema = z.object({
  password: z.string().max(200),
});
export type VerifyUninstallPasswordRequest = z.infer<typeof verifyUninstallPasswordRequestSchema>;

// Remote install account (Asset settings): the Windows admin account Install agent uses so admins
// don't type it each time. Leave password out to keep the saved one (change the username only).
export const setRemoteInstallAccountRequestSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500).optional(),
});
export type SetRemoteInstallAccountRequest = z.infer<typeof setRemoteInstallAccountRequestSchema>;

export const agentSecurityStatusSchema = z.object({
  uninstallProtectionEnabled: z.boolean(),
  updatedAt: z.string().nullable(),
  // The saved remote install account's username (never the password); null when none is saved.
  remoteInstallUsername: z.string().nullable(),
});
export type AgentSecurityStatus = z.infer<typeof agentSecurityStatusSchema>;
