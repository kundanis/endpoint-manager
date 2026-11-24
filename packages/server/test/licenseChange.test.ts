// Licence change requests: the rule that lets a pushed reduction apply at its deadline without
// trusting the push. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LicenseTerms } from "@license/shared";
import { onlyReduces } from "../src/services/licenseChange.service";

const current: LicenseTerms = {
  maxAgents: 100,
  validityType: "ONE_YEAR",
  validUntil: "2027-03-31T23:59:59.000Z",
  modules: ["ENDPOINT_MANAGER", "SECURITY_MANAGER", "DATA_MANAGER"],
};

test("a real reduction may apply from the pushed copy", () => {
  assert.equal(onlyReduces(current, { ...current, modules: ["ENDPOINT_MANAGER", "SECURITY_MANAGER"] }), true, "module removed");
  assert.equal(onlyReduces(current, { ...current, maxAgents: 50 }), true, "fewer endpoints");
  assert.equal(onlyReduces(current, { ...current, validUntil: "2026-12-31T23:59:59.000Z" }), true, "earlier end date");
  assert.equal(onlyReduces({ ...current, validUntil: null }, { ...current }), true, "perpetual -> dated");
});

test("anything that would grant something is refused", () => {
  assert.equal(onlyReduces(current, { ...current, modules: [...current.modules, "THREAT_PROTECTION"] }), false, "module added");
  assert.equal(onlyReduces(current, { ...current, maxAgents: 50, modules: [...current.modules, "USER_MANAGER"] }), false, "mixed");
  assert.equal(onlyReduces(current, { ...current, maxAgents: 101 }), false, "more endpoints");
  assert.equal(onlyReduces(current, { ...current, validUntil: "2028-01-01T00:00:00.000Z" }), false, "later end date");
  assert.equal(onlyReduces(current, { ...current, validUntil: null }), false, "dated -> perpetual");
});
