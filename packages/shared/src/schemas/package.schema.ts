import { z } from "zod";

export const packageMetadataSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  installerType: z.enum(["EXE", "MSI", "DEB", "RPM", "SH"]),
  silentArgs: z.string(),
});
export type PackageMetadata = z.infer<typeof packageMetadataSchema>;

export const createDeploymentRequestSchema = z
  .object({
    packageId: z.string().min(1),
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type CreateDeploymentRequest = z.infer<typeof createDeploymentRequestSchema>;

// Agent only ever reports these transitions — PENDING is the server-assigned initial state.
export const deploymentStatusPayloadSchema = z.object({
  status: z.enum(["DOWNLOADING", "INSTALLING", "SUCCESS", "FAILED"]),
  exitCode: z.number().int().nullable().optional(),
  message: z.string().max(4096).nullable().optional(),
});
export type DeploymentStatusPayload = z.infer<typeof deploymentStatusPayloadSchema>;
