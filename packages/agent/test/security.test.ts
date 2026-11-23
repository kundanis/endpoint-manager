// Hardening helpers: PowerShell quoting, installer arguments without a shell, and log redaction.
// Run with: npm test -w @em/agent
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, sanitizeLogArgs } from "../src/fileLog";
import { splitArgs } from "../src/packageInstaller";
import { psEscape } from "../src/secureFs";

test("psEscape doubles ASCII and Unicode single quotes", () => {
  assert.equal(psEscape("it's"), "it''s");
  assert.equal(psEscape("a\u2018b\u2019c\u201Ad\u201Be"), "a\u2018\u2018b\u2019\u2019c\u201A\u201Ad\u201B\u201Be");
  assert.equal(psEscape("plain"), "plain");
});

test("installer arguments split like a Windows command line", () => {
  assert.deepEqual(splitArgs("/S  /norestart"), ["/S", "/norestart"]);
  assert.deepEqual(splitArgs('/D="C:\\Program Files\\App" "two words"'), ["/D=C:\\Program Files\\App", "two words"]);
  assert.deepEqual(splitArgs("/S & calc.exe"), ["/S", "&", "calc.exe"]);
  assert.deepEqual(splitArgs(""), []);
});

test("HTTP errors are logged without headers, body or raw request", () => {
  const err = Object.assign(new Error("Request failed with status code 401"), {
    isAxiosError: true,
    config: { method: "post", url: "/api/agent/enroll?x=1", baseURL: "https://srv:4000", headers: { "X-Agent-Key": "secretkey123" }, data: '{"enrollmentToken":"tok123456"}' },
    request: { _header: "POST /api/agent/enroll HTTP/1.1\r\nX-Agent-Key: secretkey123\r\n" },
    response: { status: 401 },
  });
  const line = sanitizeLogArgs(["Enrollment failed", err]);
  assert.ok(line.includes("POST /api/agent/enroll -> 401"));
  assert.ok(!line.includes("secretkey123"));
  assert.ok(!line.includes("tok123456"));
  assert.ok(!line.includes("x=1"));
});

test("secret-looking values are redacted wherever they appear", () => {
  const text = redactSecrets(`'X-Agent-Key': 'abc123' {"enrollmentToken":"t1","apiKey":"k1"}`);
  assert.ok(!/abc123|"t1"|"k1"/.test(text));
});
