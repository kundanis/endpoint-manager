// Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { newAssignmentTargets } from "../src/utils/assignments";

test("already-assigned endpoints and groups are skipped", () => {
  const existing = [
    { agentId: "lap-92", groupId: null },
    { agentId: null, groupId: "finance" },
  ];
  assert.deepEqual(newAssignmentTargets(existing, ["lap-92", "lap-197"], ["finance", "hr"]), {
    agentIds: ["lap-197"],
    groupIds: ["hr"],
  });
});

test("repeats within one request are added once", () => {
  assert.deepEqual(newAssignmentTargets([], ["a", "a", "b"], ["g", "g"]), { agentIds: ["a", "b"], groupIds: ["g"] });
});

test("assigning only what's already there adds nothing", () => {
  assert.deepEqual(newAssignmentTargets([{ agentId: "a", groupId: null }], ["a"], []), { agentIds: [], groupIds: [] });
});
