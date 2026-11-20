// Common applications an allowlist policy can pick instead of writing rules (rule type ALLOW_CATALOG,
// value = key). The server turns each into AppLocker allow rules when it sends the allowlist, so
// changing an entry here updates every policy that uses it.
//
// paths: the product's machine-wide install folders. They are under Program Files, which only
//   administrators can write to, so a dropped file can't use them. %PROGRAMFILES% covers both
//   Program Files and Program Files (x86); * works anywhere in a path.
// publishers: only where the signer is known exactly (read with Get-AppLockerFileInformation from
//   the real program) - Windows compares the whole signer name. Covers per-user installs too.
// names: how the product appears in Windows' installed-software list (lower case, matched from the
//   start of the name; "=name" matches the whole name only), so Application control -> Undefined
//   applications knows which installed software it covers.

export interface CatalogPublisher {
  publisher: string;
  product: string;
}

export interface CatalogApp {
  key: string;
  name: string;
  category: string;
  paths: string[];
  publishers?: CatalogPublisher[];
  names: string[];
}

const MICROSOFT = "O=MICROSOFT CORPORATION, L=REDMOND, S=WASHINGTON, C=US";
const GOOGLE = "O=GOOGLE LLC, L=MOUNTAIN VIEW, S=CALIFORNIA, C=US";
const PF = "%PROGRAMFILES%\\";

export const APP_CATALOG_CATEGORIES = [
  "Microsoft",
  "Office and email",
  "Browsers",
  "PDF",
  "Compression",
  "Remote support",
  "Meetings and chat",
  "VPN",
  "Security",
  "Hardware and OEM tools",
  "Developer tools",
  "Media and graphics",
  "Business",
] as const;

export const APP_CATALOG: readonly CatalogApp[] = [
  // Microsoft
  {
    key: "ms-office",
    name: "Microsoft 365 / Office (Word, Excel, PowerPoint, Outlook, OneNote, Access, Visio, Project)",
    category: "Microsoft",
    paths: [`${PF}Microsoft Office\\*`, `${PF}Common Files\\microsoft shared\\*`],
    names: ["microsoft 365", "microsoft office", "microsoft visio", "microsoft project", "microsoft onenote", "microsoft access", "microsoft outlook"],
  },
  {
    key: "ms-onedrive",
    name: "Microsoft OneDrive",
    category: "Microsoft",
    paths: [`${PF}Microsoft OneDrive\\*`],
    publishers: [{ publisher: MICROSOFT, product: "Microsoft OneDrive" }],
    names: ["microsoft onedrive"],
  },
  {
    key: "ms-teams-classic",
    name: "Microsoft Teams (classic) and Teams Meeting Add-in",
    category: "Microsoft",
    paths: [`${PF}Microsoft\\Teams\\*`, `${PF}Teams Installer\\*`, `${PF}Microsoft\\TeamsMeetingAdd-in\\*`],
    publishers: [{ publisher: MICROSOFT, product: "Microsoft Teams" }],
    names: ["microsoft teams", "teams machine-wide installer"],
  },
  { key: "ms-powerbi", name: "Microsoft Power BI Desktop", category: "Microsoft", paths: [`${PF}Microsoft Power BI Desktop\\*`], names: ["microsoft power bi desktop"] },
  { key: "ms-power-automate", name: "Power Automate for desktop", category: "Microsoft", paths: [`${PF}Power Automate Desktop\\*`], names: ["power automate for desktop"] },
  { key: "ms-remote-desktop", name: "Microsoft Remote Desktop (Azure Virtual Desktop client)", category: "Microsoft", paths: [`${PF}Remote Desktop\\*`], names: ["remote desktop"] },
  { key: "ms-ssms", name: "SQL Server Management Studio", category: "Microsoft", paths: [`${PF}Microsoft SQL Server Management Studio*\\*`], names: ["sql server management studio", "microsoft sql server management studio"] },
  { key: "ms-azure-data-studio", name: "Azure Data Studio", category: "Microsoft", paths: [`${PF}Azure Data Studio\\*`], names: ["azure data studio"] },
  { key: "ms-visual-studio", name: "Visual Studio", category: "Microsoft", paths: [`${PF}Microsoft Visual Studio\\*`], names: ["visual studio community", "visual studio professional", "visual studio enterprise", "microsoft visual studio"] },
  {
    key: "vscode",
    name: "Visual Studio Code",
    category: "Microsoft",
    paths: [`${PF}Microsoft VS Code\\*`],
    publishers: [{ publisher: MICROSOFT, product: "Visual Studio Code" }],
    names: ["microsoft visual studio code"],
  },
  { key: "ms-powershell7", name: "PowerShell 7", category: "Microsoft", paths: [`${PF}PowerShell\\*`], names: ["powershell 7"] },

  // Office and email
  { key: "libreoffice", name: "LibreOffice", category: "Office and email", paths: [`${PF}LibreOffice\\*`], names: ["libreoffice"] },
  { key: "thunderbird", name: "Mozilla Thunderbird", category: "Office and email", paths: [`${PF}Mozilla Thunderbird\\*`], names: ["mozilla thunderbird"] },
  { key: "em-client", name: "eM Client", category: "Office and email", paths: [`${PF}eM Client\\*`], names: ["em client"] },

  // Browsers
  {
    key: "chrome",
    name: "Google Chrome",
    category: "Browsers",
    paths: [`${PF}Google\\Chrome\\*`, `${PF}Google\\Update\\*`, `${PF}Google\\GoogleUpdater\\*`],
    publishers: [
      { publisher: GOOGLE, product: "Google Chrome" },
      { publisher: GOOGLE, product: "Google Update" },
    ],
    names: ["google chrome"],
  },
  { key: "firefox", name: "Mozilla Firefox", category: "Browsers", paths: [`${PF}Mozilla Firefox\\*`, `${PF}Mozilla Maintenance Service\\*`], names: ["mozilla firefox", "mozilla maintenance service"] },
  { key: "brave", name: "Brave", category: "Browsers", paths: [`${PF}BraveSoftware\\*`], names: ["brave"] },

  // PDF
  { key: "adobe-reader", name: "Adobe Acrobat / Acrobat Reader", category: "PDF", paths: [`${PF}Adobe\\*`, `${PF}Common Files\\Adobe\\*`], names: ["adobe acrobat"] },
  { key: "foxit", name: "Foxit PDF Reader / Editor", category: "PDF", paths: [`${PF}Foxit Software\\*`], names: ["foxit"] },
  { key: "pdf-xchange", name: "PDF-XChange Editor", category: "PDF", paths: [`${PF}Tracker Software\\*`], names: ["pdf-xchange"] },
  { key: "nitro", name: "Nitro PDF", category: "PDF", paths: [`${PF}Nitro\\*`], names: ["nitro pdf", "nitro pro"] },

  // Compression
  { key: "winzip", name: "WinZip", category: "Compression", paths: [`${PF}WinZip\\*`], names: ["winzip"] },
  { key: "winrar", name: "WinRAR", category: "Compression", paths: [`${PF}WinRAR\\*`], names: ["winrar"] },
  { key: "7zip", name: "7-Zip", category: "Compression", paths: [`${PF}7-Zip\\*`], names: ["7-zip"] },

  // Remote support
  { key: "ultraviewer", name: "UltraViewer", category: "Remote support", paths: [`${PF}UltraViewer\\*`], names: ["ultraviewer"] },
  { key: "anydesk", name: "AnyDesk (installed)", category: "Remote support", paths: [`${PF}AnyDesk\\*`], names: ["anydesk"] },
  { key: "teamviewer", name: "TeamViewer", category: "Remote support", paths: [`${PF}TeamViewer\\*`], names: ["teamviewer"] },
  { key: "realvnc", name: "RealVNC (VNC Viewer / Server)", category: "Remote support", paths: [`${PF}RealVNC\\*`], names: ["vnc ", "realvnc"] },
  { key: "chrome-remote-desktop", name: "Chrome Remote Desktop", category: "Remote support", paths: [`${PF}Google\\Chrome Remote Desktop\\*`], names: ["chrome remote desktop"] },
  { key: "splashtop", name: "Splashtop", category: "Remote support", paths: [`${PF}Splashtop\\*`], names: ["splashtop"] },
  { key: "rustdesk", name: "RustDesk", category: "Remote support", paths: [`${PF}RustDesk\\*`], names: ["rustdesk"] },

  // Meetings and chat
  { key: "zoom", name: "Zoom (installed for all users)", category: "Meetings and chat", paths: [`${PF}Zoom\\*`], names: ["zoom"] },

  // VPN
  { key: "forticlient", name: "FortiClient VPN", category: "VPN", paths: [`${PF}Fortinet\\*`], names: ["forticlient"] },
  { key: "cisco-secure-client", name: "Cisco Secure Client / AnyConnect", category: "VPN", paths: [`${PF}Cisco\\*`], names: ["cisco secure client", "cisco anyconnect"] },
  { key: "globalprotect", name: "GlobalProtect", category: "VPN", paths: [`${PF}Palo Alto Networks\\*`], names: ["globalprotect"] },
  { key: "openvpn", name: "OpenVPN", category: "VPN", paths: [`${PF}OpenVPN\\*`, `${PF}OpenVPN Connect\\*`], names: ["openvpn"] },
  { key: "wireguard", name: "WireGuard", category: "VPN", paths: [`${PF}WireGuard\\*`], names: ["wireguard"] },

  // Security
  { key: "sophos", name: "Sophos", category: "Security", paths: [`${PF}Sophos\\*`], names: ["sophos"] },
  { key: "kaspersky", name: "Kaspersky", category: "Security", paths: [`${PF}Kaspersky Lab\\*`], names: ["kaspersky"] },
  { key: "quickheal", name: "Quick Heal / Seqrite", category: "Security", paths: [`${PF}Quick Heal\\*`, `${PF}Seqrite\\*`], names: ["quick heal", "seqrite"] },
  { key: "eset", name: "ESET", category: "Security", paths: [`${PF}ESET\\*`], names: ["eset"] },
  { key: "trendmicro", name: "Trend Micro", category: "Security", paths: [`${PF}Trend Micro\\*`], names: ["trend micro"] },
  { key: "symantec", name: "Symantec / Broadcom Endpoint", category: "Security", paths: [`${PF}Symantec\\*`], names: ["symantec"] },

  // Hardware and OEM tools
  { key: "dell-tools", name: "Dell tools (Command | Update, SupportAssist)", category: "Hardware and OEM tools", paths: [`${PF}Dell\\*`], names: ["dell "] },
  { key: "hp-tools", name: "HP tools (Support Assistant, HP Smart)", category: "Hardware and OEM tools", paths: [`${PF}HP\\*`, `${PF}Hewlett-Packard\\*`], names: ["hp "] },
  { key: "lenovo-tools", name: "Lenovo tools (System Update, Commercial Vantage)", category: "Hardware and OEM tools", paths: [`${PF}Lenovo\\*`], names: ["lenovo "] },

  // Developer tools
  { key: "git", name: "Git for Windows", category: "Developer tools", paths: [`${PF}Git\\*`], names: ["=git", "git version"] },
  { key: "nodejs", name: "Node.js", category: "Developer tools", paths: [`${PF}nodejs\\*`], names: ["node.js"] },
  { key: "python", name: "Python (installed for all users)", category: "Developer tools", paths: [`${PF}Python*\\*`], names: ["=python", "python "] },
  { key: "docker-desktop", name: "Docker Desktop", category: "Developer tools", paths: [`${PF}Docker\\*`], names: ["docker desktop"] },
  { key: "notepadpp", name: "Notepad++", category: "Developer tools", paths: [`${PF}Notepad++\\*`], names: ["notepad++"] },
  { key: "putty", name: "PuTTY", category: "Developer tools", paths: [`${PF}PuTTY\\*`], names: ["putty"] },
  { key: "winscp", name: "WinSCP", category: "Developer tools", paths: [`${PF}WinSCP\\*`], names: ["winscp"] },
  { key: "filezilla", name: "FileZilla", category: "Developer tools", paths: [`${PF}FileZilla FTP Client\\*`], names: ["filezilla"] },
  { key: "jetbrains", name: "JetBrains IDEs", category: "Developer tools", paths: [`${PF}JetBrains\\*`], names: ["intellij", "pycharm", "webstorm", "rider", "datagrip", "phpstorm", "goland", "clion"] },
  { key: "java", name: "Java (Oracle)", category: "Developer tools", paths: [`${PF}Java\\*`, `${PF}Common Files\\Oracle\\Java\\*`], names: ["java "] },

  // Media and graphics
  { key: "vlc", name: "VLC media player", category: "Media and graphics", paths: [`${PF}VideoLAN\\*`], names: ["vlc media player"] },
  { key: "audacity", name: "Audacity", category: "Media and graphics", paths: [`${PF}Audacity\\*`], names: ["audacity"] },
  { key: "gimp", name: "GIMP", category: "Media and graphics", paths: [`${PF}GIMP*\\*`], names: ["gimp"] },
  { key: "paintnet", name: "Paint.NET", category: "Media and graphics", paths: [`${PF}paint.net\\*`], names: ["paint.net"] },
  { key: "irfanview", name: "IrfanView", category: "Media and graphics", paths: [`${PF}IrfanView\\*`], names: ["irfanview"] },

  // Business
  { key: "tally", name: "TallyPrime", category: "Business", paths: [`${PF}TallyPrime\\*`], names: ["tallyprime", "tally.erp"] },
  { key: "sap-gui", name: "SAP GUI", category: "Business", paths: [`${PF}SAP\\*`], names: ["sap gui"] },
];

export const catalogApp = (key: string) => APP_CATALOG.find((a) => a.key === key);

// The catalog entry an installed-software name belongs to, if any.
export function catalogAppForSoftware(softwareName: string): CatalogApp | undefined {
  const n = softwareName.trim().toLowerCase();
  // The longest matching name wins ("microsoft visual studio code" over "microsoft visual studio").
  let best: { app: CatalogApp; length: number } | undefined;
  for (const app of APP_CATALOG) {
    for (const p of app.names) {
      const hit = p.startsWith("=") ? n === p.slice(1) : n.startsWith(p);
      if (hit && (!best || p.length > best.length)) best = { app, length: p.length };
    }
  }
  return best?.app;
}
