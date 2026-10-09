import { z } from "zod";

// Same "agentIds and/or groupIds, at least one required" shape as commands/deployments/
// patches - no scheduling here (unlike patches' dispatchPatchJobRequestSchema): an agent
// update is always dispatched immediately, since holding it back to a future time buys
// nothing an admin can't already get by just clicking the button later.
export const dispatchAgentUpdateRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type DispatchAgentUpdateRequest = z.infer<typeof dispatchAgentUpdateRequestSchema>;

// Reported by the DETACHED helper task, not the original agent process - see
// buildSelfUpdateScript. DOWNLOADING/APPLYING are best-effort progress pings from the
// still-running original process; SUCCESS/FAILED always come from the helper, after the
// swap has actually happened (or failed to).
export const agentUpdateStatusPayloadSchema = z.object({
  status: z.enum(["DOWNLOADING", "APPLYING", "SUCCESS", "FAILED"]),
  message: z.string().max(4096).nullable().optional(),
});
export type AgentUpdateStatusPayload = z.infer<typeof agentUpdateStatusPayloadSchema>;

// What the packaging pipeline writes to config.agentManifestPath alongside the installer
// zip it describes - the single source of truth for "what version is currently staged on
// this server, and what changed in it." Read fresh off disk on every request rather than
// cached/stored in the DB, since it only ever changes when a new update package gets
// deployed to THIS server (which already means a restart) - see agentBuild.service.ts.
export const agentBuildManifestSchema = z.object({
  version: z.string().min(1),
  sha256: z.string().length(64),
  fileSizeBytes: z.number().int().positive(),
  releaseNotes: z.string().max(4000),
  builtAt: z.string(),
});
export type AgentBuildManifest = z.infer<typeof agentBuildManifestSchema>;
