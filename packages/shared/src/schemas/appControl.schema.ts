import { z } from "zod";

// EXECUTABLE also matches a renamed copy by the original file name stored inside the program;
// PRODUCT and PUBLISHER match what is stored inside / signed onto the program, so they survive
// renames and new versions.
export const APP_CONTROL_RULE_TYPES = ["EXTENSION", "EXECUTABLE", "PRODUCT", "PUBLISHER", "DLL", "ALLOW_PATH", "ALLOW_PUBLISHER", "ALLOW_HASH", "ALLOW_CATALOG"] as const;
export type AppControlRuleType = (typeof APP_CONTROL_RULE_TYPES)[number];

// Advanced application control (Windows AppLocker), switched on per server with
// ADVANCED_APP_CONTROL=true. DLL blocks a library by file name or path; ALLOW_PATH is an
// exception - files there are never blocked by any rule on the endpoint. These rules are sent
// to agents in AssignedAppControlResponse.advanced only, never in .rules: agents before 0.2.27
// would treat an unknown rule type as a program name.
export const ADVANCED_APP_CONTROL_RULE_TYPES: readonly AppControlRuleType[] = ["DLL", "ALLOW_PATH", "ALLOW_PUBLISHER", "ALLOW_HASH", "ALLOW_CATALOG"];
export const isAdvancedAppControlRuleType = (t: string) => (ADVANCED_APP_CONTROL_RULE_TYPES as readonly string[]).includes(t);

// Allowlist policies (mode ALLOWLIST, needs advanced application control): only Windows and what
// it needs, the agent, the options (Program Files, administrators) and these rules may run; every
// other program and installer (.msi) is blocked. Windows AppLocker rules on the endpoint.
//  ALLOW_CATALOG: value = a key from APP_CATALOG (a common application).
//  ALLOW_PATH: a folder or file.
//  ALLOW_PUBLISHER: value = the signer exactly as Windows reads it from the certificate
//    ("O=GOOGLE LLC, L=MOUNTAIN VIEW, S=CALIFORNIA, C=US"); optional product, file name, version.
//  ALLOW_HASH: value = the program's Authenticode SHA-256 (64 hex), with its file name and size.
export const APP_CONTROL_POLICY_MODES = ["BLOCK", "ALLOWLIST"] as const;
export type AppControlPolicyMode = (typeof APP_CONTROL_POLICY_MODES)[number];
export const ALLOWLIST_RULE_TYPES: readonly AppControlRuleType[] = ["ALLOW_PATH", "ALLOW_PUBLISHER", "ALLOW_HASH", "ALLOW_CATALOG"];
export const ALLOWLIST_ENFORCEMENTS = ["AUDIT", "ENFORCE"] as const;
export type AllowlistEnforcement = (typeof ALLOWLIST_ENFORCEMENTS)[number];
export const MICROSOFT_SIGNED_OPTIONS = ["OFF", "SELECTED", "ALL"] as const;
export type MicrosoftSignedOption = (typeof MICROSOFT_SIGNED_OPTIONS)[number];
export const VERSION_MATCHES = ["ANY", "MIN", "EXACT"] as const;
export type VersionMatch = (typeof VERSION_MATCHES)[number];

export { MICROSOFT_PUBLISHER, DEFAULT_MICROSOFT_PRODUCTS } from "../data/appAllowlist";

// Script types AppLocker's Script collection covers, and Windows Installer types. With advanced
// application control on, an extension rule for one of these is also enforced by AppLocker, which
// catches scripts started from an open PowerShell or Command Prompt and scheduled tasks too.
export const APPLOCKER_SCRIPT_EXTENSIONS: readonly string[] = [".ps1", ".bat", ".cmd", ".vbs", ".js"];
export const APPLOCKER_MSI_EXTENSIONS: readonly string[] = [".msi", ".msp", ".mst"];

export const createAppControlRuleRequestSchema = z.object({
  // Publisher and hash allow rules (ignored for the other types).
  productName: z.string().trim().max(300).nullable().optional(),
  fileName: z.string().trim().max(300).nullable().optional(),
  versionMatch: z.enum(VERSION_MATCHES).nullable().optional(),
  version: z.string().trim().max(50).nullable().optional(),
  fileSize: z.number().int().nonnegative().nullable().optional(),
  ruleType: z.enum(APP_CONTROL_RULE_TYPES),
  // EXTENSION: e.g. ".vbs" (blocked as a Script-collection SRP path rule "*.vbs").
  // EXECUTABLE: a filename (e.g. "utorrent.exe") or full path.
  // PRODUCT: the product name inside the program (e.g. "AnyDesk"); * wildcards allowed.
  // PUBLISHER: the company the program is signed by or names (e.g. "AnyDesk Software GmbH").
  // DLL (advanced): a DLL file name ("evil.dll") or path ("C:\Users\*\AppData\*\evil.dll").
  // ALLOW_PATH (advanced): a file or folder ("C:\Tools\*") that is never blocked.
  value: z.string().min(1).max(500),
  label: z.string().max(200).nullable().optional(),
});
export type CreateAppControlRuleRequest = z.infer<typeof createAppControlRuleRequestSchema>;

export const updateAppControlRuleRequestSchema = createAppControlRuleRequestSchema.partial();
export type UpdateAppControlRuleRequest = z.infer<typeof updateAppControlRuleRequestSchema>;

const allowlistSettingsSchema = z.object({
  allowlistEnforcement: z.enum(ALLOWLIST_ENFORCEMENTS),
  allowProgramFiles: z.boolean(),
  exemptAdministrators: z.boolean(),
  microsoftSigned: z.enum(MICROSOFT_SIGNED_OPTIONS),
  // null = the preset list (DEFAULT_MICROSOFT_PRODUCTS)
  microsoftProducts: z.array(z.string().trim().min(1).max(200)).max(50).nullable(),
});

export const createAppControlPolicyRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).nullable().optional(),
    enabled: z.boolean().default(true),
    // Fixed once the policy exists.
    mode: z.enum(APP_CONTROL_POLICY_MODES).default("BLOCK"),
  })
  .merge(allowlistSettingsSchema.partial());
export type CreateAppControlPolicyRequest = z.infer<typeof createAppControlPolicyRequestSchema>;

export const updateAppControlPolicyRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).nullable(),
    enabled: z.boolean(),
  })
  .merge(allowlistSettingsSchema)
  .partial();
export type UpdateAppControlPolicyRequest = z.infer<typeof updateAppControlPolicyRequestSchema>;

export const assignAppControlPolicyRequestSchema = z
  .object({
    agentIds: z.array(z.string().min(1)).default([]),
    groupIds: z.array(z.string().min(1)).default([]),
  })
  .refine((data) => data.agentIds.length > 0 || data.groupIds.length > 0, {
    message: "At least one agentId or groupId is required",
    path: ["agentIds"],
  });
export type AssignAppControlPolicyRequest = z.infer<typeof assignAppControlPolicyRequestSchema>;

export const appControlRuleWireSchema = z.object({
  ruleId: z.string(),
  ruleType: z.enum(APP_CONTROL_RULE_TYPES),
  value: z.string(),
  // ALLOW_PUBLISHER / ALLOW_HASH only.
  productName: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  versionMatch: z.enum(VERSION_MATCHES).nullable().optional(),
  version: z.string().nullable().optional(),
  fileSize: z.number().nullable().optional(),
});
export type AppControlRuleWire = z.infer<typeof appControlRuleWireSchema>;

// Every allowlist policy assigned to the agent, combined: allows add up (a baseline option is on
// if any policy has it on), and the device enforces if any of them enforces.
export const allowlistWireSchema = z.object({
  enforce: z.boolean(),
  allowProgramFiles: z.boolean(),
  exemptAdministrators: z.boolean(),
  microsoftSigned: z.enum(MICROSOFT_SIGNED_OPTIONS),
  microsoftProducts: z.array(z.string()),
  rules: z.array(appControlRuleWireSchema),
});
export type AllowlistWire = z.infer<typeof allowlistWireSchema>;

// Flat, deduped across every policy assigned to this agent — enforcement is one combined
// SRP registry state, not independent per-policy actions (no per-policy enforcement
// parameters like DLP's enforcementMode exist here), so there's no need for per-policy nesting.
export const assignedAppControlResponseSchema = z.object({
  rules: z.array(appControlRuleWireSchema),
  // Present only while the server has advanced application control on. Absent: the agent
  // removes every AppLocker rule it added.
  // allowlist: present while at least one allowlist policy applies (agents before 0.2.30 ignore it).
  advanced: z.object({ rules: z.array(appControlRuleWireSchema), allowlist: allowlistWireSchema.optional() }).optional(),
});
export type AssignedAppControlResponse = z.infer<typeof assignedAppControlResponseSchema>;

// ruleId is nullable - an event can't always be matched back to the rule that caused it.
export const appControlEventPayloadSchema = z.object({
  ruleId: z.string().nullable(),
  matchedPath: z.string().max(1000).nullable(),
  processName: z.string().max(300).nullable(),
  occurredAt: z.string(),
  // Allowlist events (ruleId null): BLOCKED, or AUDIT (would have been blocked), with the program's
  // signer details and hash as Windows recorded them.
  allowlist: z.boolean().optional(),
  outcome: z.enum(["BLOCKED", "AUDIT"]).optional(),
  publisher: z.string().max(500).nullable().optional(),
  productName: z.string().max(300).nullable().optional(),
  fileVersion: z.string().max(50).nullable().optional(),
  fileHash: z.string().max(64).nullable().optional(),
  fileSize: z.number().nullable().optional(),
  userName: z.string().max(200).nullable().optional(),
});
export type AppControlEventPayload = z.infer<typeof appControlEventPayloadSchema>;

export const appControlScanResultPayloadSchema = z.object({
  status: z.enum(["APPLIED", "FAILED"]),
  errorMessage: z.string().nullable(),
  events: z.array(appControlEventPayloadSchema).max(200),
});
export type AppControlScanResultPayload = z.infer<typeof appControlScanResultPayloadSchema>;
