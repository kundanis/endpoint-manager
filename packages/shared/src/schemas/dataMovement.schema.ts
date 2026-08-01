import { z } from "zod";

export const DATA_MOVEMENT_CHANNELS = ["USB", "CLOUD_SYNC", "NETWORK_SHARE"] as const;
export type DataMovementChannel = (typeof DATA_MOVEMENT_CHANNELS)[number];

export const createDataMovementPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  monitorUsb: z.boolean().default(true),
  monitorCloudSync: z.boolean().default(true),
  monitorNetworkShare: z.boolean().default(true),
  // Env-var placeholders (e.g. "%USERPROFILE%\\Nextcloud") expanded agent-side — supplements
  // the built-in OneDrive/Dropbox/Google Drive candidate paths, doesn't replace them.
  extraCloudSyncPaths: z.array(z.string().min(1).max(500)).max(20).default([]),
  enabled: z.boolean().default(true),
});
export type CreateDataMovementPolicyRequest = z.infer<typeof createDataMovementPolicyRequestSchema>;

export const updateDataMovementPolicyRequestSchema = createDataMovementPolicyRequestSchema.partial();
export type UpdateDataMovementPolicyRequest = z.infer<typeof updateDataMovementPolicyRequestSchema>;

export const assignDataMovementPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignDataMovementPolicyRequest = z.infer<typeof assignDataMovementPolicyRequestSchema>;

export const assignedDataMovementPolicyWireSchema = z.object({
  policyId: z.string(),
  monitorUsb: z.boolean(),
  monitorCloudSync: z.boolean(),
  monitorNetworkShare: z.boolean(),
  extraCloudSyncPaths: z.array(z.string()),
});
export type AssignedDataMovementPolicyWire = z.infer<typeof assignedDataMovementPolicyWireSchema>;

// channelDetail is intentionally a loose string map — its shape varies by channel
// (USB: driveLetter/volumeLabel/serialNumber; CLOUD_SYNC: provider; NETWORK_SHARE: uncPath)
// rather than needing a discriminated union the wire schema has to encode.
export const dataMovementFileEventSchema = z.object({
  filePath: z.string().max(1000),
  fileSizeBytes: z.number().int().nonnegative(),
  fileModifiedAt: z.string(),
  channel: z.enum(DATA_MOVEMENT_CHANNELS),
  channelDetail: z.record(z.string(), z.string().nullable()),
});
export type DataMovementFileEvent = z.infer<typeof dataMovementFileEventSchema>;

export const dataMovementScanResultPayloadSchema = z.object({
  scannedAt: z.string(),
  policyId: z.string(),
  events: z.array(dataMovementFileEventSchema).max(500),
});
export type DataMovementScanResultPayload = z.infer<typeof dataMovementScanResultPayloadSchema>;
