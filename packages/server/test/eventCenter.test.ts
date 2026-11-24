// Events: filters, severity mapping and event keys. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES, decodeEventKey, sourceWhere, type EventFilter } from "../src/services/eventCenter.service";
import { parseEventFilter } from "../src/routes/eventCenter.routes";

const src = (type: string) => SOURCES.find((s) => s.type === type)!;
const from = new Date("2026-11-10T00:00:00Z");
const to = new Date("2026-11-17T00:00:00Z");
const base: EventFilter = { from, to };
const and = (w: Record<string, unknown> | null) => (w?.AND ?? []) as Record<string, unknown>[];

test("every kind has a unique type, a key and a page; admin actions are not events", () => {
  assert.equal(SOURCES.some((s) => s.type === "admin-action"), false);
  assert.equal(new Set(SOURCES.map((s) => s.type)).size, SOURCES.length);
  for (const s of SOURCES) {
    assert.ok(s.keyFields.length > 0, s.type);
    assert.ok(s.path(null).startsWith("/"), s.type);
  }
});

test("the time window applies to each kind's own time field", () => {
  assert.deepEqual(and(sourceWhere(src("usb-blocked"), base))[0], { occurredAt: { gte: from, lte: to } });
  assert.deepEqual(and(sourceWhere(src("zero-trust"), base))[0], { lastSeenAt: { gte: from, lte: to } });
  assert.ok(and(sourceWhere(src("zero-trust"), base)).some((c) => c.status === "FAIL"), "only failing checks");
});

test("endpoint and group filters drop kinds not tied to an endpoint", () => {
  assert.equal(sourceWhere(src("user-risk"), { ...base, agentId: "a1" }), null);
  assert.equal(sourceWhere(src("email-block"), { ...base, groupId: "g1" }), null);
  assert.ok(and(sourceWhere(src("dlp"), { ...base, agentId: "a1" })).some((c) => c.agentId === "a1"));
  // A group filter is the endpoints of the group and its sub groups (resolved before sourceWhere).
  assert.ok(and(sourceWhere(src("dlp"), { ...base, groupId: "g1", groupAgentIds: ["a1", "a2"] })).some((c) => JSON.stringify(c) === '{"agentId":{"in":["a1","a2"]}}'));
});

test("category and type filters", () => {
  assert.equal(sourceWhere(src("dlp"), { ...base, categories: ["THREATS"] }), null);
  assert.notEqual(sourceWhere(src("threat"), { ...base, categories: ["THREATS"] }), null);
  assert.equal(sourceWhere(src("dlp"), { ...base, types: ["threat"] }), null);
});

test("severity filters map to each kind's own values", () => {
  // Fixed severity: in or out.
  assert.equal(sourceWhere(src("usb-blocked"), { ...base, severities: ["HIGH"] }), null);
  assert.notEqual(sourceWhere(src("usb-blocked"), { ...base, severities: ["MEDIUM"] }), null);
  // Defender's SEVERE is Critical.
  assert.ok(and(sourceWhere(src("threat"), { ...base, severities: ["CRITICAL"] })).some((c) => JSON.stringify(c) === '{"severity":{"in":["SEVERE"]}}'));
  // DLP: blocked = High, alerted = Medium (the fallback, so it excludes the rest instead).
  assert.ok(and(sourceWhere(src("dlp"), { ...base, severities: ["HIGH"] })).some((c) => JSON.stringify(c) === '{"action":{"in":["BLOCKED"]}}'));
  assert.ok(and(sourceWhere(src("dlp"), { ...base, severities: ["MEDIUM"] })).some((c) => JSON.stringify(c) === '{"action":{"notIn":["BLOCKED"]}}'));
  // Severity on a related row.
  assert.ok(and(sourceWhere(src("security-config"), { ...base, severities: ["HIGH"] })).some((c) => JSON.stringify(c) === '{"rule":{"severity":{"in":["HIGH"]}}}'));
});

test("an event key round-trips and narrows the timeline to that kind", () => {
  const key = `dlp|${JSON.stringify(["p1", "BLOCKED"])}`;
  assert.deepEqual(decodeEventKey(key), { type: "dlp", groupKey: { policyId: "p1", action: "BLOCKED" } });
  const w = and(sourceWhere(src("dlp"), base, { policyId: "p1", action: "BLOCKED" }));
  assert.ok(w.some((c) => c.policyId === "p1") && w.some((c) => c.action === "BLOCKED"));
  assert.equal(decodeEventKey("nope|[]"), null);
  assert.equal(decodeEventKey(`dlp|${JSON.stringify(["only one"])}`), null);
});

test("period: 7 days by default, at most 90, endpoint wins over group", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const f = parseEventFilter({}, now);
  assert.equal(f.to.getTime(), now.getTime());
  assert.equal(now.getTime() - f.from.getTime(), 7 * 86400000);
  const long = parseEventFilter({ from: "2025-01-01T00:00:00Z" }, now);
  assert.equal(now.getTime() - long.from.getTime(), 90 * 86400000);
  const both = parseEventFilter({ agent: "a1", group: "g1", severity: "HIGH,BOGUS", category: "THREATS" }, now);
  assert.equal(both.agentId, "a1");
  assert.equal(both.groupId, undefined);
  assert.deepEqual(both.severities, ["HIGH"]);
  assert.deepEqual(both.categories, ["THREATS"]);
});
