import { z } from "zod";

export const createCommandTemplateRequestSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(500).optional(),
  shell: z.enum(["powershell", "cmd"]),
  script: z.string().min(1),
});
export type CreateCommandTemplateRequest = z.infer<typeof createCommandTemplateRequestSchema>;

export const updateCommandTemplateRequestSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(500).nullable().optional(),
  shell: z.enum(["powershell", "cmd"]).optional(),
  script: z.string().min(1).optional(),
});
export type UpdateCommandTemplateRequest = z.infer<typeof updateCommandTemplateRequestSchema>;

// Shared by template dispatch and both bulk quarantine/release routes — same
// at-least-one-target shape as dispatchCommandRequestSchema in command.schema.ts.
export const dispatchTargetRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type DispatchTargetRequest = z.infer<typeof dispatchTargetRequestSchema>;
