// Screen capture report. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";

function capture(over: Partial<{ agentId: string; username: string; captureDay: string; source: string; capturedAt: Date; deletedAt: Date | null; openedBy: string }>) {
  return {
    id: Math.random().toString(36),
    agentId: "a1",
    username: "kundan",
    source: "WINDOWS",
    filePath: "C:\\Users\\kundan\\Pictures\\Screenshots\\x.png",
    fileSizeBytes: BigInt(1000),
    capturedAt: new Date("2026-10-21T10:00:00Z"),
    captureDay: "2026-10-21",
    deletedAt: null,
    openedBy: "[]",
    detectedAt: new Date(),
    ...over,
  };
}

test("a user over the daily threshold is flagged; quick deletes and opening programs are counted", async () => {
  const { buildDailyRows } = await import("../src/services/screenCapturePolicy.service");
  const t = new Date("2026-10-21T10:00:00Z");
  const events = [
    ...Array.from({ length: 11 }, () => capture({})),
    capture({ deletedAt: new Date(t.getTime() + 2 * 60_000), openedBy: JSON.stringify([{ process: "chrome.exe", at: t.toISOString() }]) }),
    capture({ deletedAt: new Date(t.getTime() + 60 * 60_000) }), // deleted an hour later: not quick
    capture({ username: "KUNDAN", source: "SNIPPING_TOOL" }), // same user, other case
    capture({ username: "other" }),
    capture({ captureDay: "2026-10-20" }),
  ];
  const rows = buildDailyRows(events as never, { dailyThreshold: 10, quickDeleteMinutes: 10 });

  const today = rows.find((r) => r.username.toLowerCase() === "kundan" && r.day === "2026-10-21")!;
  assert.equal(today.count, 14);
  assert.equal(today.overThreshold, true);
  assert.equal(today.quickDeleted, 1);
  assert.deepEqual(today.openedBy, ["chrome.exe"]);
  assert.deepEqual(today.sources.sort(), ["SNIPPING_TOOL", "WINDOWS"]);

  assert.equal(rows.find((r) => r.username === "other")!.overThreshold, false);
  assert.equal(rows.find((r) => r.day === "2026-10-20")!.count, 1);
  assert.equal(rows[0].day, "2026-10-21"); // newest day first

  // Exactly at the threshold is not "more than".
  const atThreshold = buildDailyRows(Array.from({ length: 10 }, () => capture({})) as never, { dailyThreshold: 10, quickDeleteMinutes: 10 });
  assert.equal(atThreshold[0].overThreshold, false);
});
