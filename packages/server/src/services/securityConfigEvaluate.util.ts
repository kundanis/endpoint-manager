import type { SecurityRuleOperator } from "@em/shared";

function toNumber(v: string): number | null {
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

// REGEX_MATCH runs an admin-written pattern against agent-reported text on the server's event
// loop, so a catastrophically backtracking pattern (e.g. (a+)+$) fed a crafted value could
// stall the whole API. Bounded instead: short patterns only, no quantified group that itself
// contains a quantifier (the classic nested-quantifier shape), no backreferences, and the
// value is cut to MAX_REGEX_INPUT characters. A pattern refused here simply FAILs.
export const MAX_REGEX_PATTERN = 500;
export const MAX_REGEX_INPUT = 2000;
// A group containing + or * that is itself repeated without bound: (a+)+, (a|b*)*, (x+){2,}.
const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)\s*(?:[+*]|\{\d+,\})/;
const BACKREFERENCE = /\\[1-9]|\\k</;

export function isSafeRegexPattern(pattern: string): boolean {
  return pattern.length <= MAX_REGEX_PATTERN && !NESTED_QUANTIFIER.test(pattern) && !BACKREFERENCE.test(pattern);
}

export function safeRegexTest(pattern: string, input: string): boolean {
  if (!isSafeRegexPattern(pattern)) return false;
  try {
    return new RegExp(pattern).test(input.slice(0, MAX_REGEX_INPUT));
  } catch {
    return false;
  }
}

// Pure grading function — kept separate from ingestion so an admin editing a rule's
// operator/expectedValue can be understood (and unit-tested) independent of the
// upsert/persistence logic in securityConfigScan.service.ts.
export function evaluateRule(
  operator: SecurityRuleOperator,
  expectedValue: string,
  actualValue: string | null,
): "PASS" | "FAIL" {
  if (actualValue === null) return "FAIL";
  const actual = actualValue.trim();
  const expected = expectedValue.trim();

  switch (operator) {
    case "EQUALS":
      return actual.toLowerCase() === expected.toLowerCase() ? "PASS" : "FAIL";
    case "NOT_EQUALS":
      return actual.toLowerCase() !== expected.toLowerCase() ? "PASS" : "FAIL";
    case "CONTAINS":
      return actual.toLowerCase().includes(expected.toLowerCase()) ? "PASS" : "FAIL";
    case "REGEX_MATCH":
      return safeRegexTest(expected, actual) ? "PASS" : "FAIL";
    case "GTE": {
      const a = toNumber(actual);
      const e = toNumber(expected);
      return a !== null && e !== null && a >= e ? "PASS" : "FAIL";
    }
    case "LTE": {
      const a = toNumber(actual);
      const e = toNumber(expected);
      return a !== null && e !== null && a <= e ? "PASS" : "FAIL";
    }
    default:
      return "FAIL";
  }
}
