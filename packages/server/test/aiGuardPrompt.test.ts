// AI Guard phase 2 - the Browser Guard extension's endpoint key. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserGuardKeyFor } from "../src/services/aiGuardPrompt.service";

test("each endpoint gets its own stable key", () => {
  const a = browserGuardKeyFor("11111111-1111-1111-1111-111111111111");
  assert.equal(a, browserGuardKeyFor("11111111-1111-1111-1111-111111111111"), "stable");
  assert.notEqual(a, browserGuardKeyFor("22222222-2222-2222-2222-222222222222"), "per endpoint");
  assert.match(a, /^[A-Za-z0-9_-]{43}$/, "url-safe base64 of a SHA-256 HMAC");
});

test("the key is not the endpoint id or derived from it alone", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  const key = browserGuardKeyFor(id);
  assert.ok(!key.includes(id));
  // A plain hash of the id (what someone without the server secret could compute) doesn't match.
  const naive = require("node:crypto").createHash("sha256").update(id).digest("base64url");
  assert.notEqual(key, naive);
});
