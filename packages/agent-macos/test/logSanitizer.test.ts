// Log redaction tests: no agent key or enrollment token may reach agent.log.
// Run with: npm test -w @em/agent-macos
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLogLine, redactSecrets } from "../src/logSanitizer";

test("an AxiosError-like object is reduced to message, method, path and status", () => {
  const err = Object.assign(new Error("Request failed with status code 500"), {
    isAxiosError: true,
    code: "ERR_BAD_RESPONSE",
    config: {
      method: "post",
      url: "/api/agent/checkin?x=1",
      baseURL: "https://uem.example.com:4443",
      headers: { "X-Agent-Key": "secret-key-123" },
      data: '{"enrollmentToken":"tok-456"}',
    },
    request: { _header: "POST /api/agent/checkin HTTP/1.1\r\nX-Agent-Key: secret-key-123\r\n" },
    response: { status: 500 },
  });
  const line = formatLogLine(["Check-in failed", err]);
  assert.equal(line, "Check-in failed Request failed with status code 500 [ERR_BAD_RESPONSE] (POST /api/agent/checkin) HTTP 500");
});

test("key and token patterns in plain text are masked", () => {
  const text = [
    "X-Agent-Key: abc123",
    `{"enrollmentToken":"tok-1","apiKey":"k-2"}`,
    "'X-Agent-Key': 'abc123'",
    "install.sh --enrollment-token tok-3 --server-url x",
  ].join("\n");
  const out = redactSecrets(text);
  for (const secret of ["abc123", "tok-1", "k-2", "tok-3"]) assert.ok(!out.includes(secret), `${secret} leaked: ${out}`);
  assert.ok(out.includes("--server-url x"));
});

test("ordinary messages pass through unchanged", () => {
  assert.equal(formatLogLine(["Inventory reported"]), "Inventory reported");
  assert.equal(formatLogLine(["Re-enrollment failed (check the enrollment token)", "boom"]), "Re-enrollment failed (check the enrollment token) boom");
});

test("an Error whose cause is an AxiosError is summarized too", () => {
  const cause = { isAxiosError: true, message: "timeout", config: { method: "get", url: "https://h/api/x", headers: { "X-Agent-Key": "zzz" } }, request: {} };
  const line = formatLogLine([new Error("wrapped", { cause })]);
  assert.ok(!line.includes("zzz"));
  assert.match(line, /wrapped \(cause: timeout \(GET \/api\/x\)\)/);
});
