import { z } from "zod";

// One row per distinct sign-in the agent's quser-based scan currently sees — not
// policy-gated (every enrolled agent always reports this, like inventory/patch scanning),
// so there's no assigned-policy wire type, just a scan result.
export const userSessionSnapshotEntrySchema = z.object({
  username: z.string().max(300),
  state: z.string().max(20), // "Active" | "Disc" | whatever quser reports
  idleSeconds: z.number().int().nonnegative(),
  logonAt: z.string(), // ISO
});
export type UserSessionSnapshotEntry = z.infer<typeof userSessionSnapshotEntrySchema>;

export const userProductivityScanResultPayloadSchema = z.object({
  scannedAt: z.string(),
  sessions: z.array(userSessionSnapshotEntrySchema).max(50),
});
export type UserProductivityScanResultPayload = z.infer<typeof userProductivityScanResultPayloadSchema>;

// Sent every few minutes by the Endpoint IQ tray app (through the agent): seconds the signed-in
// user spent in each application (APP: key = executable name, label = the program's
// description) and on each website (WEB: key = label = domain) since the last report. Only
// active time counts - the tray stops counting while the user is idle.
export const APP_USAGE_KINDS = ["APP", "WEB"] as const;
export type AppUsageKind = (typeof APP_USAGE_KINDS)[number];

export const appUsageReportSchema = z.object({
  username: z.string().trim().min(1).max(300),
  items: z
    .array(
      z.object({
        kind: z.enum(APP_USAGE_KINDS),
        key: z.string().trim().toLowerCase().min(1).max(255),
        label: z.string().trim().min(1).max(300),
        seconds: z.number().int().min(1).max(3600),
      }),
    )
    .max(500),
});
export type AppUsageReport = z.infer<typeof appUsageReportSchema>;

// Admin view: time per application or website, summed over the chosen day(s).
export interface AppUsageRow {
  kind: AppUsageKind;
  key: string;
  label: string;
  activeSeconds: number;
  users: number; // distinct users (and, in the fleet view, endpoints x users) who used it
}
