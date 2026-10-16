// "Scan now" request queue. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestScan, takeScanRequest } from "../src/services/scanRequests";

test("a requested scan is delivered once, to the right agent and kind", () => {
  requestScan("zeroTrust", ["a1", "a2"]);
  assert.equal(takeScanRequest("securityConfig", "a1"), false);
  assert.equal(takeScanRequest("zeroTrust", "a1"), true);
  assert.equal(takeScanRequest("zeroTrust", "a1"), false); // cleared after delivery
  assert.equal(takeScanRequest("zeroTrust", "a3"), false);
  assert.equal(takeScanRequest("zeroTrust", "a2"), true);
});

test("requesting twice before a check-in still means one scan", () => {
  requestScan("securityConfig", ["b1"]);
  requestScan("securityConfig", ["b1"]);
  assert.equal(takeScanRequest("securityConfig", "b1"), true);
  assert.equal(takeScanRequest("securityConfig", "b1"), false);
});
