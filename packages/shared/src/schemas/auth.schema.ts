import { z } from "zod";

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const createEnrollmentTokenRequestSchema = z.object({
  label: z.string().min(1),
  expiresInDays: z.number().int().positive().max(365),
  usesRemaining: z.number().int().positive().max(10000),
  // Optional - when set, every agent that enrolls with this token is automatically added
  // to this group. Omitted/null means no auto-assignment.
  groupId: z.string().min(1).optional(),
});
export type CreateEnrollmentTokenRequest = z.infer<typeof createEnrollmentTokenRequestSchema>;

// "Install on endpoint" from the Enrollment Tokens page (and Network Scan's discovered
// hosts) - the server reaches out to each target over PowerShell Remoting (WinRM) itself,
// rather than an admin manually copying the installer and double-clicking it on every
// machine. username/password are the credential used to reach the targets (domain or local
// admin on them) - never persisted anywhere (see remoteInstall.service.ts), only ever
// passed through to the one PowerShell invocation that needs them. 50-target cap keeps one
// job from fanning out an unbounded number of concurrent WinRM sessions from the server.
//
// enrollmentToken is optional: the Enrollment Tokens page passes the plaintext value it just
// showed once at creation, but a caller with no token in hand (Network Scan's per-host
// "Install agent" button - there's no token creation step in that flow at all) can omit it
// and the service mints a short-lived, single-use one internally instead. tokenId, when
// given, is purely for attributing the job back to a token for display - never required to
// actually run the install.
export const startRemoteInstallRequestSchema = z.object({
  tokenId: z.string().min(1).optional(),
  enrollmentToken: z.string().min(1).optional(),
  serverUrl: z.string().min(1),
  targets: z.array(z.string().min(1)).min(1).max(50),
  username: z.string().min(1),
  password: z.string().min(1),
});
export type StartRemoteInstallRequest = z.infer<typeof startRemoteInstallRequestSchema>;
