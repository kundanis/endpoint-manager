// User productivity "Total active" periods run by the calendar. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { periodStart } from "../src/services/userProductivity.service";

test("Total active periods start today, on Monday, on the 1st and on 1 January", () => {
  const sat = new Date(2026, 10, 14, 15, 30); // Saturday 14 Nov 2026
  assert.deepEqual(periodStart("day", sat), new Date(2026, 10, 14));
  assert.deepEqual(periodStart("week", sat), new Date(2026, 10, 9));
  assert.deepEqual(periodStart("month", sat), new Date(2026, 10, 1));
  assert.deepEqual(periodStart("year", sat), new Date(2026, 0, 1));
  const sun = new Date(2026, 10, 15, 9); // a Sunday still belongs to the week that began Monday
  assert.deepEqual(periodStart("week", sun), new Date(2026, 10, 9));
  const mon = new Date(2026, 10, 9, 0, 5);
  assert.deepEqual(periodStart("week", mon), new Date(2026, 10, 9));
});
