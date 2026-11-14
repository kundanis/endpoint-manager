// Built-in Zero Trust checks can be switched off or edited, not deleted. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { builtInConditionChoices, isProtectedConditionKey, REQUIRED_SOFTWARE_KEYS } from "../src/services/builtInZeroTrust";

test("built-in and required-software conditions are protected from deletion; custom ones aren't", () => {
  const builtIns = builtInConditionChoices();
  assert.equal(builtIns.length + REQUIRED_SOFTWARE_KEYS.length, 12);
  for (const c of builtIns) assert.ok(isProtectedConditionKey(c.conditionKey), `${c.conditionKey} should be protected`);
  for (const k of REQUIRED_SOFTWARE_KEYS) assert.ok(isProtectedConditionKey(k), `${k} should be protected`);
  for (const k of ["my-custom-check", "WIN-SECURITY-DEVICE-SECURITY", ""]) assert.equal(isProtectedConditionKey(k), false, `${k} should be deletable`);
});

test("the Windows Security checks pass only on COMPLIANT and say why they fail", () => {
  const byKey = new Map(builtInConditionChoices().map((c) => [c.conditionKey, c]));
  for (const k of ["win-security-account-protection", "win-security-app-browser-control", "win-security-device-security"]) {
    const c = byKey.get(k);
    assert.ok(c, `${k} exists`);
    assert.equal(c!.operator, "EQUALS");
    assert.equal(c!.expectedValue, "COMPLIANT");
    assert.match(c!.checkPowerShell, /NONCOMPLIANT: /, `${k} reports a reason`);
  }
  assert.doesNotMatch(byKey.get("win-security-account-protection")!.checkPowerShell, /ProgramData/, "Windows Hello is not under ProgramData");
});
