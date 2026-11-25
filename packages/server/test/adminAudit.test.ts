// Admin logs: describing API calls and keeping secrets out. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, redact } from "../src/services/adminAudit.service";

const ID = "3f2b1c4d-1111-4222-8333-444455556666";

test("API calls get a readable summary, module, category and target", () => {
  const create = describe("POST", "/zero-trust", { name: "Laptops baseline" });
  assert.deepEqual(create, { module: "Zero Trust", category: "Policies", action: "CREATE", summary: 'Created Zero Trust: "Laptops baseline"', targetId: null });

  const assign = describe("POST", `/zero-trust/${ID}/assign`, { agentIds: ["a"] });
  assert.equal(assign.action, "ASSIGN");
  assert.equal(assign.summary, "Zero Trust: assigned");
  assert.equal(assign.targetId, ID);

  const unassign = describe("DELETE", `/zero-trust/${ID}/assign/${ID}`, undefined);
  assert.equal(unassign.action, "UNASSIGN");

  const uninstall = describe("POST", `/agents/${ID}/uninstall-agent`, {});
  assert.equal(uninstall.category, "Endpoints");
  assert.equal(uninstall.summary, "Endpoints: started uninstalling the agent");

  const admin = describe("PATCH", `/admin-users/${ID}`, { role: "SUPER_ADMIN" });
  assert.equal(admin.category, "Administrators");
  assert.equal(admin.action, "UPDATE");

  const settings = describe("PUT", "/user-risk/settings", {});
  assert.equal(settings.summary, "Changed User risk (settings)");
});

test("secrets never reach the log; long scripts are shortened", () => {
  const out = redact({
    email: "a@b.com",
    password: "hunter2",
    smtp: { host: "smtp.x", password: "p", username: "u" },
    enrollmentToken: "tok",
    apiKey: "k",
    certificate: "-----BEGIN",
    script: "x".repeat(5000),
    list: [{ secret: "s", ok: 1 }],
  }) as Record<string, unknown>;
  assert.equal(out.email, "a@b.com");
  assert.equal(out.password, "[redacted]");
  assert.deepEqual(out.smtp, { host: "smtp.x", password: "[redacted]", username: "u" });
  assert.equal(out.enrollmentToken, "[redacted]");
  assert.equal(out.apiKey, "[redacted]");
  assert.equal(out.certificate, "[redacted]");
  assert.match(String(out.script), /\(5000 characters\)$/);
  assert.deepEqual(out.list, [{ secret: "[redacted]", ok: 1 }]);
});
