// Zero Trust "Required software" conditions. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANTIVIRUS_PRODUCTS, DEFAULT_REQUIRED_SOFTWARE, MANAGEMENT_AGENTS, requiredSoftwareConditions } from "../src/services/builtInZeroTrust";
import { evaluateRule } from "../src/services/securityConfigEvaluate.util";

test("chosen products become the two conditions, graded on the OK: prefix", () => {
  const { upsert, remove } = requiredSoftwareConditions({
    antivirus: { name: "Sophos", match: ["Sophos"] },
    managementAgent: { name: "Tanium Client", match: ["Tanium"] },
  });
  assert.deepEqual(remove, []);
  assert.deepEqual(
    upsert.map((c) => c.conditionKey),
    ["antivirus-registered", "management-agent-installed"],
  );
  assert.equal(upsert[0].title, "Antivirus: Sophos is registered with Windows Security Center");
  assert.equal(upsert[1].title, "Management agent: Tanium Client is installed");
  for (const c of upsert) {
    assert.equal(evaluateRule(c.operator, c.expectedValue, "OK: Sophos Endpoint Agent"), "PASS");
    assert.equal(evaluateRule(c.operator, c.expectedValue, "Missing (registered: Windows Defender)"), "FAIL");
  }
});

test("\"don't check\" removes the condition", () => {
  const { upsert, remove } = requiredSoftwareConditions({ antivirus: null, managementAgent: null });
  assert.deepEqual(upsert, []);
  assert.deepEqual(remove, ["antivirus-registered", "management-agent-installed"]);
});

test("typed names are quoted for PowerShell, never run as code", () => {
  const [av] = requiredSoftwareConditions({ antivirus: { name: "O'Brien", match: ["O'Brien'; Remove-Item C:\\x"] }, managementAgent: null }).upsert;
  assert.match(av.checkPowerShell, /\$needles = @\('O''Brien''; Remove-Item C:\\x'\)/);
});

test("catalogue and default are well formed", () => {
  for (const p of [...ANTIVIRUS_PRODUCTS, ...MANAGEMENT_AGENTS]) {
    assert.ok(p.id && p.label && p.match.length > 0, p.id);
  }
  assert.equal(DEFAULT_REQUIRED_SOFTWARE.antivirus?.name, "Microsoft Defender Antivirus");
  assert.equal(DEFAULT_REQUIRED_SOFTWARE.managementAgent, null);
});
