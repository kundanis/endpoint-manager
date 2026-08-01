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
