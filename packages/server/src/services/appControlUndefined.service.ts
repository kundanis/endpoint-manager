import { catalogAppForSoftware } from "@em/shared";
import type { AppControlRule } from "@prisma/client";
import { prisma } from "../db";

// Application control -> Undefined applications: software installed on endpoints (their inventory)
// that no Application control policy names yet - neither a block rule nor an allow rule. Matching
// is by the installed-software name and publisher, as that is what inventory has (no program
// paths): close enough to show what still needs a decision, not a guarantee of what Windows does.

interface InstalledEntry {
  name: string;
  version: string | null;
  publisher: string | null;
}

// "WinRAR 7.01 (64-bit)" -> "WinRAR"; "Microsoft Windows Desktop Runtime - 8.0.32 (x64)" -> "Microsoft Windows Desktop Runtime"
export function softwareBaseName(name: string): string {
  const stripped = name
    .replace(/\s*\((x64|x86|64-bit|32-bit|amd64|arm64)\)/gi, "")
    .replace(/\s+[-–]?\s*v?\d+(\.\d+)+\b.*$/i, "")
    .replace(/\s+version$/i, "")
    .trim();
  return stripped || name.trim();
}

// Drivers, runtimes, updates and Windows' own parts: they don't need a decision (Windows and its
// drivers always run under an allowlist; runtimes are libraries, not applications).
const SYSTEM_NAME =
  /(driver|runtime|redistributable|hotfix|\(kb\d+\)|security update|update for|service pack|\bsdk\b|webview2|host fx|\.net host|visual c\+\+|framework|management engine|wmi provider|vss writer|odbc driver|oledb|chipset|firmware|bios|\bmicrosoft edge\b|windows subsystem|application compatibility|level zero|lms\b)/i;
// Parts of server products and shared components (SQL Server services, providers, setup pieces).
const COMPONENT_NAME =
  /(^(microsoft )?sql server 20\d\d\b|^browser for sql server|^integration services$|ole db|native client|batch parser|management objects|language pack|post install|isolated shell|hosting support|extensibility component|help viewer|\bmpi\b|t-sql language service|setup \()/i;
const SYSTEM_PUBLISHER = /^(intel|realtek|nvidia|advanced micro devices|amd|synaptics|elan|conexant|waves|dolby|dts|qualcomm|mediatek|broadcom)\b/i;

export function isSystemComponent(e: Pick<InstalledEntry, "name" | "publisher">): boolean {
  return SYSTEM_NAME.test(e.name) || COMPONENT_NAME.test(e.name) || SYSTEM_PUBLISHER.test(e.publisher ?? "");
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

// The organisation in a signer name: "O=GOOGLE LLC, L=..." -> "GOOGLE LLC".
const orgOf = (dn: string) => (dn.match(/(?:^|,\s*)O=("(?:[^"]|"")*"|[^,]*)/i)?.[1] ?? dn).replace(/^"|"$/g, "").trim();

const globToRegex = (glob: string) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");

// Whether a rule names this installed software.
export function ruleCovers(rule: Pick<AppControlRule, "ruleType" | "value" | "productName">, e: Pick<InstalledEntry, "name" | "publisher">): boolean {
  const name = e.name.toLowerCase();
  const base = softwareBaseName(e.name).toLowerCase();
  const value = rule.value.trim();
  switch (rule.ruleType) {
    case "ALLOW_CATALOG":
      return catalogAppForSoftware(e.name)?.key === value;
    case "ALLOW_PUBLISHER": {
      if (!e.publisher || letters(orgOf(value)) !== letters(e.publisher)) return false;
      return !rule.productName || name.includes(rule.productName.toLowerCase());
    }
    case "PUBLISHER":
      return !!e.publisher && letters(e.publisher).includes(letters(value.replace(/[*?]/g, "")));
    case "PRODUCT":
      return /[*?]/.test(value) ? globToRegex(value).test(e.name) || globToRegex(value).test(base) : base === value.toLowerCase() || name.startsWith(value.toLowerCase());
    case "EXECUTABLE": {
      const file = value.slice(value.lastIndexOf("\\") + 1).replace(/\.exe$/i, "").toLowerCase();
      return file.length >= 3 && !/[*?]/.test(file) && (base === file || letters(base) === letters(file));
    }
    default:
      return false; // folder and hash rules can't be matched to inventory (it has no paths)
  }
}

export async function getUndefinedApplications(includeSystem = false) {
  const [snapshots, policies] = await Promise.all([
    prisma.inventorySnapshot.findMany({ select: { agentId: true, installedSoftware: true, agent: { select: { hostname: true } } } }),
    prisma.appControlPolicy.findMany({ include: { rules: true } }),
  ]);
  const rules = policies.flatMap((p) => p.rules);

  interface Row {
    name: string;
    publisher: string | null;
    versions: Set<string>;
    endpoints: Map<string, string>;
  }
  const rows = new Map<string, Row>();
  let systemCount = 0;
  let definedCount = 0;
  const seenSystem = new Set<string>();
  const seenDefined = new Set<string>();

  for (const s of snapshots) {
    let list: InstalledEntry[] = [];
    try {
      list = JSON.parse(s.installedSoftware) as InstalledEntry[];
    } catch {
      continue;
    }
    for (const e of list) {
      if (!e?.name) continue;
      const name = softwareBaseName(e.name);
      const key = `${name.toLowerCase()}|${(e.publisher ?? "").toLowerCase()}`;
      if (!includeSystem && isSystemComponent(e)) {
        if (!seenSystem.has(key)) systemCount++;
        seenSystem.add(key);
        continue;
      }
      if (rules.some((r) => ruleCovers(r, e))) {
        if (!seenDefined.has(key)) definedCount++;
        seenDefined.add(key);
        continue;
      }
      let row = rows.get(key);
      if (!row) {
        row = { name, publisher: e.publisher, versions: new Set(), endpoints: new Map() };
        rows.set(key, row);
      }
      if (e.version) row.versions.add(e.version);
      row.endpoints.set(s.agentId, s.agent.hostname);
    }
  }

  const applications = [...rows.values()]
    .map((r) => {
      const catalog = catalogAppForSoftware(r.name);
      return {
        name: r.name,
        publisher: r.publisher,
        versions: [...r.versions].sort().slice(0, 10),
        endpointCount: r.endpoints.size,
        endpoints: [...r.endpoints.entries()].map(([agentId, hostname]) => ({ agentId, hostname })).sort((a, b) => a.hostname.localeCompare(b.hostname)),
        catalogKey: catalog?.key ?? null,
        catalogName: catalog?.name ?? null,
      };
    })
    .sort((a, b) => b.endpointCount - a.endpointCount || a.name.localeCompare(b.name));

  return { endpointCount: snapshots.length, applications, definedCount, hiddenSystemCount: includeSystem ? 0 : systemCount };
}
