import { z } from "zod";
import { MAX_COMMAND_OUTPUT_BYTES, MAX_COMMAND_TIMEOUT_SEC } from "../constants";

export const dispatchCommandRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
    // bash/sh target Linux agents, powershell/cmd target Windows agents — dispatch itself
    // doesn't filter by the target's osPlatform (same as every other task type), so picking
    // the wrong shell for a mixed-OS group just fails that subset's tasks with a clear
    // "spawn ENOENT" rather than silently no-oping.
    shell: z.enum(["powershell", "cmd", "bash", "sh"]),
    script: z.string().min(1),
    timeoutSec: z.number().int().positive().max(MAX_COMMAND_TIMEOUT_SEC),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type DispatchCommandRequest = z.infer<typeof dispatchCommandRequestSchema>;

export const commandTaskResultPayloadSchema = z.object({
  status: z.enum(["SUCCESS", "FAILED", "TIMEOUT"]),
  exitCode: z.number().int().nullable(),
  stdout: z.string().max(MAX_COMMAND_OUTPUT_BYTES),
  stderr: z.string().max(MAX_COMMAND_OUTPUT_BYTES),
  startedAt: z.string(),
  completedAt: z.string(),
});
export type CommandTaskResultPayload = z.infer<typeof commandTaskResultPayloadSchema>;
