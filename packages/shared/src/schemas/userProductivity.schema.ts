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
