import { z } from "zod";

export const createAssetGroupRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
});
export type CreateAssetGroupRequest = z.infer<typeof createAssetGroupRequestSchema>;

export const updateAssetGroupRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
});
export type UpdateAssetGroupRequest = z.infer<typeof updateAssetGroupRequestSchema>;

export const groupMembersRequestSchema = z.object({
  agentIds: z.array(z.string().min(1)).min(1),
});
export type GroupMembersRequest = z.infer<typeof groupMembersRequestSchema>;
