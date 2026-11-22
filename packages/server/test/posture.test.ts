// Dashboard -> Organisation Security Posture: the score rules.
// Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreEndpoint, scoreOrganisation, snapshotDay } from "../src/services/posture.service";

test("an endpoint with every part clean scores 100", () => {
  const r = scoreEndpoint({
    vulnerabilities: {},
    missingPatches: 0,
    zeroTrust: { passed: 10, total: 10 },
    securityConfig: { passed: 50, total: 50 },
    openThreats: 0,
    policyBlocks: 0,
  });
  assert.equal(r.score, 100);
  assert.equal(r.eolCapped, false);
});

test("each part loses points as described, floored at 0", () => {
  const r = scoreEndpoint({ vulnerabilities: { CRITICAL: 2, HIGH: 1, MEDIUM: 2, LOW: 4 }, missingPatches: 3, policyBlocks: 30 });
  assert.equal(r.parts.vulnerabilities, 100 - 50 - 10 - 6 - 4); // 30
  assert.equal(r.parts.patches, 85);
  assert.equal(r.parts.policyBlocks, 0);
  // Weighted over the parts present: (30*25 + 85*20 + 0*10) / 55
  assert.equal(r.score, Math.round(((30 * 25 + 85 * 20) / 55) * 10) / 10);
});

test("parts without data are left out and the rest re-weighted", () => {
  assert.equal(scoreEndpoint({ zeroTrust: { passed: 3, total: 4 } }).score, 75);
  assert.deepEqual(Object.keys(scoreEndpoint({ zeroTrust: { passed: 0, total: 0 } }).parts), []);
  assert.equal(scoreEndpoint({}).score, 100);
});

test("any open threat zeroes the threats part", () => {
  assert.equal(scoreEndpoint({ openThreats: 1 }).parts.threats, 0);
  assert.equal(scoreEndpoint({ openThreats: 0 }).parts.threats, 100);
});

test("an end-of-support OS caps the endpoint at 50", () => {
  const r = scoreEndpoint({ missingPatches: 0, osEndOfSupport: true });
  assert.equal(r.score, 50);
  assert.equal(r.eolCapped, true);
  const low = scoreEndpoint({ missingPatches: 18, osEndOfSupport: true });
  assert.equal(low.score, 10);
  assert.equal(low.eolCapped, false);
});

test("the organisation is the endpoints' average; each part averages over endpoints that have it", () => {
  const org = scoreOrganisation([
    { score: 100, parts: { patches: 100, zeroTrust: 100 } },
    { score: 50, parts: { patches: 50 } },
  ]);
  assert.equal(org.score, 75);
  assert.equal(org.parts.patches, 75);
  assert.equal(org.parts.zeroTrust, 100);
  assert.equal(scoreOrganisation([]).score, null);
});

test("snapshots are keyed by the server's local calendar day", () => {
  const d = new Date(2026, 10, 22, 23, 30);
  assert.equal(snapshotDay(d).toISOString(), "2026-11-22T00:00:00.000Z");
});
