import { z } from "zod";

export const updateLifecycleStatusRequestSchema = z.object({
  lifecycleStatus: z.enum(["ACTIVE", "IN_REPAIR", "RETIRED", "IN_STORAGE"]),
});
export type UpdateLifecycleStatusRequest = z.infer<typeof updateLifecycleStatusRequestSchema>;

export const setAgentGroupsRequestSchema = z.object({
  groupIds: z.array(z.string().min(1)),
});
export type SetAgentGroupsRequest = z.infer<typeof setAgentGroupsRequestSchema>;

export const createNoteRequestSchema = z.object({
  body: z.string().min(1).max(5000),
});
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>;

export const deviceTypeSchema = z.enum(["LAPTOP", "DESKTOP", "SERVER"]);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

export const updateAssetDetailsRequestSchema = z.object({
  serialNumber: z.string().max(100).nullable().optional(),
  vendor: z.string().max(100).nullable().optional(),
  purchaseDate: z.coerce.date().nullable().optional(),
  warrantyExpiryDate: z.coerce.date().nullable().optional(),
  // null = clear the override and fall back to the auto-detected device type.
  deviceTypeOverride: deviceTypeSchema.nullable().optional(),
  // Manual, authoritative site/location label — distinct from the auto-detected IP-geo
  // hint, which is derived server-side and never overwrites this field.
  location: z.string().max(200).nullable().optional(),
});
export type UpdateAssetDetailsRequest = z.infer<typeof updateAssetDetailsRequestSchema>;

export const uninstallSoftwareRequestSchema = z.object({
  softwareName: z.string().min(1).max(500),
});
export type UninstallSoftwareRequest = z.infer<typeof uninstallSoftwareRequestSchema>;
