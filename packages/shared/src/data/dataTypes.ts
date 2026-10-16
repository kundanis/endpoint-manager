import { z } from "zod";
import { PII_PATTERN_KEYS } from "./piiPatterns";

// Data types: named, categorised lists (file extensions, PII patterns, website domains,
// application process names, keywords) that DLP and EPM policies are built from. A policy's
// "Add from data type" turns each value into one rule of the matching type, so admins pick
// "Remote access tools" instead of typing AnyDesk.exe, UltraViewer_Desktop.exe, ... by hand.
//
// The built-in catalogue below ships with the product; admins add their own (custom) data
// types on top - those live in the DataType table.

export const DATA_TYPE_KINDS = ["FILE_EXTENSION", "PII_PATTERN", "DOMAIN", "PROCESS_NAME", "KEYWORD"] as const;
export type DataTypeKind = (typeof DATA_TYPE_KINDS)[number];

export const DATA_TYPE_KIND_LABELS: Record<DataTypeKind, string> = {
  FILE_EXTENSION: "File extensions",
  PII_PATTERN: "Personal data patterns",
  DOMAIN: "Websites",
  PROCESS_NAME: "Applications",
  KEYWORD: "Keywords",
};

// Policy areas a data type can be added to, and the rule type each kind becomes there.
export const DATA_TYPE_TARGETS = ["dlp", "piiEmailBlock", "appControl", "webBlock", "piiBlock", "commandBlock"] as const;
export type DataTypeTarget = (typeof DATA_TYPE_TARGETS)[number];

export const DATA_TYPE_TARGET_LABELS: Record<DataTypeTarget, string> = {
  dlp: "DLP content & file policies",
  piiEmailBlock: "DLP email attachment blocking",
  appControl: "EPM application control",
  webBlock: "EPM web & email blocking",
  piiBlock: "EPM PII data blocking",
  commandBlock: "EPM command blocking",
};

export const DATA_TYPE_RULE_TYPES: Record<DataTypeTarget, Partial<Record<DataTypeKind, string>>> = {
  dlp: { FILE_EXTENSION: "FILE_EXTENSION", PII_PATTERN: "CONTENT_PATTERN", KEYWORD: "CONTENT_KEYWORD" },
  piiEmailBlock: { PII_PATTERN: "PII_PATTERN" },
  appControl: { FILE_EXTENSION: "EXTENSION", PROCESS_NAME: "EXECUTABLE" },
  webBlock: { DOMAIN: "DOMAIN" },
  piiBlock: { PII_PATTERN: "PII_PATTERN" },
  commandBlock: { PROCESS_NAME: "PROCESS_NAME" },
};

export function targetsForKind(kind: DataTypeKind): DataTypeTarget[] {
  return DATA_TYPE_TARGETS.filter((t) => DATA_TYPE_RULE_TYPES[t][kind]);
}

export interface BuiltInDataType {
  id: string; // stable, e.g. "builtin:source-code"
  name: string;
  category: string;
  description: string;
  kind: DataTypeKind;
  values: string[];
  // Narrower than the kind allows: e.g. document types belong in DLP, never in application
  // control (which blocks programs from running).
  onlyTargets?: DataTypeTarget[];
}

// Where a data type can be added: its kind's targets, narrowed by onlyTargets.
export function targetsForDataType(dt: { kind: DataTypeKind; onlyTargets?: DataTypeTarget[] }): DataTypeTarget[] {
  const byKind = targetsForKind(dt.kind);
  return dt.onlyTargets ? byKind.filter((t) => dt.onlyTargets!.includes(t)) : byKind;
}

const PII = (keys: (typeof PII_PATTERN_KEYS)[number][]) => keys as string[];

export const BUILT_IN_DATA_TYPES: BuiltInDataType[] = [
  // ---- File types
  {
    id: "builtin:source-code",
    name: "Source code",
    category: "File types",
    description: "Program source files - the most common target for intellectual-property protection.",
    kind: "FILE_EXTENSION",
    onlyTargets: ["dlp"],
    values: [".c", ".cpp", ".cc", ".h", ".hpp", ".cs", ".java", ".kt", ".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".rb", ".php", ".swift", ".scala", ".sql", ".r", ".pl", ".dart", ".lua", ".groovy", ".vb", ".fs"],
  },
  {
    id: "builtin:office-documents",
    name: "Office documents",
    category: "File types",
    description: "Word, Excel, PowerPoint, PDF and similar business documents.",
    kind: "FILE_EXTENSION",
    onlyTargets: ["dlp"],
    values: [".doc", ".docx", ".docm", ".xls", ".xlsx", ".xlsm", ".xlsb", ".ppt", ".pptx", ".pdf", ".odt", ".ods", ".odp", ".rtf", ".csv"],
  },
  {
    id: "builtin:archives",
    name: "Archives and disk images",
    category: "File types",
    description: "Compressed archives and disk images, often used to move data out in bulk.",
    kind: "FILE_EXTENSION",
    onlyTargets: ["dlp"],
    values: [".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".cab", ".iso", ".img", ".vhd", ".vhdx"],
  },
  {
    id: "builtin:databases",
    name: "Databases and backups",
    category: "File types",
    description: "Database files, dumps and backups.",
    kind: "FILE_EXTENSION",
    onlyTargets: ["dlp"],
    values: [".mdb", ".accdb", ".db", ".sqlite", ".sqlite3", ".mdf", ".ldf", ".ndf", ".bak", ".dmp", ".dbf", ".frm", ".ibd"],
  },
  {
    id: "builtin:mailbox-files",
    name: "Mailbox and email files",
    category: "File types",
    description: "Outlook data files and saved emails.",
    kind: "FILE_EXTENSION",
    onlyTargets: ["dlp"],
    values: [".pst", ".ost", ".msg", ".eml", ".mbox"],
  },
  {
    id: "builtin:design-cad",
    name: "Design and CAD files",
    category: "File types",
    description: "Engineering drawings and design source files.",
    kind: "FILE_EXTENSION",
    onlyTargets: ["dlp"],
    values: [".dwg", ".dxf", ".step", ".stp", ".igs", ".iges", ".sldprt", ".sldasm", ".slddrw", ".ipt", ".iam", ".psd", ".ai", ".indd", ".fig", ".sketch"],
  },
  {
    id: "builtin:executables-scripts",
    name: "Executables and scripts",
    category: "File types",
    description: "Programs and scripts - block these to stop unapproved software and script-based malware.",
    kind: "FILE_EXTENSION",
    values: [".exe", ".msi", ".bat", ".cmd", ".ps1", ".vbs", ".vbe", ".jse", ".wsf", ".wsh", ".hta", ".scr", ".com", ".jar", ".pif"],
  },

  // ---- Personal data
  {
    id: "builtin:india-pii",
    name: "Indian personal data",
    category: "Personal data",
    description: "Aadhaar, PAN, Indian passport, GSTIN, IFSC and Indian mobile numbers (DPDP Act).",
    kind: "PII_PATTERN",
    values: PII(["AADHAAR", "PAN_INDIA", "PASSPORT_INDIA", "GSTIN", "IFSC_CODE", "PHONE_INDIA"]),
  },
  {
    id: "builtin:contact-pii",
    name: "Contact and network identifiers",
    category: "Personal data",
    description: "Email addresses, international phone numbers and IP addresses.",
    kind: "PII_PATTERN",
    values: PII(["EMAIL", "PHONE_GENERIC", "IP_ADDRESS"]),
  },
  {
    id: "builtin:financial",
    name: "Financial data",
    category: "Personal data",
    description: "Payment card numbers and bank account numbers (IBAN).",
    kind: "PII_PATTERN",
    values: PII(["CREDIT_CARD", "IBAN"]),
  },
  {
    id: "builtin:confidential-keywords",
    name: "Confidentiality markers",
    category: "Personal data",
    description: "Words that mark a document as confidential.",
    kind: "KEYWORD",
    values: ["Strictly confidential", "Confidential", "Internal use only", "Do not distribute", "Not for distribution", "Proprietary and confidential", "Restricted"],
  },

  // ---- Websites
  {
    id: "builtin:personal-email",
    name: "Personal email (webmail)",
    category: "Websites",
    description: "Consumer webmail. Business Microsoft 365 / Google Workspace mail is on different addresses and isn't affected.",
    kind: "DOMAIN",
    values: ["mail.google.com", "gmail.com", "outlook.live.com", "hotmail.com", "mail.yahoo.com", "mail.rediff.com", "rediffmail.com", "proton.me", "protonmail.com", "mail.aol.com", "gmx.com", "mail.yandex.com", "tutanota.com", "zohomail.in"],
  },
  {
    id: "builtin:cloud-storage",
    name: "Cloud drives and file sharing",
    category: "Websites",
    description: "Personal cloud storage and file-transfer sites. Business OneDrive / SharePoint (company.sharepoint.com) isn't affected.",
    kind: "DOMAIN",
    values: ["drive.google.com", "dropbox.com", "onedrive.live.com", "1drv.ms", "box.com", "mega.nz", "mega.io", "wetransfer.com", "we.tl", "icloud.com", "mediafire.com", "pcloud.com", "sync.com", "sendspace.com", "filemail.com", "terabox.com", "jumpshare.com"],
  },
  {
    id: "builtin:generative-ai",
    name: "Generative AI services",
    category: "Websites",
    description: "Public AI chat services, where pasted code or documents leave the organisation.",
    kind: "DOMAIN",
    values: ["chatgpt.com", "chat.openai.com", "gemini.google.com", "copilot.microsoft.com", "claude.ai", "perplexity.ai", "chat.deepseek.com", "deepseek.com", "poe.com", "character.ai", "meta.ai", "grok.com", "chat.mistral.ai"],
  },
  {
    id: "builtin:remote-access-sites",
    name: "Remote access tool websites",
    category: "Websites",
    description: "Download and web-access sites of remote desktop tools.",
    kind: "DOMAIN",
    values: ["anydesk.com", "ultraviewer.net", "teamviewer.com", "rustdesk.com", "remotedesktop.google.com", "splashtop.com", "screenconnect.com", "logmein.com", "supremocontrol.com", "ammyy.com", "getscreen.me", "remotepc.com"],
  },
  {
    id: "builtin:messaging-web",
    name: "Messaging and social (web)",
    category: "Websites",
    description: "Web versions of personal messaging and social media.",
    kind: "DOMAIN",
    values: ["web.whatsapp.com", "web.telegram.org", "discord.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "snapchat.com"],
  },

  // ---- Applications
  {
    id: "builtin:remote-access-apps",
    name: "Remote access tools",
    category: "Applications",
    description: "Remote desktop programs that let someone outside control the endpoint. Leave out the one your own support team uses.",
    kind: "PROCESS_NAME",
    values: ["AnyDesk.exe", "UltraViewer_Desktop.exe", "UltraViewer_Service.exe", "TeamViewer.exe", "TeamViewer_Service.exe", "rustdesk.exe", "AA_v3.exe", "Supremo.exe", "SupremoService.exe", "remoting_host.exe", "SRServer.exe", "ScreenConnect.ClientService.exe", "LogMeIn.exe"],
  },
  {
    id: "builtin:p2p-torrent",
    name: "Torrent and P2P clients",
    category: "Applications",
    description: "File-sharing clients that can leak data and bring in malware.",
    kind: "PROCESS_NAME",
    values: ["uTorrent.exe", "BitTorrent.exe", "qbittorrent.exe", "deluge.exe", "transmission-qt.exe", "Azureus.exe", "frostwire.exe", "tixati.exe"],
  },
  {
    id: "builtin:messaging-apps",
    name: "Personal messaging apps",
    category: "Applications",
    description: "Desktop messaging apps outside the organisation's control.",
    kind: "PROCESS_NAME",
    values: ["WhatsApp.exe", "Telegram.exe", "Signal.exe", "Discord.exe"],
  },
  {
    id: "builtin:cloud-sync-apps",
    name: "Personal cloud sync apps",
    category: "Applications",
    description: "Sync clients for personal cloud drives. The business OneDrive client isn't included.",
    kind: "PROCESS_NAME",
    values: ["Dropbox.exe", "GoogleDriveFS.exe", "MEGAsync.exe", "pCloud.exe", "iCloudDrive.exe"],
  },
];

// ---- Custom data types (admin-defined). Personal data patterns aren't offered here: those are
// built-in detection patterns, not free text.
export const CUSTOM_DATA_TYPE_KINDS = ["FILE_EXTENSION", "DOMAIN", "PROCESS_NAME", "KEYWORD"] as const;

export const createDataTypeRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  kind: z.enum(CUSTOM_DATA_TYPE_KINDS),
  values: z.array(z.string().trim().min(1).max(500)).min(1).max(500),
});
export type CreateDataTypeRequest = z.infer<typeof createDataTypeRequestSchema>;

export const updateDataTypeRequestSchema = createDataTypeRequestSchema.partial();
export type UpdateDataTypeRequest = z.infer<typeof updateDataTypeRequestSchema>;

export const applyDataTypesRequestSchema = z.object({
  target: z.enum(DATA_TYPE_TARGETS),
  policyId: z.string().min(1),
  dataTypeIds: z.array(z.string().min(1)).min(1).max(50),
});
export type ApplyDataTypesRequest = z.infer<typeof applyDataTypesRequestSchema>;

// Normalises a custom value for its kind: ".PY" / "py" -> ".py", "https://Mail.Example.com/x" ->
// "mail.example.com". Process names and keywords are kept as typed.
export function normalizeDataTypeValue(kind: DataTypeKind, raw: string): string {
  const v = raw.trim();
  if (kind === "FILE_EXTENSION") return `.${v.replace(/^\*?\.?/, "").toLowerCase()}`;
  if (kind === "DOMAIN") return v.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^\*\./, "").split(/[/?#:]/)[0];
  return v;
}

export interface DataTypeView {
  id: string;
  name: string;
  category: string;
  description: string | null;
  kind: DataTypeKind;
  values: string[];
  builtIn: boolean;
  targets: DataTypeTarget[];
}
