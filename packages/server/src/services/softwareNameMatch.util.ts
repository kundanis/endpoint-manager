// Shared free-text software-name normalization, used to heuristically match registry
// display names against both NVD CPE product slugs (vulnerabilityMatch.service.ts) and
// admin-entered software license names (softwareLicense.service.ts).
const NOISE_TOKENS = [
  "redistributable",
  "runtime",
  "package",
  "update",
  "hotfix",
  "security",
  "microsoft",
  "corporation",
  "inc",
  "llc",
  "ltd",
  "x64",
  "x86",
  "64-bit",
  "32-bit",
];

export function normalizeName(raw: string): string {
  let s = raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9.+\- ]/g, " ");
  for (const tok of NOISE_TOKENS) s = s.replace(new RegExp(`\\b${tok}\\b`, "g"), " ");
  return s.replace(/\s+/g, " ").trim();
}

export const compact = (s: string): string => s.replace(/[^a-z0-9]/g, "");

export const tokenize = (s: string): string[] => s.split(" ").filter((t) => t.length > 1 && !/^\d+(\.\d+)*$/.test(t));

// Registry display names that are OS patches / catalog items, not installed products. Matching
// them against CPE products is pure noise - a "Security Update for Microsoft Office 2016 (KB…)"
// row shares generic tokens with hundreds of Office CVEs and matched every one of them. These
// are never CVE-matchable software, so they're skipped before matching entirely.
export function isNonProductSoftware(rawName: string): boolean {
  const n = rawName.trim();
  return (
    /\(KB\d+\)/i.test(n) ||
    /^\s*(security |definition |critical |cumulative )?update for\b/i.test(n) ||
    /^\s*hotfix\b/i.test(n) ||
    /^\s*update rollup\b/i.test(n) ||
    /\blanguage pack\b/i.test(n)
  );
}

// Tokens too generic to anchor a CPE match on their own - they recur across many unrelated
// products, so a match that hinges only on one of these (rather than a real product word like
// "office", "edge", "acrobat", or an exact compacted-name match) is almost always spurious.
export const GENERIC_MATCH_TOKENS = new Set([
  "for", "and", "the", "with", "from", "windows", "server", "client", "edition", "version",
  "update", "service", "services", "tools", "tool", "driver", "drivers", "professional",
  "standard", "enterprise", "home", "core", "base", "common", "system", "application",
  "framework", "component", "setup", "installer", "plugin", "plus", "pack",
]);
