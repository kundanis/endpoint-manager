import { z } from "zod";

export const setUninstallPasswordRequestSchema = z.object({
  password: z.string().min(8).max(200),
});
export type SetUninstallPasswordRequest = z.infer<typeof setUninstallPasswordRequestSchema>;

export const verifyUninstallPasswordRequestSchema = z.object({
  password: z.string().max(200),
});
export type VerifyUninstallPasswordRequest = z.infer<typeof verifyUninstallPasswordRequestSchema>;

export const agentSecurityStatusSchema = z.object({
  uninstallProtectionEnabled: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type AgentSecurityStatus = z.infer<typeof agentSecurityStatusSchema>;
