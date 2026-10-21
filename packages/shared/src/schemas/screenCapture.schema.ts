import { z } from "zod";

// DLP -> Screen capture monitoring. The agent watches the folders screenshots are saved to,
// records each capture as it appears (so deleting it afterwards doesn't hide it), its deletion,
// and - through Windows file-access auditing - the programs that opened it. Only metadata
// leaves the endpoint, never the image.

export const SCREEN_CAPTURE_SOURCES = ["WINDOWS", "SNIPPING_TOOL", "GAME_BAR", "THIRD_PARTY", "CUSTOM"] as const;
export type ScreenCaptureSource = (typeof SCREEN_CAPTURE_SOURCES)[number];

export const createScreenCapturePolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  // A user taking more than this many screenshots in a day is flagged.
  dailyThreshold: z.number().int().min(1).max(10000).default(10),
  // A screenshot deleted within this many minutes of being taken is flagged.
  quickDeleteMinutes: z.number().int().min(1).max(1440).default(10),
  monitorWindows: z.boolean().default(true),
  monitorSnippingTool: z.boolean().default(true),
  monitorGameBar: z.boolean().default(true),
  monitorThirdParty: z.boolean().default(true),
  // Extra folders (e.g. "%USERPROFILE%\\Pictures\\Greenshot"), expanded once per user.
  extraPaths: z.array(z.string().min(1).max(500)).max(20).default([]),
  trackOpenedBy: z.boolean().default(true),
  enabled: z.boolean().default(true),
});
export type CreateScreenCapturePolicyRequest = z.infer<typeof createScreenCapturePolicyRequestSchema>;

export const updateScreenCapturePolicyRequestSchema = createScreenCapturePolicyRequestSchema.partial();
export type UpdateScreenCapturePolicyRequest = z.infer<typeof updateScreenCapturePolicyRequestSchema>;

export const assignScreenCapturePolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignScreenCapturePolicyRequest = z.infer<typeof assignScreenCapturePolicyRequestSchema>;

// What one endpoint watches: the union of every policy assigned to it.
export interface AssignedScreenCaptureWire {
  sources: ScreenCaptureSource[];
  extraPaths: string[];
  trackOpenedBy: boolean;
}

export const screenCaptureCaptureSchema = z.object({
  username: z.string().max(200),
  source: z.enum(SCREEN_CAPTURE_SOURCES),
  filePath: z.string().max(1000),
  fileSizeBytes: z.number().int().nonnegative(),
  capturedAt: z.string(),
  captureDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // endpoint-local date
});
export type ScreenCaptureCapture = z.infer<typeof screenCaptureCaptureSchema>;

export const screenCaptureReportPayloadSchema = z.object({
  captures: z.array(screenCaptureCaptureSchema).max(500),
  deletions: z.array(z.object({ filePath: z.string().max(1000), deletedAt: z.string() })).max(500),
  // From the Windows Security log (event 4663): a program that read a screenshot.
  opens: z.array(z.object({ filePath: z.string().max(1000), process: z.string().max(260), at: z.string() })).max(1000),
});
export type ScreenCaptureReportPayload = z.infer<typeof screenCaptureReportPayloadSchema>;
