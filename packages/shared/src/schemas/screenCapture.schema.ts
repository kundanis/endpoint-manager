import { z } from "zod";

// DLP -> Screen capture monitoring. The agent watches the folders screenshots are saved to,
// records each capture as it appears (so deleting it afterwards doesn't hide it), its deletion,
// and - through Windows file-access auditing - the programs that opened it. The image itself is
// sent only when a policy is set to keep images for that endpoint (super admins only see it).

// Programs that read a new screenshot without the user sending it anywhere: the Windows shell
// and thumbnails, search indexing, the capture tools, the agent itself and antivirus / EDR
// scanners (which scan every new file). Never reported as "opened by".
export const SCREENSHOT_IGNORED_OPENERS: readonly string[] = [
  "explorer.exe", "dllhost.exe", "svchost.exe", "searchprotocolhost.exe", "searchindexer.exe", "searchfilterhost.exe",
  "runtimebroker.exe", "backgroundtaskhost.exe", "system", "node.exe", "powershell.exe", "conhost.exe",
  "snippingtool.exe", "screenclippinghost.exe", "screensketch.exe", "gamebar.exe", "gamebarftserver.exe", "sharex.exe",
  // Microsoft Defender
  "msmpeng.exe", "mssense.exe", "nissrv.exe", "mpdefendercoreservice.exe",
  // Kaspersky, ESET, Bitdefender, Norton / Symantec, McAfee / Trellix, Sophos
  "avp.exe", "avpui.exe", "kavfs.exe", "ekrn.exe", "egui.exe", "vsserv.exe", "bdservicehost.exe", "epsecurityservice.exe",
  "ccsvchst.exe", "nortonsecurity.exe", "sepwscsvc64.exe", "mcshield.exe", "mfemms.exe", "mfetp.exe", "mfeesp.exe",
  "sophosfilescanner.exe", "savservice.exe", "sophosntpservice.exe", "sspservice.exe",
  // Quick Heal / Seqrite, Avast / AVG, Malwarebytes, Trend Micro, Webroot, K7, Cylance, SentinelOne, CrowdStrike, Carbon Black
  "scsecsvc.exe", "qhactivedefense.exe", "qhpisvr.exe", "avastsvc.exe", "avgsvc.exe", "mbamservice.exe",
  "ntrtscan.exe", "tmbmsrv.exe", "pccntmon.exe", "wrsa.exe", "k7tsmngr.exe", "k7rtscan.exe", "cylancesvc.exe",
  "sentinelagent.exe", "csfalconservice.exe", "repmgr.exe", "cb.exe",
];

export function isIgnoredScreenshotOpener(process: string): boolean {
  return SCREENSHOT_IGNORED_OPENERS.includes(process.trim().toLowerCase());
}

export const SCREEN_CAPTURE_MIN_RETENTION_DAYS = 7;
export const SCREEN_CAPTURE_MAX_RETENTION_DAYS = 365;
// Images larger than this (or videos) are never uploaded; the screenshot is still recorded.
export const SCREEN_CAPTURE_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const SCREEN_CAPTURE_IMAGE_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"];

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
  // Keep the screenshot images: from every endpoint the policy covers, or only the listed ones.
  // Changing these is for super admins only (server-enforced).
  saveImages: z.boolean().default(false),
  saveImagesAllEndpoints: z.boolean().default(true),
  saveImagesAgentIds: z.array(z.string().min(1)).max(5000).default([]),
  imageRetentionDays: z.number().int().min(SCREEN_CAPTURE_MIN_RETENTION_DAYS).max(SCREEN_CAPTURE_MAX_RETENTION_DAYS).default(30),
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
  // Upload each new screenshot's image (agent 0.2.25+).
  saveImages: boolean;
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
