// Auth / deployment hardening: plain-HTTP agent-only port, production secret checks, the
// PowerShell-authoring grant and the bounded login lockout. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Request } from "express";

test("plain HTTP (with HTTPS configured) serves agent paths only", async () => {
  const { isPlainHttpAllowedPath } = await import("../src/middleware/plainHttpListener");
  for (const p of ["/health", "/api/agent/checkin", "/api/agent/enroll", "/api/agent/packages/x/download?a=1", "/api/license-callback/revoke"]) {
    assert.equal(isPlainHttpAllowedPath(p), true, p);
  }
  for (const p of ["/", "/login", "/api/auth/login", "/api/admin/agents", "/api/agentx", "/api/email-addin/x", "/outlook-addin/manifest.xml", "/healthz", "//api/agent/checkin"]) {
    assert.equal(isPlainHttpAllowedPath(p), false, p);
  }
});

test("browser requests are redirected to the same host on the HTTPS port", async () => {
  const { httpsRedirectUrl } = await import("../src/middleware/plainHttpListener");
  assert.equal(httpsRedirectUrl("10.0.0.5:4000", 443, "/endpoints?x=1"), "https://10.0.0.5/endpoints?x=1");
  assert.equal(httpsRedirectUrl("epp.example.com:4000", 8443, "/"), "https://epp.example.com:8443/");
  assert.equal(httpsRedirectUrl("[fe80::1]:4000", 443, "/"), "https://[fe80::1]/");
  assert.equal(httpsRedirectUrl("evil.com/@x", 443, "/"), null, "no header text echoed into Location");
  assert.equal(httpsRedirectUrl(undefined, 443, "/"), null);
});

test("the plain-HTTP listener passes agent traffic through and redirects or refuses the rest", async () => {
  const { plainHttpListener } = await import("../src/middleware/plainHttpListener");
  const app: http.RequestListener = (_req, res) => res.end("app");
  const server = http.createServer(plainHttpListener(app, 443));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const agent = await fetch(`${base}/api/agent/checkin`, { method: "POST" });
    assert.equal(await agent.text(), "app");
    const page = await fetch(`${base}/endpoints`, { redirect: "manual" });
    assert.equal(page.status, 301);
    assert.equal(page.headers.get("location"), "https://127.0.0.1/endpoints");
    const loginPost = await fetch(`${base}/api/auth/login`, { method: "POST", body: "{}", redirect: "manual" });
    assert.equal(loginPost.status, 403);
  } finally {
    server.close();
  }
});

test("production refuses the example or a short JWT secret; dev accepts it", async () => {
  const { productionJwtSecretProblem } = await import("../src/config");
  assert.notEqual(productionJwtSecretProblem("dev-only-change-me-to-a-long-random-string", "production"), null);
  assert.notEqual(productionJwtSecretProblem("change-me-to-a-long-random-string", "production"), null);
  assert.notEqual(productionJwtSecretProblem("too-short-but-16+chars", "production"), null);
  assert.equal(productionJwtSecretProblem("x".repeat(32), "production"), null);
  assert.equal(productionJwtSecretProblem("dev-only-change-me-to-a-long-random-string", "development"), null);
  assert.equal(productionJwtSecretProblem("dev-only-change-me-to-a-long-random-string", undefined), null);
});

function adminReq(role: "SUPER_ADMIN" | "ADMIN", grants: string[]): Request {
  return { adminRole: role, adminModuleGrantKeys: grants } as unknown as Request;
}

test("writing rule/condition PowerShell needs Endpoint Manager access (or super admin)", async () => {
  const { canAuthorEndpointScripts, setsNewScript } = await import("../src/middleware/requireAdminRole");
  assert.equal(canAuthorEndpointScripts(adminReq("SUPER_ADMIN", [])), true);
  assert.equal(canAuthorEndpointScripts(adminReq("ADMIN", ["SECURITY_MANAGER", "ENDPOINT_MANAGER"])), true);
  assert.equal(canAuthorEndpointScripts(adminReq("ADMIN", ["SECURITY_MANAGER"])), false);

  assert.equal(setsNewScript(undefined, "Get-Thing"), false, "field not sent");
  assert.equal(setsNewScript("Get-Thing", "Get-Thing"), false, "re-saved unchanged");
  assert.equal(setsNewScript("", "Get-Thing"), false, "cleared");
  assert.equal(setsNewScript(null, "Get-Thing"), false, "cleared (null)");
  assert.equal(setsNewScript("Get-Other", "Get-Thing"), true, "changed");
  assert.equal(setsNewScript("Set-Thing", null), true, "added where there was none");
});

test("login lockout locks after 5 failures and evicts stale entries, not the whole table", async () => {
  const { LoginLockout } = await import("../src/services/auth.service");
  const lockout = new LoginLockout(5, 1000, 3);
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) assert.equal(lockout.recordFailure("victim@corp", t0), false);
  assert.equal(lockout.recordFailure("victim@corp", t0), true);
  assert.ok(lockout.lockedUntil("victim@corp", t0 + 1) > 0);

  // A spray of other emails over the cap must not unlock the victim.
  for (let i = 0; i < 10; i++) lockout.recordFailure(`spray${i}@x`, t0 + 10);
  assert.ok(lockout.size <= 3);
  assert.ok(lockout.lockedUntil("victim@corp", t0 + 20) > 0, "locked account kept");

  // After the lock ends the entry is stale and goes first.
  lockout.recordFailure("later@x", t0 + 5000);
  assert.equal(lockout.lockedUntil("victim@corp", t0 + 5000), 0);
  assert.ok(lockout.size <= 3);
});
