import { z } from "zod";

export const SECURITY_RULE_SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type SecurityRuleSeverity = (typeof SECURITY_RULE_SEVERITIES)[number];

export const SECURITY_RULE_OPERATORS = ["EQUALS", "NOT_EQUALS", "GTE", "LTE", "CONTAINS", "REGEX_MATCH"] as const;
export type SecurityRuleOperator = (typeof SECURITY_RULE_OPERATORS)[number];

export const SECURITY_BENCHMARK_SOURCES = ["BUILT_IN", "CUSTOM"] as const;
export type SecurityBenchmarkSource = (typeof SECURITY_BENCHMARK_SOURCES)[number];

// Windows 10/11/Server are covered end-to-end via the existing Windows agent
// (PowerShell/registry/secedit checks); SQL Server checks also run through the
// Windows agent (sqlcmd against a local instance). Linux and network-device
// (firewall/switch) targets are deferred — they'd need a new agent/agentless
// mechanism entirely, not just new rule content.
export const SECURITY_BENCHMARK_TARGET_TYPES = ["WINDOWS_10", "WINDOWS_11", "WINDOWS_SERVER", "SQL_SERVER"] as const;
export type SecurityBenchmarkTargetType = (typeof SECURITY_BENCHMARK_TARGET_TYPES)[number];

export const createBenchmarkRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  targetType: z.enum(SECURITY_BENCHMARK_TARGET_TYPES),
});
export type CreateBenchmarkRequest = z.infer<typeof createBenchmarkRequestSchema>;

export const updateBenchmarkRequestSchema = createBenchmarkRequestSchema.partial();
export type UpdateBenchmarkRequest = z.infer<typeof updateBenchmarkRequestSchema>;

export const createRuleRequestSchema = z.object({
  ruleKey: z.string().min(1).max(50),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).nullable().optional(),
  severity: z.enum(SECURITY_RULE_SEVERITIES),
  checkPowerShell: z.string().min(1),
  operator: z.enum(SECURITY_RULE_OPERATORS),
  expectedValue: z.string().max(500),
  remediationPowerShell: z.string().nullable().optional(),
});
export type CreateRuleRequest = z.infer<typeof createRuleRequestSchema>;

export const updateRuleRequestSchema = createRuleRequestSchema.partial();
export type UpdateRuleRequest = z.infer<typeof updateRuleRequestSchema>;

export const importRulesRequestSchema = z.object({
  rules: z.array(createRuleRequestSchema).min(1).max(200),
});
export type ImportRulesRequest = z.infer<typeof importRulesRequestSchema>;

export const assignBenchmarkRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignBenchmarkRequest = z.infer<typeof assignBenchmarkRequestSchema>;

export const remediateRuleRequestSchema = z.object({
  agentId: z.string().min(1),
});
export type RemediateRuleRequest = z.infer<typeof remediateRuleRequestSchema>;

// Deliberately excludes operator/expectedValue — grading happens server-side on
// ingestion (see securityConfigEvaluate.util.ts), so an admin can edit a rule's
// expected value without needing the agent to re-fetch or redeploy anything.
export const assignedSecurityRuleWireSchema = z.object({
  ruleId: z.string(),
  checkPowerShell: z.string(),
});
export type AssignedSecurityRuleWire = z.infer<typeof assignedSecurityRuleWireSchema>;

export const assignedBenchmarkWireSchema = z.object({
  benchmarkId: z.string(),
  rules: z.array(assignedSecurityRuleWireSchema),
});
export type AssignedBenchmarkWire = z.infer<typeof assignedBenchmarkWireSchema>;

export const securityConfigScanResultItemSchema = z.object({
  ruleId: z.string(),
  actualValue: z.string().max(2000).nullable(),
  error: z.string().max(1000).nullable(),
});
export type SecurityConfigScanResultItem = z.infer<typeof securityConfigScanResultItemSchema>;

export const securityConfigScanResultPayloadSchema = z.object({
  scannedAt: z.string(),
  benchmarkId: z.string(),
  results: z.array(securityConfigScanResultItemSchema).max(500),
});
export type SecurityConfigScanResultPayload = z.infer<typeof securityConfigScanResultPayloadSchema>;
