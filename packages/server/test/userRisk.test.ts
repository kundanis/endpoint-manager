// User Risk rules and score. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, evaluate, isOffHours, normaliseUserKey, riskLevel, riskScore, type ActivityRow } from "../src/services/userRisk/rules";

let n = 0;
function ev(type: string, at: string, over: Partial<ActivityRow> = {}): ActivityRow {
  n++;
  return { id: `e${n}`, userKey: "ravi", username: "ravi", type, summary: `${type} ${n}`, detail: "{}", occurredAt: new Date(at), sourceId: `s${n}`, ...over };
}

test("user keys are normalised; email senders stay addresses", () => {
  assert.equal(normaliseUserKey("SSSIL\\Ravi"), "ravi");
  assert.equal(normaliseUserKey(" Ravi "), "ravi");
  assert.equal(normaliseUserKey("Ravi@Corp.com"), "ravi@corp.com");
});

test("count rule fires at the threshold, per user and hour, once per bucket", () => {
  const usb = Array.from({ length: 50 }, (_, i) => ev("USB_COPY", `2026-10-22T10:${String(i % 60).padStart(2, "0")}:00Z`));
  const fewOther = Array.from({ length: 49 }, () => ev("USB_COPY", "2026-10-22T10:30:00Z", { userKey: "asha", username: "asha" }));
  const alerts = evaluate([...usb, ...fewOther], DEFAULT_SETTINGS).filter((a) => a.ruleKey === "USB_MASS_COPY");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].userKey, "ravi");
  assert.equal(alerts[0].eventIds.length, 50);
  assert.equal(alerts[0].severity, "HIGH");
  assert.match(alerts[0].dedupeKey, /^USB_MASS_COPY\|ravi\|2026-10-22T10$/);
});

test("disabled rules, changed thresholds and excluded users are respected", () => {
  const usb = Array.from({ length: 10 }, () => ev("USB_COPY", "2026-10-22T10:00:00Z"));
  const lowered = { ...DEFAULT_SETTINGS, rules: { ...DEFAULT_SETTINGS.rules, USB_MASS_COPY: { enabled: true, threshold: 10, points: 5, severity: "LOW" as const } } };
  assert.equal(evaluate(usb, lowered).filter((a) => a.ruleKey === "USB_MASS_COPY")[0].points, 5);
  const off = { ...lowered, rules: { ...lowered.rules, USB_MASS_COPY: { ...lowered.rules.USB_MASS_COPY, enabled: false } } };
  assert.equal(evaluate(usb, off).filter((a) => a.ruleKey === "USB_MASS_COPY").length, 0);
  assert.equal(evaluate(usb, { ...lowered, excludedUsers: ["SSSIL\\Ravi"] }).length, 0);
});

test("off-hours sign-ins use the configured time zone and days", () => {
  const s = DEFAULT_SETTINGS; // Asia/Kolkata, 9-19, Mon-Sat
  assert.equal(isOffHours(new Date("2026-10-22T05:00:00Z"), s), false); // Thu 10:30 IST
  assert.equal(isOffHours(new Date("2026-10-22T18:00:00Z"), s), true); // Thu 23:30 IST
  assert.equal(isOffHours(new Date("2026-10-25T05:00:00Z"), s), true); // Sunday
  const alerts = evaluate([ev("LOGON", "2026-10-22T18:00:00Z"), ev("LOGON", "2026-10-22T05:00:00Z")], s);
  assert.equal(alerts.filter((a) => a.ruleKey === "OFF_HOURS_LOGON").length, 1);
});

test("combined rules: DLP match then USB copy; screenshot shared then deleted", () => {
  const dlp = ev("DLP_EVENT", "2026-10-22T10:00:00Z");
  const copy = ev("USB_COPY", "2026-10-22T10:40:00Z");
  const lateCopy = ev("USB_COPY", "2026-10-22T12:00:00Z", { userKey: "asha" });
  const combo = evaluate([dlp, copy, lateCopy], DEFAULT_SETTINGS).filter((a) => a.ruleKey === "COMBO_DLP_THEN_TRANSFER");
  assert.equal(combo.length, 1);
  assert.equal(combo[0].severity, "CRITICAL");

  const opened = ev("SCREENSHOT_OPENED", "2026-10-22T10:01:00Z", { detail: JSON.stringify({ captureId: "c1", process: "WhatsApp.exe" }) });
  const deleted = ev("SCREENSHOT_DELETED", "2026-10-22T10:03:00Z", { detail: JSON.stringify({ captureId: "c1", minutesAfter: 3 }) });
  const viewedOnly = ev("SCREENSHOT_OPENED", "2026-10-22T10:01:00Z", { detail: JSON.stringify({ captureId: "c2", process: "Photos.exe" }) });
  const deleted2 = ev("SCREENSHOT_DELETED", "2026-10-22T10:03:00Z", { detail: JSON.stringify({ captureId: "c2", minutesAfter: 3 }) });
  const shots = evaluate([opened, deleted, viewedOnly, deleted2], DEFAULT_SETTINGS).filter((a) => a.ruleKey === "COMBO_SCREENSHOT_EXFIL");
  assert.equal(shots.length, 1);
});

test("risk score fades over 7 days, ignores false positives, caps at 100", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const at = (h: number) => new Date(now.getTime() - h * 3600_000);
  assert.equal(riskScore([{ points: 40, windowEnd: at(0), status: "NEW" }], now), 40);
  assert.equal(riskScore([{ points: 40, windowEnd: at(84), status: "NEW" }], now), 20); // half a week
  assert.equal(riskScore([{ points: 40, windowEnd: at(200), status: "NEW" }], now), 0);
  assert.equal(riskScore([{ points: 40, windowEnd: at(0), status: "CLOSED_FALSE" }], now), 0);
  assert.equal(riskScore(Array.from({ length: 5 }, () => ({ points: 35, windowEnd: at(0), status: "NEW" })), now), 100);
  assert.deepEqual([10, 30, 60, 90].map(riskLevel), ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
});

test("email senders link to Windows users: automatic by name, manual override, keep separate", async () => {
  const { identityResolver } = await import("../src/services/userRisk/rules");
  const users = ["kundan zamwar", "ravi"];
  const auto = identityResolver({ autoLinkEmails: true, identityLinks: [] }, users);
  assert.deepEqual(auto("Kundan.Zamwar@corp.com"), { userKey: "kundan zamwar", auto: true });
  assert.deepEqual(auto("someone@corp.com"), { userKey: "someone@corp.com", auto: false });
  assert.deepEqual(auto("SSSIL\\Ravi"), { userKey: "ravi", auto: false });
  const manual = identityResolver({ autoLinkEmails: true, identityLinks: [{ email: "kz@corp.com", userKey: "kundan zamwar" }, { email: "ravi@corp.com", userKey: "ravi@corp.com" }] }, users);
  assert.equal(manual("kz@corp.com").userKey, "kundan zamwar");
  assert.equal(manual("ravi@corp.com").userKey, "ravi@corp.com"); // kept separate despite matching
  const off = identityResolver({ autoLinkEmails: false, identityLinks: [] }, users);
  assert.equal(off("ravi@corp.com").userKey, "ravi@corp.com");
});

test("Windows signals: deletion bursts add up, remote tools are picked out, protection-off then copy is critical", () => {
  const burst = (count: number, at: string) => ev("FILES_DELETED", at, { detail: JSON.stringify({ count }) });
  const del = evaluate([burst(120, "2026-10-22T10:05:00Z"), burst(90, "2026-10-22T10:40:00Z")], DEFAULT_SETTINGS).filter((a) => a.ruleKey === "MASS_DELETE");
  assert.equal(del.length, 1);
  assert.equal(del[0].title, "210 files deleted within an hour");
  assert.equal(evaluate([burst(150, "2026-10-22T10:05:00Z")], DEFAULT_SETTINGS).filter((a) => a.ruleKey === "MASS_DELETE").length, 0);

  const sw = (name: string) => ev("SOFTWARE_INSTALLED", "2026-10-22T10:00:00Z", { detail: JSON.stringify({ name }) });
  const tools = evaluate([sw("AnyDesk"), sw("ProtonVPN"), sw("Notepad++"), sw("Microsoft Visual C++ 2022")], DEFAULT_SETTINGS).filter((a) => a.ruleKey === "REMOTE_TOOL_INSTALLED");
  assert.equal(tools.length, 2);

  const off = ev("SECURITY_OFF", "2026-10-22T10:00:00Z");
  const copy = ev("USB_COPY", "2026-10-22T11:30:00Z");
  const alerts = evaluate([off, copy], DEFAULT_SETTINGS);
  assert.equal(alerts.filter((a) => a.ruleKey === "COMBO_PROTECTION_OFF_THEN_TRANSFER").length, 1);
  assert.equal(alerts.filter((a) => a.ruleKey === "SECURITY_OFF").length, 1);

  const failed = Array.from({ length: 10 }, () => ev("FAILED_LOGON", "2026-10-22T10:10:00Z"));
  assert.equal(evaluate(failed, DEFAULT_SETTINGS).filter((a) => a.ruleKey === "FAILED_LOGONS").length, 1);
});

test("baseline: a day far above the user's own normal is flagged; a normal busy day isn't", async () => {
  const { evaluateBaselines } = await import("../src/services/userRisk/rules");
  const now = new Date("2026-10-22T09:00:00Z"); // 14:30 IST
  const day = (daysAgo: number) => new Date(now.getTime() - daysAgo * 24 * 3600_000).toISOString();
  // 20 days of ~5 USB copies a day, then 60 today.
  const history = Array.from({ length: 20 }, (_, i) => Array.from({ length: 5 }, () => ev("USB_COPY", day(i + 1)))).flat();
  const today = Array.from({ length: 60 }, () => ev("USB_COPY", day(0)));
  const alerts = evaluateBaselines([...history, ...today], DEFAULT_SETTINGS, now);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].title, /^Unusual: 60 files copied to USB today \(usually about 5 a day\)$/);

  // Someone who always copies ~50 a day: 60 is normal for them.
  const heavy = Array.from({ length: 20 }, (_, i) => Array.from({ length: 50 }, () => ev("USB_COPY", day(i + 1), { userKey: "asha" }))).flat();
  const heavyToday = Array.from({ length: 60 }, () => ev("USB_COPY", day(0), { userKey: "asha" }));
  assert.equal(evaluateBaselines([...heavy, ...heavyToday], DEFAULT_SETTINGS, now).length, 0);

  // Too little history: no judgement yet.
  const newUser = [...Array.from({ length: 3 }, (_, i) => ev("USB_COPY", day(i + 1), { userKey: "new" })), ...Array.from({ length: 60 }, () => ev("USB_COPY", day(0), { userKey: "new" }))];
  assert.equal(evaluateBaselines(newUser, DEFAULT_SETTINGS, now).length, 0);
});
