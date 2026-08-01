// Regex patterns are plain strings, compiled (`new RegExp(pattern, "g")`) wherever they
// run — currently only agent-side, against text-file content. Console/server never
// execute these; they only ever see resolved labels and match *counts*, never the
// matched values themselves, so the personal data this module looks for never has to
// leave the endpoint to populate a compliance dashboard.
export const PII_REGULATIONS = ["DPDP", "GDPR"] as const;
export type PiiRegulation = (typeof PII_REGULATIONS)[number];

export const DATA_DISCOVERY_REGULATIONS = ["DPDP", "GDPR", "BOTH"] as const;
export type DataDiscoveryRegulation = (typeof DATA_DISCOVERY_REGULATIONS)[number];

export const PII_PATTERN_KEYS = [
  "EMAIL",
  "PHONE_INDIA",
  "PHONE_GENERIC",
  "CREDIT_CARD",
  "IP_ADDRESS",
  "IBAN",
  "AADHAAR",
  "PAN_INDIA",
  "PASSPORT_INDIA",
  "GSTIN",
  "IFSC_CODE",
] as const;
export type PiiPatternKey = (typeof PII_PATTERN_KEYS)[number];

export interface PiiPatternDefinition {
  key: PiiPatternKey;
  label: string;
  regulations: PiiRegulation[];
  pattern: string;
}

// DPDP (India's Digital Personal Data Protection Act) patterns lean on India-specific
// identifiers (Aadhaar/PAN/GSTIN/IFSC/Indian mobile numbers); GDPR patterns lean on the
// broader EU definition of personal data, which explicitly includes things like IP
// addresses. Email and credit/debit card numbers are treated as in-scope for both.
export const PII_PATTERN_CATALOG: PiiPatternDefinition[] = [
  {
    key: "EMAIL",
    label: "Email address",
    regulations: ["DPDP", "GDPR"],
    pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
  },
  {
    key: "PHONE_INDIA",
    label: "Indian mobile number",
    regulations: ["DPDP"],
    pattern: "(?<!\\d)(?:\\+?91[-\\s]?)?[6-9]\\d{9}(?!\\d)",
  },
  {
    key: "PHONE_GENERIC",
    label: "International phone number",
    regulations: ["GDPR"],
    pattern: "(?<!\\d)\\+\\d{7,14}(?!\\d)",
  },
  {
    // Loose digit-run match, narrowed by a Luhn checksum (agent-side, not in the regex
    // itself) — otherwise a bare 13-16 digit pattern flags far too many unrelated IDs.
    key: "CREDIT_CARD",
    label: "Credit/debit card number",
    regulations: ["DPDP", "GDPR"],
    pattern: "(?<!\\d)(?:\\d[ -]?){13,16}(?!\\d)",
  },
  {
    key: "IP_ADDRESS",
    label: "IP address",
    regulations: ["GDPR"],
    pattern: "(?<!\\d)(?:\\d{1,3}\\.){3}\\d{1,3}(?!\\d)",
  },
  {
    key: "IBAN",
    label: "IBAN (bank account)",
    regulations: ["GDPR"],
    pattern: "(?<![A-Z0-9])[A-Z]{2}\\d{2}[A-Z0-9]{10,30}(?![A-Z0-9])",
  },
  {
    key: "AADHAAR",
    label: "Aadhaar number",
    regulations: ["DPDP"],
    pattern: "(?<!\\d)[2-9]\\d{3}[ -]?\\d{4}[ -]?\\d{4}(?!\\d)",
  },
  {
    key: "PAN_INDIA",
    label: "PAN (Permanent Account Number)",
    regulations: ["DPDP"],
    pattern: "(?<![A-Z0-9])[A-Z]{5}\\d{4}[A-Z](?![A-Z0-9])",
  },
  {
    key: "PASSPORT_INDIA",
    label: "Indian passport number",
    regulations: ["DPDP"],
    pattern: "(?<![A-Z0-9])[A-PR-WYa-pr-wy]\\d{7}(?![A-Z0-9])",
  },
  {
    key: "GSTIN",
    label: "GSTIN (GST Identification Number)",
    regulations: ["DPDP"],
    pattern: "(?<![A-Z0-9])\\d{2}[A-Z]{5}\\d{4}[A-Z]\\d[Zz][A-Z\\d](?![A-Z0-9])",
  },
  {
    key: "IFSC_CODE",
    label: "IFSC code (bank branch)",
    regulations: ["DPDP"],
    pattern: "(?<![A-Z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Z0-9])",
  },
];

export function getPatternsForRegulation(regulation: DataDiscoveryRegulation): PiiPatternDefinition[] {
  if (regulation === "BOTH") return PII_PATTERN_CATALOG;
  return PII_PATTERN_CATALOG.filter((p) => p.regulations.includes(regulation));
}

export function getPiiPatternLabel(key: string): string {
  return PII_PATTERN_CATALOG.find((p) => p.key === key)?.label ?? key;
}
