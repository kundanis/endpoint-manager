import { z } from "zod";

export const createNetworkVlanRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  cidr: z.string().min(1).max(50),
  assignedAgentId: z.string().min(1).optional(), // omitted = server-side
  enabled: z.boolean().default(true),
});
export type CreateNetworkVlanRequest = z.infer<typeof createNetworkVlanRequestSchema>;

export const updateNetworkVlanRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  cidr: z.string().min(1).max(50).optional(),
  assignedAgentId: z.string().min(1).nullable().optional(), // explicit null clears assignment
  enabled: z.boolean().optional(),
});
export type UpdateNetworkVlanRequest = z.infer<typeof updateNetworkVlanRequestSchema>;
