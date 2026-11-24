import { z } from "zod";

export const createAssetGroupRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  // The group above it (group hierarchy); none = a main group.
  parentId: z.string().min(1).max(64).nullable().optional(),
});
export type CreateAssetGroupRequest = z.infer<typeof createAssetGroupRequestSchema>;

export const updateAssetGroupRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  // Move under another group (null = make it a main group); absent = stays where it is.
  parentId: z.string().min(1).max(64).nullable().optional(),
});
export type UpdateAssetGroupRequest = z.infer<typeof updateAssetGroupRequestSchema>;

export const groupMembersRequestSchema = z.object({
  agentIds: z.array(z.string().min(1)).min(1),
});
export type GroupMembersRequest = z.infer<typeof groupMembersRequestSchema>;
