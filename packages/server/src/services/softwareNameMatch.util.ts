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
