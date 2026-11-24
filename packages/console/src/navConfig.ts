import type { AdminPermissionKey, LicenseModuleKey } from "./api/types";

export interface NavItem {
  path: string;
  label: string;
  // Shown only to super admins and admins holding this extra grant.
  permission?: AdminPermissionKey;
  // Shown only to super admins.
  superAdminOnly?: boolean;
  // A sub-module licensed on its own (@license/shared features): shown locked when the licence
  // includes the module but not this.
  feature?: string;
}

export interface NavModule {
  key: string;
  label: string;
  // A module is either a direct link (path set, no submenu/accordion) or an
  // expandable group of sub-items (items set) — mutually exclusive.
  path?: string;
  items?: NavItem[];
  // Absent for Dashboard/Licensing — both stay accessible regardless of which modules a
  // license includes. Every other module maps 1:1 to a LicenseModuleKey (see
  // requireModule.ts on the server side, which enforces the exact same mapping).
  licenseModule?: LicenseModuleKey;
  // Administrators only — a role gate, not a license/module gate, so it's a separate flag
  // rather than another licenseModule value (see requireSuperAdmin.ts on the server).
  superAdminOnly?: boolean;
}

export const NAV_MODULES: NavModule[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: "/dashboard",
  },
  // Every module's events in one place. No licence module of its own: each kind of event is
  // shown only to admins who can open the module it comes from (server: eventCenter.service).
  {
    key: "events",
    label: "Events",
    path: "/events",
  },
  {
    key: "endpoint",
    label: "Endpoint Hub",
    licenseModule: "ENDPOINT_MANAGER",
    items: [
      { path: "/endpoints", label: "Endpoints" },
      { path: "/enrollment-tokens", label: "Enrollment Tokens" },
      { path: "/commands", label: "Commands", feature: "EH_COMMANDS" },
      { path: "/packages", label: "Packages", feature: "EH_PACKAGES" },
      { path: "/agent-updates", label: "Agent Updates" },
      { path: "/asset-settings", label: "Asset Settings" },
      { path: "/user-consent", label: "User Consent" },
    ],
  },
  {
    key: "network",
    label: "Network Insight",
    licenseModule: "NETWORK_MANAGER",
    items: [{ path: "/network-scan", label: "Network Discovery" }],
  },
  {
    key: "security",
    label: "Security Posture",
    licenseModule: "SECURITY_MANAGER",
    items: [
      { path: "/vulnerabilities", label: "Vulnerabilities", feature: "SP_VULNERABILITIES" },
      { path: "/patches", label: "Patches", feature: "SP_PATCHES" },
      { path: "/security-config", label: "Security Configuration", feature: "SP_SECURITY_CONFIG" },
      { path: "/zero-trust", label: "Zero Trust", feature: "SP_ZERO_TRUST" },
      // EDR (Lite) hidden from the menu — every agent had it disabled first (see
      // edrEnabled on the Agent model), so no endpoint is actively scanning even though
      // the route/page still exists for direct navigation if it's ever re-enabled.
    ],
  },
  {
    key: "data",
    label: "Data Governance",
    licenseModule: "DATA_MANAGER",
    items: [
      { path: "/data-types", label: "Data Types" },
      { path: "/data-discovery", label: "Data Discovery", feature: "DG_DISCOVERY" },
      { path: "/dlp", label: "DLP", feature: "DG_DLP" },
      { path: "/data-movement", label: "Data Movement", feature: "DG_MOVEMENT" },
      { path: "/epm", label: "EPM", feature: "EPM" },
      { path: "/access-exceptions", label: "Access Exceptions" },
    ],
  },
  {
    key: "ai-guard",
    label: "AI Guard",
    licenseModule: "AI_GUARD",
    items: [
      { path: "/ai-guard/apps", label: "AI Tools" },
      { path: "/ai-guard/extensions", label: "AI Extensions", feature: "AI_EXTENSIONS" },
      { path: "/ai-guard/policies", label: "Policies" },
      { path: "/ai-guard/overview", label: "AI Usage" },
    ],
  },
  {
    key: "threat",
    label: "Threat Protection",
    licenseModule: "THREAT_PROTECTION",
    items: [
      { path: "/threat-protection/overview", label: "Overview" },
      { path: "/threat-protection/threats", label: "Threats" },
      { path: "/threat-protection/activity", label: "Scans and Actions" },
      { path: "/threat-protection/policies", label: "Policies" },
    ],
  },
  {
    key: "user",
    label: "Identity Governance",
    licenseModule: "USER_MANAGER",
    items: [
      { path: "/user-productivity", label: "User Productivity", feature: "IG_PRODUCTIVITY" },
      { path: "/user-risk", label: "User Risk", permission: "USER_RISK", feature: "IG_USER_RISK" },
      { path: "/admin-logs", label: "Admin Logs", superAdminOnly: true },
    ],
  },
  {
    key: "software",
    label: "App Center",
    licenseModule: "SOFTWARE_MANAGER",
    items: [{ path: "/software-licenses", label: "Software Licenses" }],
  },
  {
    key: "licensing",
    label: "Licensing",
    path: "/licensing",
  },
  {
    key: "admin-users",
    label: "Administrators",
    path: "/admin-users",
    superAdminOnly: true,
  },
];

// Display name of each licensed module, taken from its sidebar label - the single source for
// every page that names a module (locked-module screen, admin access grants, licensing,
// module visibility). Rename a module here and every page follows.
export const LICENSE_MODULE_LABELS = Object.fromEntries(
  NAV_MODULES.filter((m) => m.licenseModule).map((m) => [m.licenseModule!, m.label]),
) as Record<LicenseModuleKey, string>;
