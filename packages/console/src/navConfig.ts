import type { LicenseModuleKey } from "./api/types";

export interface NavItem {
  path: string;
  label: string;
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
}

export const NAV_MODULES: NavModule[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: "/dashboard",
  },
  {
    key: "endpoint",
    label: "Endpoint Manager",
    licenseModule: "ENDPOINT_MANAGER",
    items: [
      { path: "/endpoints", label: "Endpoints" },
      { path: "/enrollment-tokens", label: "Enrollment Tokens" },
      { path: "/commands", label: "Commands" },
      { path: "/packages", label: "Packages" },
      { path: "/asset-settings", label: "Asset Settings" },
    ],
  },
  {
    key: "network",
    label: "Network Manager",
    licenseModule: "NETWORK_MANAGER",
    items: [{ path: "/network-scan", label: "Network Scan" }],
  },
  {
    key: "software",
    label: "Software Manager",
    licenseModule: "SOFTWARE_MANAGER",
    items: [{ path: "/software-licenses", label: "Software Licenses" }],
  },
  {
    key: "security",
    label: "Security Manager",
    licenseModule: "SECURITY_MANAGER",
    items: [
      { path: "/vulnerabilities", label: "Vulnerabilities" },
      { path: "/patches", label: "Patches" },
      { path: "/security-config", label: "Security Configuration" },
      { path: "/zero-trust", label: "Zero Trust" },
      { path: "/edr", label: "EDR (Lite)" },
    ],
  },
  {
    key: "data",
    label: "Data Manager",
    licenseModule: "DATA_MANAGER",
    items: [
      { path: "/data-discovery", label: "Data Discovery" },
      { path: "/dlp", label: "DLP" },
      { path: "/data-movement", label: "Data Movement" },
      { path: "/epm", label: "EPM" },
      { path: "/access-exceptions", label: "Access Exceptions" },
    ],
  },
  {
    key: "user",
    label: "User Manager",
    licenseModule: "USER_MANAGER",
    items: [{ path: "/user-productivity", label: "User Productivity" }],
  },
  {
    key: "licensing",
    label: "Licensing",
    path: "/licensing",
  },
];
