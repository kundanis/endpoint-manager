import { z } from "zod";
import { DATA_DISCOVERY_REGULATIONS } from "../data/piiPatterns";

export const createDataDiscoveryPolicyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  // Older policies only; new ones choose data categories (dataTypeIds) instead.
  regulation: z.enum(DATA_DISCOVERY_REGULATIONS).optional(),
  // Data types (Data Governance -> Data types) of kind PII_PATTERN or KEYWORD to look for.
  dataTypeIds: z.array(z.string().min(1)).min(1).max(50).optional(),
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

// Policies built from data types send the resolved pattern keys and keyword groups; the
// agent compiles the patterns itself from the shared catalog. `regulation` is still sent so
// agents older than 0.2.12 (which only understand it) keep scanning.
export const dataDiscoveryKeywordGroupSchema = z.object({
  key: z.string().max(60), // the data type id; findings report matches under it
  keywords: z.array(z.string().min(1).max(500)).max(500),
});
export type DataDiscoveryKeywordGroup = z.infer<typeof dataDiscoveryKeywordGroupSchema>;

export const assignedDataDiscoveryPolicyWireSchema = z.object({
  policyId: z.string(),
  targetPaths: z.array(z.string()),
  regulation: z.enum(DATA_DISCOVERY_REGULATIONS),
  patternKeys: z.array(z.string()).optional(),
  keywordGroups: z.array(dataDiscoveryKeywordGroupSchema).optional(),
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
  matchedPatternKeys: z.array(z.string()).max(40),
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
