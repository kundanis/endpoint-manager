// Dependency-free on purpose (type imports only): the consoles import this file straight from
// source, since a runtime value can't be imported through this package's CommonJS build in Vite.
import type { LicenseModule } from "./schemas/common.schema";

// Licensing below the module: Module -> Sub-module -> Feature.
//
// A licence lists its modules (as before) and, optionally, the features it includes. No feature
// list (null) means everything in the licensed modules - every licence issued before features
// existed, and every licence that sells modules whole. With a list, a licensable feature is
// included only when it and every licensable feature above it are in the list.
//
// "core" parts come with their module and can't be sold separately (shared plumbing other parts
// need). They are listed here only so consoles can show the whole tree.
//
// Keys are short on purpose: licence terms (with the feature list) are stored in fixed-size
// columns on both sides. Never rename or reuse a key - it is part of every issued licence.

export interface LicenseFeature {
  key: string;
  label: string;
  module: LicenseModule;
  parent: string | null; // another feature's key; null = directly under the module
  core?: boolean;
}

export const LICENSE_FEATURES: readonly LicenseFeature[] = [
  // Endpoint Hub
  { key: "EH_ASSETS", label: "Endpoints & Assets", module: "ENDPOINT_MANAGER", parent: null, core: true },
  { key: "EH_QUARANTINE", label: "Quarantine", module: "ENDPOINT_MANAGER", parent: "EH_ASSETS" },
  { key: "EH_REMOTE_ACCESS", label: "Remote Access", module: "ENDPOINT_MANAGER", parent: "EH_ASSETS" },
  { key: "EH_REMOTE_INSTALL", label: "Remote Agent Install", module: "ENDPOINT_MANAGER", parent: "EH_ASSETS" },
  { key: "EH_COMMANDS", label: "Commands (remote scripts)", module: "ENDPOINT_MANAGER", parent: null },
  { key: "EH_PACKAGES", label: "Packages (software deployment)", module: "ENDPOINT_MANAGER", parent: null },
  // Network Insight
  { key: "NI_DISCOVERY", label: "Network Discovery", module: "NETWORK_MANAGER", parent: null, core: true },
  // Security Posture
  { key: "SP_VULNERABILITIES", label: "Vulnerabilities", module: "SECURITY_MANAGER", parent: null },
  { key: "SP_PATCHES", label: "Patches", module: "SECURITY_MANAGER", parent: null },
  { key: "SP_PATCH_SCAN", label: "Patch Scanning", module: "SECURITY_MANAGER", parent: "SP_PATCHES", core: true },
  { key: "SP_PATCH_DEPLOY", label: "Patch Deployment", module: "SECURITY_MANAGER", parent: "SP_PATCHES" },
  { key: "SP_SECURITY_CONFIG", label: "Security Configuration (CIS, GPO)", module: "SECURITY_MANAGER", parent: null },
  { key: "SP_ZERO_TRUST", label: "Zero Trust", module: "SECURITY_MANAGER", parent: null },
  // Data Governance
  { key: "DG_DATA_TYPES", label: "Data Types", module: "DATA_MANAGER", parent: null, core: true },
  { key: "DG_EXCEPTIONS", label: "Access Exceptions", module: "DATA_MANAGER", parent: null, core: true },
  { key: "DG_DISCOVERY", label: "Data Discovery", module: "DATA_MANAGER", parent: null },
  { key: "DG_DLP", label: "DLP", module: "DATA_MANAGER", parent: null },
  { key: "DG_DLP_CONTENT", label: "Content & File Policies", module: "DATA_MANAGER", parent: "DG_DLP" },
  { key: "DG_DLP_PII", label: "PII Data Blocking", module: "DATA_MANAGER", parent: "DG_DLP" },
  { key: "DG_MOVEMENT", label: "Data Movement", module: "DATA_MANAGER", parent: null },
  { key: "DG_MOVEMENT_FILES", label: "File Movement", module: "DATA_MANAGER", parent: "DG_MOVEMENT" },
  { key: "DG_MOVEMENT_SCREEN", label: "Screen Capture Monitoring", module: "DATA_MANAGER", parent: "DG_MOVEMENT" },
  { key: "EPM", label: "EPM", module: "DATA_MANAGER", parent: null },
  { key: "EPM_APP", label: "Application Control", module: "DATA_MANAGER", parent: "EPM" },
  { key: "EPM_APP_BLOCK", label: "Block Lists", module: "DATA_MANAGER", parent: "EPM_APP", core: true },
  { key: "EPM_ALLOWLIST", label: "Allowlisting", module: "DATA_MANAGER", parent: "EPM_APP" },
  { key: "EPM_WEB", label: "Web & Email Blocking", module: "DATA_MANAGER", parent: "EPM" },
  { key: "EPM_EMAIL_ATTACH", label: "Email Attachment Blocking", module: "DATA_MANAGER", parent: "EPM" },
  { key: "EPM_COMMAND", label: "Command Blocking", module: "DATA_MANAGER", parent: "EPM" },
  { key: "EPM_IP", label: "IP Blocking", module: "DATA_MANAGER", parent: "EPM" },
  { key: "EPM_USB", label: "USB Device Control", module: "DATA_MANAGER", parent: "EPM" },
  { key: "EPM_SCREENSHOT", label: "Screenshot Blocking", module: "DATA_MANAGER", parent: "EPM" },
  // AI Guard
  { key: "AI_TOOLS", label: "AI Tools (discover, allow or block)", module: "AI_GUARD", parent: null, core: true },
  { key: "AI_USAGE", label: "AI Usage & Email Alerts", module: "AI_GUARD", parent: null, core: true },
  { key: "AI_PROMPT", label: "Prompt Protection", module: "AI_GUARD", parent: null },
  { key: "AI_PROMPT_BROWSER", label: "Browser (AI websites)", module: "AI_GUARD", parent: "AI_PROMPT" },
  { key: "AI_PROMPT_DESKTOP", label: "Desktop AI Apps (clipboard)", module: "AI_GUARD", parent: "AI_PROMPT" },
  { key: "AI_EXTENSIONS", label: "AI Extensions & Coding Tools", module: "AI_GUARD", parent: null },
  // Threat Protection: one unit for now.
  { key: "TP_ALL", label: "Threat Protection", module: "THREAT_PROTECTION", parent: null, core: true },
  // Identity Governance
  { key: "IG_ADMIN_LOGS", label: "Admin Logs", module: "USER_MANAGER", parent: null, core: true },
  { key: "IG_PRODUCTIVITY", label: "User Productivity", module: "USER_MANAGER", parent: null },
  { key: "IG_USER_RISK", label: "User Risk", module: "USER_MANAGER", parent: null },
  // App Center
  { key: "AC_SOFTWARE_LICENSES", label: "Software Licenses", module: "SOFTWARE_MANAGER", parent: null, core: true },
];

const byKey = new Map(LICENSE_FEATURES.map((f) => [f.key, f]));

export function licenseFeature(key: string): LicenseFeature | undefined {
  return byKey.get(key);
}

// The keys that can be sold separately.
export const LICENSABLE_FEATURE_KEYS: readonly string[] = LICENSE_FEATURES.filter((f) => !f.core).map((f) => f.key);

// The licensable features of these modules (what "everything" means for them).
export function allFeaturesOf(modules: readonly string[]): string[] {
  return LICENSE_FEATURES.filter((f) => !f.core && modules.includes(f.module)).map((f) => f.key);
}

// A stored list cleaned up: known, licensable keys of licensed modules only, each with every
// licensable feature above it; null stays null. A list that includes everything becomes null.
export function normalizeFeatures(modules: readonly string[], features: readonly string[] | null | undefined): string[] | null {
  if (features == null) return null;
  const keep = new Set<string>();
  for (const key of features) {
    const f = byKey.get(key);
    if (!f || f.core || !modules.includes(f.module)) continue;
    keep.add(key);
  }
  // A feature whose parent isn't included can't be used: drop it.
  const ok = [...keep].filter((key) => {
    for (let p = byKey.get(key)?.parent; p; p = byKey.get(p)?.parent) {
      const parent = byKey.get(p)!;
      if (!parent.core && !keep.has(p)) return false;
    }
    return true;
  });
  const all = allFeaturesOf(modules);
  if (all.every((k) => ok.includes(k))) return null;
  return LICENSABLE_FEATURE_KEYS.filter((k) => ok.includes(k));
}

// Whether a licence with these modules and features includes the feature.
export function isFeatureLicensed(key: string, modules: readonly string[], features: readonly string[] | null | undefined): boolean {
  const f = byKey.get(key);
  if (!f || !modules.includes(f.module)) return false;
  if (features == null) return true;
  for (let at: LicenseFeature | undefined = f; at; at = at.parent ? byKey.get(at.parent) : undefined) {
    if (!at.core && !features.includes(at.key)) return false;
  }
  return true;
}

// What a change of terms adds and removes, feature by feature (modules included).
export function featureChanges(
  current: { modules: readonly string[]; features?: readonly string[] | null },
  proposed: { modules: readonly string[]; features?: readonly string[] | null },
): { added: string[]; removed: string[] } {
  const has = (t: typeof current) => new Set(LICENSABLE_FEATURE_KEYS.filter((k) => isFeatureLicensed(k, t.modules, t.features ?? null)));
  const before = has(current);
  const after = has(proposed);
  return { added: [...after].filter((k) => !before.has(k)), removed: [...before].filter((k) => !after.has(k)) };
}
