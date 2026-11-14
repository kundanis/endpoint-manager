import { z } from "zod";

// Threat Protection (licence module THREAT_PROTECTION, also sold as its own edition): Microsoft
// Defender managed from the console - status per endpoint, threats, scans and actions, and a
// policy of Defender settings. YARA threat scanning follows in a later phase.

export const THREAT_SCAN_TYPES = ["QUICK", "FULL", "CUSTOM"] as const;
export type ThreatScanType = (typeof THREAT_SCAN_TYPES)[number];

// REMOVE: Defender removes every active threat on the endpoint (Remove-MpThreat has no per-threat
// option). RESTORE: put a quarantined item back. ALLOW: let this threat run on the endpoint from
// now on and restore it. UPDATE_SIGNATURES: download the latest definitions.
export const THREAT_ACTIONS = ["REMOVE", "RESTORE", "ALLOW", "UPDATE_SIGNATURES"] as const;
export type ThreatAction = (typeof THREAT_ACTIONS)[number];

export const THREAT_STATUSES = ["ACTIVE", "QUARANTINED", "REMOVED", "ALLOWED", "RESOLVED", "FAILED"] as const;
export type ThreatStatus = (typeof THREAT_STATUSES)[number];

export const THREAT_SEVERITIES = ["LOW", "MODERATE", "HIGH", "SEVERE", "UNKNOWN"] as const;
export type ThreatSeverity = (typeof THREAT_SEVERITIES)[number];

export const DEFENDER_MODES = ["ACTIVE", "PASSIVE", "EDR_BLOCK", "DISABLED", "NOT_INSTALLED", "UNKNOWN"] as const;
export type DefenderMode = (typeof DEFENDER_MODES)[number];

const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// An exclusion that would switch protection off for a whole drive or the Windows folder.
export function threatExclusionProblem(kind: "path" | "extension" | "process", raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/\//g, "\\");
  if (!v) return "Enter a value.";
  if (kind === "extension") {
    const ext = v.startsWith(".") ? v : `.${v}`;
    if (!/^\.[a-z0-9_-]{1,16}$/.test(ext)) return "Enter one file type, for example .log.";
    if ([".exe", ".dll", ".ps1", ".bat", ".cmd", ".vbs", ".js", ".scr", ".com", ".msi", ".hta", ".lnk", ".zip"].includes(ext)) {
      return `Excluding ${ext} files would let malware of that type through on every endpoint.`;
    }
    return null;
  }
  if (kind === "process") {
    if (!/^[^\\/:*?"<>|]+\.exe$/i.test(v) && !/^[a-z]:\\.+\.exe$/i.test(v)) return "Enter a program file name or path ending in .exe.";
    if (/^(powershell|pwsh|cmd|wscript|cscript|mshta|rundll32|regsvr32|explorer|svchost)\.exe$/.test(v.slice(v.lastIndexOf("\\") + 1))) {
      return "Windows script hosts and system programs can't be excluded: malware runs through them.";
    }
    return null;
  }
  if (/^[a-z]:\\?\*?$/.test(v) || v === "\\" || v === "*" || /^%[a-z]+%\\?\*?$/.test(v)) return "That would exclude a whole drive from scanning.";
  if (
    /^[a-z]:\\(windows|windows\\temp|windows\\system32|users|users\\public|programdata|program files( \(x86\))?)\\?\*?$/.test(v) ||
    /^[a-z]:\\users\\[^\\]+(\\(downloads|desktop|documents|appdata|appdata\\local|appdata\\local\\temp|appdata\\roaming))?\\?\*?$/.test(v) ||
    /^%(temp|tmp|userprofile|appdata|localappdata|programdata|windir|systemroot)%\\?\*?$/.test(v)
  ) {
    return "That folder is where malware usually lands; exclude a narrower folder.";
  }
  return null;
}

const exclusionList = (kind: "path" | "extension" | "process") =>
  z
    .array(z.string().trim().min(1).max(260))
    .max(100)
    .superRefine((items, ctx) => {
      items.forEach((v, i) => {
        const problem = threatExclusionProblem(kind, v);
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${v}: ${problem}`, path: [i] });
      });
    });

export const createThreatProtectionPolicyRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().default(true),
  realTimeProtection: z.boolean().default(true),
  cloudProtection: z.boolean().default(true),
  submitSamples: z.boolean().default(true),
  puaProtection: z.boolean().default(true),
  scanType: z.enum(["QUICK", "FULL"]).default("QUICK"),
  scanScheduleDay: z.number().int().min(0).max(8).default(0),
  scanScheduleTime: z.string().regex(TIME_HHMM, "Use a 24-hour time such as 02:00").default("02:00"),
  signatureUpdateHours: z.number().int().min(1).max(24).default(4),
  excludedPaths: exclusionList("path").default([]),
  excludedExtensions: exclusionList("extension").default([]),
  excludedProcesses: exclusionList("process").default([]),
});
export type CreateThreatProtectionPolicyRequest = z.infer<typeof createThreatProtectionPolicyRequestSchema>;

export const updateThreatProtectionPolicyRequestSchema = createThreatProtectionPolicyRequestSchema.partial();
export type UpdateThreatProtectionPolicyRequest = z.infer<typeof updateThreatProtectionPolicyRequestSchema>;

export const assignThreatProtectionPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((d) => d.agentIds.length > 0 || d.groupIds.length > 0, { message: "At least one agentId or groupId is required", path: ["agentIds"] });
export type AssignThreatProtectionPolicyRequest = z.infer<typeof assignThreatProtectionPolicyRequestSchema>;

export const requestThreatScanSchema = z.object({
  agentIds: z.array(z.string().min(1)).min(1).max(5000),
  scanType: z.enum(THREAT_SCAN_TYPES),
  // CUSTOM only: folders or files to scan.
  paths: z.array(z.string().trim().min(3).max(260)).max(20).default([]),
}).refine((d) => d.scanType !== "CUSTOM" || d.paths.length > 0, { message: "Enter at least one folder to scan", path: ["paths"] });
export type RequestThreatScan = z.infer<typeof requestThreatScanSchema>;

export const requestThreatActionSchema = z.object({
  action: z.enum(THREAT_ACTIONS),
  // Detection-level actions name the threat; UPDATE_SIGNATURES names endpoints instead.
  detectionId: z.string().min(1).optional(),
  agentIds: z.array(z.string().min(1)).max(5000).default([]),
});
export type RequestThreatAction = z.infer<typeof requestThreatActionSchema>;

// ---- Agent wire

// The Defender settings one endpoint applies: its enabled policies merged (protection on if any
// policy turns it on; the earliest-created policy's schedule; exclusions combined).
export interface ThreatProtectionSettingsWire {
  realTimeProtection: boolean;
  cloudProtection: boolean;
  submitSamples: boolean;
  puaProtection: boolean;
  scanType: "QUICK" | "FULL";
  scanScheduleDay: number;
  scanScheduleTime: string;
  signatureUpdateHours: number;
  excludedPaths: string[];
  excludedExtensions: string[];
  excludedProcesses: string[];
}

export interface ThreatScanTaskWire {
  id: string;
  scanType: ThreatScanType;
  paths: string[];
}

export interface ThreatActionTaskWire {
  id: string;
  action: ThreatAction;
  defenderThreatId: string | null; // BigInt as a string
  threatName: string | null;
}

export interface AssignedThreatProtectionWire {
  // False when this deployment doesn't include Threat Protection: the agent then only stops
  // reporting; it never changes Defender settings it didn't set.
  available: boolean;
  policyIds: string[];
  settings: ThreatProtectionSettingsWire | null; // null = no enabled policy: leave Defender as it is
  scanTasks: ThreatScanTaskWire[];
  actionTasks: ThreatActionTaskWire[];
}

const nullableBool = z.boolean().nullable();
export const endpointProtectionStatusSchema = z.object({
  antivirusProducts: z.array(z.object({ name: z.string().max(200), enabled: z.boolean().nullable(), upToDate: z.boolean().nullable() })).max(10),
  defenderMode: z.enum(DEFENDER_MODES),
  realTimeOn: nullableBool,
  behaviorMonitorOn: nullableBool,
  cloudProtectionOn: nullableBool,
  puaProtectionOn: nullableBool,
  tamperProtected: nullableBool,
  externallyManaged: z.boolean(),
  productVersion: z.string().max(50).nullable(),
  engineVersion: z.string().max(50).nullable(),
  signatureVersion: z.string().max(50).nullable(),
  signatureUpdatedAt: z.string().nullable(),
  lastQuickScanAt: z.string().nullable(),
  lastFullScanAt: z.string().nullable(),
});
export type EndpointProtectionStatusPayload = z.infer<typeof endpointProtectionStatusSchema>;

export const threatDetectionPayloadSchema = z.object({
  externalKey: z.string().min(1).max(200),
  threatName: z.string().max(300),
  defenderThreatId: z.string().max(30).nullable(),
  severity: z.enum(THREAT_SEVERITIES),
  category: z.string().max(100).nullable(),
  filePath: z.string().max(1000).nullable(),
  resources: z.array(z.string().max(1000)).max(50),
  username: z.string().max(200).nullable(),
  processName: z.string().max(300).nullable(),
  status: z.enum(THREAT_STATUSES),
  actionDetail: z.string().max(500).nullable(),
  detectedAt: z.string(),
  lastSeenAt: z.string(),
});
export type ThreatDetectionPayload = z.infer<typeof threatDetectionPayloadSchema>;

export const threatProtectionReportSchema = z.object({
  status: endpointProtectionStatusSchema.nullable(), // null when Defender couldn't be read at all
  detections: z.array(threatDetectionPayloadSchema).max(500),
  // Result of applying the policy settings (absent when no policy applies).
  policyIds: z.array(z.string()).max(100),
  syncStatus: z.enum(["SUCCESS", "FAILED"]).nullable(),
  syncError: z.string().max(2000).nullable(),
});
export type ThreatProtectionReport = z.infer<typeof threatProtectionReportSchema>;

export const threatTaskResultSchema = z.object({
  kind: z.enum(["SCAN", "ACTION"]),
  id: z.string().min(1),
  status: z.enum(["RUNNING", "DONE", "FAILED"]),
  message: z.string().max(1000).nullable(),
});
export type ThreatTaskResult = z.infer<typeof threatTaskResultSchema>;
