import { z } from "zod";

// EPM -> Screenshot blocking. On assigned Windows endpoints:
//  - keys: Print Screen (alone, with Alt or Win) and Win+Shift+S are swallowed by the Endpoint IQ
//    tray app in each signed-in user's session;
//  - tools: screenshot programs are closed when they start (by the tray app, in the user's own
//    session), and the agent turns off Snipping Tool, Game Bar capture and Edge's web capture by
//    machine policy;
//  - clipboard (optional): any picture placed on the clipboard is removed.

// Programs closed when tools are blocked (lower-case file names). Admins can add more per policy.
export const SCREENSHOT_TOOL_PROCESSES: readonly string[] = [
  "snippingtool.exe", // Windows 10 and 11 Snipping Tool
  "screenclippinghost.exe", // Win+Shift+S overlay on Windows 10
  "screensketch.exe", // Snip & Sketch
  "sharex.exe",
  "greenshot.exe",
  "lightshot.exe",
  "picpick.exe",
  "snagit32.exe",
  "snagiteditor.exe",
  "snagitcapture.exe",
  "flameshot.exe",
  "screenpresso.exe",
  "faststonecapture.exe",
  "fscapture.exe",
  "monosnap.exe",
  "gyazo.exe",
  "gyazowin.exe",
  "screenrec.exe",
  "obs64.exe",
  "obs32.exe",
];

export const SCREENSHOT_BLOCK_EVENT_KINDS = ["KEY", "TOOL", "CLIPBOARD"] as const;
export type ScreenshotBlockEventKind = (typeof SCREENSHOT_BLOCK_EVENT_KINDS)[number];

const EXE_NAME = /^[^\\/:*?"<>|]+\.exe$/i;

export const createScreenshotBlockPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  blockKeys: z.boolean().default(true),
  blockTools: z.boolean().default(true),
  blockClipboardImages: z.boolean().default(false),
  // Extra screenshot programs to close, by file name ("MyCapture.exe").
  extraTools: z.array(z.string().trim().min(1).max(100).regex(EXE_NAME, "Use a program file name such as Capture.exe")).max(50).default([]),
  enabled: z.boolean().default(true),
});
export type CreateScreenshotBlockPolicyRequest = z.infer<typeof createScreenshotBlockPolicyRequestSchema>;

export const updateScreenshotBlockPolicyRequestSchema = createScreenshotBlockPolicyRequestSchema.partial();
export type UpdateScreenshotBlockPolicyRequest = z.infer<typeof updateScreenshotBlockPolicyRequestSchema>;

export const assignScreenshotBlockPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignScreenshotBlockPolicyRequest = z.infer<typeof assignScreenshotBlockPolicyRequestSchema>;

// What one endpoint enforces: the union of its enabled, non-excepted policies. All false and no
// tools = nothing blocked (the agent then undoes its Windows policy settings).
export interface AssignedScreenshotBlockWire {
  policyIds: string[];
  blockKeys: boolean;
  blockTools: boolean;
  blockClipboardImages: boolean;
  tools: string[]; // lower-case program file names to close
}

export const screenshotBlockEventSchema = z.object({
  username: z.string().max(200),
  kind: z.enum(SCREENSHOT_BLOCK_EVENT_KINDS),
  detail: z.string().max(300),
  occurredAt: z.string(),
});
export type ScreenshotBlockEventPayload = z.infer<typeof screenshotBlockEventSchema>;

export const screenshotBlockReportSchema = z.object({
  policyIds: z.array(z.string()).max(100),
  status: z.enum(["SUCCESS", "FAILED"]),
  errorMessage: z.string().max(1000).nullable(),
  events: z.array(screenshotBlockEventSchema).max(500),
});
export type ScreenshotBlockReport = z.infer<typeof screenshotBlockReportSchema>;
