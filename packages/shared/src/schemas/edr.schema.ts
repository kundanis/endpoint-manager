import { z } from "zod";

// Raw process snapshot from the agent's PowerShell dump — no rule matching happens in
// PowerShell itself (see edrRules.ts's comment); this is just what Win32_Process reports.
export const edrProcessSnapshotEntrySchema = z.object({
  processId: z.number().int().nonnegative(),
  parentProcessId: z.number().int().nonnegative().nullable(),
  name: z.string().max(260),
  commandLine: z.string().max(2000).nullable(),
});
export type EdrProcessSnapshotEntry = z.infer<typeof edrProcessSnapshotEntrySchema>;

export const edrDetectionSchema = z.object({
  ruleKey: z.string().max(50),
  ruleLabel: z.string().max(300),
  severity: z.enum(["HIGH", "MEDIUM"]),
  processName: z.string().max(260),
  processId: z.number().int().nonnegative(),
  parentProcessName: z.string().max(260).nullable(),
  parentProcessId: z.number().int().nonnegative().nullable(),
  commandLine: z.string().max(2000).nullable(),
  killed: z.boolean(),
});
export type EdrDetection = z.infer<typeof edrDetectionSchema>;

export const edrPersistenceItemSchema = z.object({
  location: z.string().max(300),
  name: z.string().max(300),
  command: z.string().max(2000).nullable(),
});
export type EdrPersistenceItem = z.infer<typeof edrPersistenceItemSchema>;

export const edrScanResultPayloadSchema = z.object({
  scannedAt: z.string(),
  detections: z.array(edrDetectionSchema).max(50),
  // Full current snapshot every scan, not a pre-diffed "new since last time" list — the
  // server holds the baseline and decides what's new (same "agent reports, server does
  // the stateful diffing" split already used by Data Movement/User Productivity), so an
  // agent restart never causes a false "everything is new" flood.
  persistenceSnapshot: z.array(edrPersistenceItemSchema).max(500),
});
export type EdrScanResultPayload = z.infer<typeof edrScanResultPayloadSchema>;

export const edrEnabledResponseSchema = z.object({
  enabled: z.boolean(),
});
export type EdrEnabledResponse = z.infer<typeof edrEnabledResponseSchema>;

export const setEdrEnabledRequestSchema = z.object({
  enabled: z.boolean(),
});
export type SetEdrEnabledRequest = z.infer<typeof setEdrEnabledRequestSchema>;
