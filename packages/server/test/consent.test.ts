// Endpoint user consent (DPDP): when an endpoint may send monitoring data. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { endpointConsentState } from "@em/shared";

const a = (decision: "PENDING" | "AGREED" | "DECLINED", noticeVersion: number | null = 2) => ({ account: "PC\\user", decision, noticeVersion });

test("consent switched off: nothing to ask", () => {
  assert.equal(endpointConsentState(false, 2, []), "NOT_REQUIRED");
  assert.equal(endpointConsentState(false, 2, [a("DECLINED")]), "NOT_REQUIRED");
});

test("nobody has answered yet: pending", () => {
  assert.equal(endpointConsentState(true, 2, []), "PENDING");
  assert.equal(endpointConsentState(true, 2, [a("PENDING", null)]), "PENDING");
});

test("every signed-in user must agree to the notice in force", () => {
  assert.equal(endpointConsentState(true, 2, [a("AGREED")]), "ACTIVE");
  assert.equal(endpointConsentState(true, 2, [a("AGREED"), a("PENDING", null)]), "PENDING");
  assert.equal(endpointConsentState(true, 2, [a("AGREED"), a("DECLINED")]), "DECLINED");
});

test("an answer to an older version counts as not answered", () => {
  assert.equal(endpointConsentState(true, 3, [a("AGREED", 2)]), "PENDING");
  assert.equal(endpointConsentState(true, 3, [a("DECLINED", 2)]), "PENDING");
});
