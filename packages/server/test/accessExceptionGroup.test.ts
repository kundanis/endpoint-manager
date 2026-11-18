// Access exception requests: one endpoint or a group. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPolicyAccessExceptionRequestSchema } from "@em/shared";

const base = { policyType: "USB_CONTROL", policyId: "p1", reason: "Vendor demo", durationMinutes: 60 };

test("a request names exactly one endpoint or one group", () => {
  assert.equal(createPolicyAccessExceptionRequestSchema.safeParse({ ...base, agentId: "a1" }).success, true);
  assert.equal(createPolicyAccessExceptionRequestSchema.safeParse({ ...base, groupId: "g1" }).success, true);
  assert.equal(createPolicyAccessExceptionRequestSchema.safeParse(base).success, false, "neither");
  assert.equal(createPolicyAccessExceptionRequestSchema.safeParse({ ...base, agentId: "a1", groupId: "g1" }).success, false, "both");
});
