import { z } from "zod";
import { DATA_DISCOVERY_REGULATIONS } from "../data/piiPatterns";

export const createDataDiscoveryPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  regulation: z.enum(DATA_DISCOVERY_REGULATIONS),
  // Env-var placeholders (e.g. "%USERPROFILE%\\Documents") expanded agent-side, not here.
  targetPaths: z.array(z.string().min(1).max(500)).min(1).max(20),
  // Paused (false) policies are skipped entirely — same semantics as
  // ZeroTrustPolicy.enabled.
  enabled: z.boolean().default(true),
});
export type CreateDataDiscoveryPolicyRequest = z.infer<typeof createDataDiscoveryPolicyRequestSchema>;

export const updateDataDiscoveryPolicyRequestSchema = createDataDiscoveryPolicyRequestSchema.partial();
export type UpdateDataDiscoveryPolicyRequest = z.infer<typeof updateDataDiscoveryPolicyRequestSchema>;

export const assignDataDiscoveryPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignDataDiscoveryPolicyRequest = z.infer<typeof assignDataDiscoveryPolicyRequestSchema>;

// Deliberately sends `regulation`, not a resolved pattern list — the agent resolves
// regulation -> concrete patterns itself via getPatternsForRegulation (same catalog
// import as the server), so the wire payload doesn't need to duplicate that mapping.
export const assignedDataDiscoveryPolicyWireSchema = z.object({
  policyId: z.string(),
  targetPaths: z.array(z.string()),
  regulation: z.enum(DATA_DISCOVERY_REGULATIONS),
});
export type AssignedDataDiscoveryPolicyWire = z.infer<typeof assignedDataDiscoveryPolicyWireSchema>;

// matchCounts is patternKey -> count of matches in that file. maskedSamples is
// patternKey -> a handful of masked previews (e.g. "••••••••6789") — enough to
// confirm a real match and rule out false positives without ever carrying the
// unmasked value off the endpoint.
export const dataDiscoveryFileFindingSchema = z.object({
  filePath: z.string().max(1000),
  fileSizeBytes: z.number().int().nonnegative(),
  fileModifiedAt: z.string(),
  matchedPatternKeys: z.array(z.string()).max(20),
  matchCounts: z.record(z.string(), z.number().int().nonnegative()),
  maskedSamples: z.record(z.string(), z.array(z.string().max(200)).max(20)),
});
export type DataDiscoveryFileFinding = z.infer<typeof dataDiscoveryFileFindingSchema>;

export const dataDiscoveryScanResultPayloadSchema = z.object({
  scannedAt: z.string(),
  policyId: z.string(),
  filesScanned: z.number().int().nonnegative(),
  findings: z.array(dataDiscoveryFileFindingSchema).max(1000),
});
export type DataDiscoveryScanResultPayload = z.infer<typeof dataDiscoveryScanResultPayloadSchema>;
