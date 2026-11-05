import type { DataTypeKind, DataTypeTarget } from "@em/shared";

// Display labels for data types (Data Governance -> Data types). Kept in the console because it
// only imports types, not runtime values, from @em/shared.
export const DATA_TYPE_KIND_LABELS: Record<DataTypeKind, string> = {
  FILE_EXTENSION: "File extensions",
  PII_PATTERN: "Personal data patterns",
  DOMAIN: "Websites",
  PROCESS_NAME: "Applications",
  KEYWORD: "Keywords",
};

export const DATA_TYPE_TARGET_LABELS: Record<DataTypeTarget, string> = {
  dlp: "DLP content & file",
  piiEmailBlock: "EPM email attachments",
  appControl: "EPM application control",
  webBlock: "EPM web & email",
  piiBlock: "DLP PII blocking",
  commandBlock: "EPM command blocking",
};

// Kinds an admin can create (personal-data patterns are built-in detectors only).
export const CUSTOM_KIND_OPTIONS: { value: Exclude<DataTypeKind, "PII_PATTERN">; label: string; placeholder: string }[] = [
  { value: "FILE_EXTENSION", label: "File extensions", placeholder: ".dwg\n.xlsx\n.sql" },
  { value: "DOMAIN", label: "Websites (domains)", placeholder: "example-share.com\nfiles.example.net" },
  { value: "PROCESS_NAME", label: "Applications (process names)", placeholder: "AnyDesk.exe\nsomeapp.exe" },
  { value: "KEYWORD", label: "Keywords", placeholder: "Project Falcon\nBoard minutes" },
];

// Where each policy area lives in the console.
export const DATA_TYPE_TARGET_PATHS: Record<DataTypeTarget, string> = {
  dlp: "/dlp/content-policies",
  piiEmailBlock: "/epm/email-attachment-block",
  appControl: "/epm/app-control",
  webBlock: "/epm/web-block",
  piiBlock: "/dlp/pii-block",
  commandBlock: "/epm/command-block",
};
