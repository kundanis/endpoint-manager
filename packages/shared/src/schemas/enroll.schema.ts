import { z } from "zod";

export const enrollRequestSchema = z.object({
  enrollmentToken: z.string().min(1),
  hostname: z.string().min(1),
  osPlatform: z.string().min(1),
  osVersion: z.string().min(1),
  osArch: z.string().min(1),
  agentVersion: z.string().min(1),
});
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;

export const enrollResponseSchema = z.object({
  agentId: z.string(),
  apiKey: z.string(),
});
export type EnrollResponse = z.infer<typeof enrollResponseSchema>;
