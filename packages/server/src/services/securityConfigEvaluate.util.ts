import type { SecurityRuleOperator } from "@em/shared";

function toNumber(v: string): number | null {
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
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
      try {
        return new RegExp(expected).test(actual) ? "PASS" : "FAIL";
      } catch {
        return "FAIL";
      }
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
