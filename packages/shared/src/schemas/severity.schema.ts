import { z } from "zod";

// A single canonical scale that both patch severities (Microsoft's MSRC wording - Critical/
// Important/Moderate/Low/Unspecified) and vulnerability severities (NVD's CVSS wording -
// CRITICAL/HIGH/MEDIUM/LOW) collapse into, so a policy threshold or a cross-module report
// can compare "how bad" without caring which upstream source produced the string.
export const NORMALIZED_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type NormalizedSeverity = (typeof NORMALIZED_SEVERITIES)[number];

export const SEVERITY_RANK: Record<NormalizedSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  UNKNOWN: 0,
};

// MSRC's "Important" maps to HIGH, not its own tier - CVSS has no "Important" rating, and
// treating MSRC-Important as anything other than "one below Critical" would make an
// auto-patch policy's minSeverity threshold behave inconsistently depending on which
// upstream source happened to classify a given update.
const SEVERITY_ALIASES: Record<string, NormalizedSeverity> = {
  CRITICAL: "CRITICAL",
  IMPORTANT: "HIGH",
  HIGH: "HIGH",
  MODERATE: "MEDIUM",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

export function normalizeSeverity(raw: string | null | undefined): NormalizedSeverity {
  if (!raw) return "UNKNOWN";
  return SEVERITY_ALIASES[raw.trim().toUpperCase()] ?? "UNKNOWN";
}

export function meetsSeverityThreshold(raw: string | null | undefined, minSeverity: NormalizedSeverity): boolean {
  return SEVERITY_RANK[normalizeSeverity(raw)] >= SEVERITY_RANK[minSeverity];
}

export const normalizedSeveritySchema = z.enum(NORMALIZED_SEVERITIES);
