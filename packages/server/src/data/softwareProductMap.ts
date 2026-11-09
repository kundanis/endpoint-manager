import type { InstalledSoftwareEntry } from "@em/shared";

// Which product an installed program really is, so vulnerability matching doesn't have to
// guess from words in its name.
//
// - "msrc" products are checked against Microsoft's Security Update Guide: for each CVE,
//   Microsoft names the build that fixes it, and we compare the endpoint's installed build.
// - "nvd" products are checked against the NVD records of exactly that vendor:product.
// - Programs a product claims but doesn't report on (report: false - e.g. the .NET Host entries
//   that come with every .NET runtime) are left out of matching altogether.
// Anything not listed here falls back to the name-matching heuristic.
//
// Bump MSRC_MAPPING_VERSION whenever an msrc family pattern changes: every Microsoft document
// is then read again so its fixes are filed under the new families.
export const MSRC_MAPPING_VERSION = 1;

export interface ProductIdentity {
  key: string; // family key, e.g. "sql-server-2019", "dotnet-runtime-8.0", "nvd:google:chrome"
  source: "msrc" | "nvd";
  nvd?: { vendor: string; product: string }[];
  version: string | null; // installed version as the vendor numbers it
  report: boolean; // false = claimed (kept away from the heuristic) but not reported on
  // Programs whose real version is spread over several entries (SQL Server: the "Hotfix …"
  // entry carries the patched build, the engine entry keeps the RTM build) are merged into
  // one product; the highest version wins.
  aggregate?: boolean;
  primary?: boolean; // the entry whose name stands for the merged product
  // A merged product only counts when one of its entries shows the product itself is
  // installed (SQL Server: the engine). SSMS alone also installs "SQL Server 2019 …" pieces.
  anchor?: boolean;
}

const num3 = (m: RegExpMatchArray, from = 1) => `${m[from]}.${m[from + 1]}.${m[from + 2]}`;

const SQL_MAJOR: Record<string, string> = { "2012": "11", "2014": "12", "2016": "13", "2017": "14", "2019": "15", "2022": "16", "2025": "17" };

// SQL Server pieces that are separate products (own CVEs, own versions), not the engine.
const SQL_SEPARATE = /Management Studio|Native Client|ODBC|OLE DB|T-SQL Language Service|Report Builder|Data-Tier|LocalDB|Compact|CLR Types|Management Objects|Policies|Upgrade Advisor|Migration Assistant|Express Edition Tools/i;

function identifyMicrosoft(e: InstalledSoftwareEntry): ProductIdentity | null {
  const name = e.name.trim();
  let m: RegExpMatchArray | null;

  // SQL Server engine (incl. its "Hotfix NNNN for SQL Server 2019 (KB…)" / "GDR …" entries).
  if ((m = name.match(/\bSQL Server (2012|2014|2016|2017|2019|2022|2025)\b/i)) && !SQL_SEPARATE.test(name)) {
    const year = m[1];
    const version = e.version && e.version.split(".")[0] === SQL_MAJOR[year] ? e.version : null;
    return {
      key: `sql-server-${year}`,
      source: "msrc",
      version,
      report: true,
      aggregate: true,
      primary: /^Microsoft SQL Server \d{4} \((64|32)-bit\)$/i.test(name),
      anchor: /^Microsoft SQL Server \d{4} \((64|32)-bit\)$|Database Engine Services/i.test(name),
    };
  }
  if (/^Microsoft Edge$/i.test(name)) return { key: "edge", source: "msrc", version: e.version, report: true };
  if ((m = name.match(/^Microsoft (?:\.NET(?: Core)? Runtime|Windows Desktop Runtime)\s*-?\s*(\d+)\.(\d+)\.(\d+)/i))) {
    return { key: `dotnet-runtime-${m[1]}.${m[2]}`, source: "msrc", version: num3(m), report: true };
  }
  if ((m = name.match(/^Microsoft \.NET (?:Host|Host FX Resolver|Targeting Pack|AppHost Pack|Toolset|SDK)\b.*?(\d+)\.(\d+)\.(\d+)/i))) {
    return { key: `dotnet-runtime-${m[1]}.${m[2]}`, source: "msrc", version: num3(m), report: false };
  }
  if ((m = name.match(/^Microsoft ASP\.NET Core (\d+)\.(\d+)\.(\d+)/i))) {
    return { key: `aspnetcore-${m[1]}.${m[2]}`, source: "msrc", version: num3(m), report: true };
  }
  if (/^Microsoft Visual Studio Code\b/i.test(name)) return { key: "vscode", source: "msrc", version: e.version, report: true };
  if (/^PowerShell 7(?:\.\d+)?-x(?:64|86)$/i.test(name) && e.version && (m = e.version.match(/^(7)\.(\d+)\./))) {
    return { key: `powershell-7.${m[2]}`, source: "msrc", version: e.version, report: true };
  }
  if ((m = name.match(/^Visual Studio (?:Community|Professional|Enterprise|Build Tools) (2017|2019|2022|2026)$/i))) {
    return { key: `visual-studio-${m[1]}`, source: "msrc", version: e.version, report: true };
  }
  if ((m = name.match(/^Microsoft ODBC Driver (\d+) for SQL Server$/i))) {
    return { key: `odbc-${m[1]}`, source: "msrc", version: e.version, report: true };
  }
  if (/^Microsoft OLE DB Driver(?: \d+)? for SQL Server$/i.test(name) && e.version && (m = e.version.match(/^(\d+)\./))) {
    return { key: `oledb-${m[1]}`, source: "msrc", version: e.version, report: true };
  }
  if (/^(?:Microsoft )?SQL Server Management Studio(?: - [\d.]+)?$/i.test(name)) {
    return { key: "ssms", source: "msrc", version: e.version, report: true };
  }
  // Microsoft 365 Apps / Office: Microsoft's feed points to a release-notes page instead of a
  // build number, so these can't be assessed from it - kept away from the name heuristic,
  // which only produced unverifiable matches for them.
  if (/^Microsoft (?:365|Office 365) Apps?\b|^Microsoft Office (?:Professional|Standard|Home|LTSC)|^Office 16 Click-to-Run/i.test(name)) {
    return { key: "office", source: "msrc", version: e.version, report: false };
  }
  return null;
}

// Common third-party products and their NVD names (vendor and product as stored, lower-case,
// underscores as spaces).
const NVD_PRODUCTS: { name: RegExp; nvd: { vendor: string; product: string }[]; versionFromName?: RegExp; report?: boolean }[] = [
  { name: /^Google Chrome$/i, nvd: [{ vendor: "google", product: "chrome" }] },
  { name: /^Mozilla Firefox\b.*\bESR\b/i, nvd: [{ vendor: "mozilla", product: "firefox esr" }] },
  { name: /^Mozilla Firefox\b/i, nvd: [{ vendor: "mozilla", product: "firefox" }] },
  { name: /^Mozilla Thunderbird\b/i, nvd: [{ vendor: "mozilla", product: "thunderbird" }] },
  { name: /^7-Zip\b/i, nvd: [{ vendor: "7-zip", product: "7-zip" }] },
  { name: /^Notepad\+\+/i, nvd: [{ vendor: "notepad-plus-plus", product: "notepad++" }] },
  { name: /^VLC media player$/i, nvd: [{ vendor: "videolan", product: "vlc media player" }] },
  { name: /^Adobe Acrobat Reader\b|^Adobe Reader\b/i, nvd: [{ vendor: "adobe", product: "acrobat reader dc" }, { vendor: "adobe", product: "acrobat reader" }] },
  { name: /^Adobe Acrobat\b/i, nvd: [{ vendor: "adobe", product: "acrobat dc" }, { vendor: "adobe", product: "acrobat" }] },
  { name: /^Zoom(?: Workplace)?(?: \(\d+-bit\))?$/i, nvd: [{ vendor: "zoom", product: "workplace" }, { vendor: "zoom", product: "zoom" }, { vendor: "zoom", product: "meetings" }] },
  { name: /^AnyDesk$/i, nvd: [{ vendor: "anydesk", product: "anydesk" }] },
  { name: /^TeamViewer\b/i, nvd: [{ vendor: "teamviewer", product: "teamviewer" }] },
  { name: /^WinRAR\b/i, nvd: [{ vendor: "rarlab", product: "winrar" }] },
  // The interpreter entry carries the version in its name (its DisplayVersion is 3.14.5150.0).
  { name: /^Python (\d+)\.(\d+)\.(\d+) \((?:64|32)-bit\)$/i, versionFromName: /^Python (\d+)\.(\d+)\.(\d+)/i, nvd: [{ vendor: "python", product: "python" }] },
  // The interpreter's own pieces (docs, pip bootstrap, Tcl/Tk…) and the launchers: not separate products.
  { name: /^Python \d+\.\d+\.\d+ .+\((?:64|32)-bit\)$|^Python Launcher$|^Python Install Manager$/i, nvd: [], report: false },
  { name: /^Git$|^Git version /i, nvd: [{ vendor: "git-scm", product: "git" }] },
  { name: /^Node\.js$/i, nvd: [{ vendor: "nodejs", product: "node.js" }] },
  { name: /^PuTTY\b/i, nvd: [{ vendor: "putty", product: "putty" }] },
  { name: /^WinSCP\b/i, nvd: [{ vendor: "winscp", product: "winscp" }] },
  { name: /^FileZilla(?: Client)?\b/i, nvd: [{ vendor: "filezilla-project", product: "filezilla client" }] },
  { name: /^Wireshark\b/i, nvd: [{ vendor: "wireshark", product: "wireshark" }] },
  { name: /^Foxit PDF Reader\b/i, nvd: [{ vendor: "foxit", product: "pdf reader" }] },
  { name: /^Foxit PDF Editor\b/i, nvd: [{ vendor: "foxit", product: "pdf editor" }] },
  { name: /^LibreOffice\b/i, nvd: [{ vendor: "libreoffice", product: "libreoffice" }] },
  { name: /^Oracle (?:VM )?VirtualBox\b/i, nvd: [{ vendor: "oracle", product: "vm virtualbox" }] },
  { name: /^VMware Workstation\b/i, nvd: [{ vendor: "vmware", product: "workstation" }] },
  { name: /^OpenVPN \d/i, nvd: [{ vendor: "openvpn", product: "openvpn" }] },
  { name: /^FortiClient\b/i, nvd: [{ vendor: "fortinet", product: "forticlient" }] },
  { name: /^Citrix Workspace\b/i, nvd: [{ vendor: "citrix", product: "workspace" }] },
  { name: /^Cisco Webex Meetings\b|^Webex$/i, nvd: [{ vendor: "cisco", product: "webex meetings" }] },
  { name: /^TightVNC\b/i, nvd: [{ vendor: "tightvnc", product: "tightvnc" }] },
  { name: /^IrfanView\b/i, nvd: [{ vendor: "irfanview", product: "irfanview" }] },
  { name: /^IntelliJ IDEA\b/i, nvd: [{ vendor: "jetbrains", product: "intellij idea" }] },
  { name: /^Docker Desktop$/i, nvd: [{ vendor: "docker", product: "desktop" }] },
  { name: /^MySQL Server \d/i, nvd: [{ vendor: "oracle", product: "mysql" }] },
];

export function identifyProduct(e: InstalledSoftwareEntry): ProductIdentity | null {
  const microsoft = identifyMicrosoft(e);
  if (microsoft) return microsoft;
  const name = e.name.trim();
  for (const p of NVD_PRODUCTS) {
    if (!p.name.test(name)) continue;
    const fromName = p.versionFromName ? name.match(p.versionFromName) : null;
    const key = p.nvd.length > 0 ? `nvd:${p.nvd[0].vendor}:${p.nvd[0].product}` : `nvd:claimed:${name.toLowerCase()}`;
    return {
      key,
      source: "nvd",
      nvd: p.nvd,
      version: fromName ? num3(fromName) : e.version,
      report: p.report !== false && p.nvd.length > 0,
    };
  }
  return null;
}

// MSRC product name -> family key. Only these products' fixes are stored.
export function msrcFamilyOf(productName: string): string | null {
  const n = productName.trim();
  let m: RegExpMatchArray | null;
  if ((m = n.match(/^Microsoft SQL Server (2012|2014|2016|2017|2019|2022|2025)\b.*\bfor (?:x64|x86|32-bit)/i))) return `sql-server-${m[1]}`;
  if (/^Microsoft Edge \(Chromium-based\)$/i.test(n)) return "edge";
  if ((m = n.match(/^(?:Microsoft )?\.NET (?:Core )?(\d+\.\d+)(?: runtime)?(?: installed on Windows)?$/i))) return `dotnet-runtime-${m[1]}`;
  if ((m = n.match(/^ASP\.NET Core (\d+\.\d+)$/i))) return `aspnetcore-${m[1]}`;
  if (/^Visual Studio Code$/i.test(n)) return "vscode";
  if ((m = n.match(/^PowerShell (7\.\d+)$/i))) return `powershell-${m[1]}`;
  if ((m = n.match(/^Microsoft Visual Studio (2017|2019|2022|2026) version/i))) return `visual-studio-${m[1]}`;
  if ((m = n.match(/^Microsoft ODBC Driver (\d+) for SQL Server(?: on Windows)?$/i))) return `odbc-${m[1]}`;
  if ((m = n.match(/^Microsoft OLE DB Driver (\d+) for SQL Server$/i))) return `oledb-${m[1]}`;
  if (/^(?:Microsoft )?SQL Server Management Studio\b/i.test(n)) return "ssms";
  return null;
}
