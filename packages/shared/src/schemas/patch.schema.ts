import { z } from "zod";
import { NORMALIZED_SEVERITIES } from "./severity.schema";

export const patchDetectedUpdateSchema = z.object({
  updateId: z.string(),
  revisionNumber: z.number().int(),
  title: z.string().max(500),
  severity: z.string().max(50).nullable(),
  kbArticleIds: z.array(z.string()),
  categories: z.array(z.string()),
  sizeBytes: z.string().nullable(), // stringified bigint over the wire, matches totalMemBytes convention
  isDownloaded: z.boolean(),
});
export type PatchDetectedUpdate = z.infer<typeof patchDetectedUpdateSchema>;

export const patchScanResultPayloadSchema = z.object({
  scannedAt: z.string(),
  updates: z.array(patchDetectedUpdateSchema).max(2000),
});
export type PatchScanResultPayload = z.infer<typeof patchScanResultPayloadSchema>;

export const dispatchPatchJobRequestSchema = z
  .object({
    updateIds: z.array(z.string().min(1)).min(1),
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
    // Null/omitted = dispatch immediately (today's only behavior). A future timestamp holds
    // the tasks back - see PatchJob.scheduledAt - until a periodic sweep promotes them.
    scheduledAt: z.coerce.date().nullable().optional(),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type DispatchPatchJobRequest = z.infer<typeof dispatchPatchJobRequestSchema>;

// "Automatic Mode" - a standing policy that auto-dispatches any currently-missing patch at
// or above minSeverity to its target agents, on a periodic sweep, without an admin manually
// selecting updates each time. Empty groupIds means "every enrolled agent."
export const createAutoPatchPolicyRequestSchema = z.object({
  enabled: z.boolean().default(true),
  minSeverity: z.enum(NORMALIZED_SEVERITIES),
  groupIds: z.array(z.string().min(1)).default([]),
});
export type CreateAutoPatchPolicyRequest = z.infer<typeof createAutoPatchPolicyRequestSchema>;

export const updateAutoPatchPolicyRequestSchema = createAutoPatchPolicyRequestSchema.partial();
export type UpdateAutoPatchPolicyRequest = z.infer<typeof updateAutoPatchPolicyRequestSchema>;

export const patchInstallResultItemSchema = z.object({
  updateId: z.string(),
  resultCode: z.number().int(), // WUA OperationResultCode: 2=Succeeded,3=SucceededWithErrors,4=Failed,5=Cancelled
  hresult: z.number().int().nullable(),
});

export const patchInstallResultPayloadSchema = z.object({
  status: z.enum(["SUCCESS", "PARTIAL", "FAILED", "NOTHING_TO_INSTALL"]),
  rebootRequired: z.boolean(),
  results: z.array(patchInstallResultItemSchema),
  message: z.string().max(4096).nullable().optional(),
  startedAt: z.string(),
  completedAt: z.string(),
});
export type PatchInstallResultPayload = z.infer<typeof patchInstallResultPayloadSchema>;
