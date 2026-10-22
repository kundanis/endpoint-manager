import type { SecuritySignalsPayload, UpdateUserRiskAlertRequest, UserRiskAlertStatus, UserRiskSettings } from "@em/shared";
import { isIgnoredScreenshotOpener, userRiskSettingsSchema } from "@em/shared";
import { prisma } from "../../db";
import { logger } from "../../logger";
import { BACKFILL_DAYS, collect, ingestAgentSignals } from "./collector";
import { maybeSendWeeklyDigest, notifyNewAlerts } from "./notifications";
import { BASELINE_DAYS, DEFAULT_SETTINGS, RULES, evaluate, evaluateBaselines, identityResolver, normaliseUserKey, riskLevel, riskScore, ruleSetting, type ActivityRow } from "./rules";

// Identity Governance -> User Risk: settings, the periodic collect + evaluate run, and the
// queries behind the console (risky users, a user's timeline, alerts).

const RUN_INTERVAL_MS = 5 * 60_000;
const EVALUATE_LOOKBACK_MS = 2 * 24 * 60 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;

// ---- settings

async function configRow() {
  return (await prisma.userRiskConfig.findUnique({ where: { id: "singleton" } })) ?? (await prisma.userRiskConfig.create({ data: { id: "singleton" } }));
}

export async function getSettings(): Promise<UserRiskSettings> {
  const row = await configRow();
  // "notifications" (email, incl. the encrypted SMTP password) is kept apart - see notifications.ts.
  const { notifications: _notifications, ...stored } = JSON.parse(row.settings) as Partial<UserRiskSettings> & { notifications?: unknown };
  return { ...DEFAULT_SETTINGS, ...stored, rules: { ...DEFAULT_SETTINGS.rules, ...(stored.rules ?? {}) } };
}

export async function saveSettings(input: unknown): Promise<UserRiskSettings> {
  const settings = userRiskSettingsSchema.parse(input);
  try {
    new Intl.DateTimeFormat("en", { timeZone: settings.timezone });
  } catch {
    throw new UserRiskError(`Unknown time zone "${settings.timezone}".`);
  }
  if (settings.workEndHour <= settings.workStartHour) throw new UserRiskError("Working hours must end after they start.");
  const row = await configRow();
  const { notifications } = JSON.parse(row.settings) as { notifications?: unknown };
  await prisma.userRiskConfig.update({ where: { id: "singleton" }, data: { settings: JSON.stringify({ ...settings, notifications }) } });
  return settings;
}

export class UserRiskError extends Error {}

export function listRules(settings: UserRiskSettings) {
  return RULES.map((r) => ({
    key: r.key,
    title: r.title,
    description: r.description,
    category: r.category,
    kind: r.kind,
    window: r.window ?? null,
    thresholdLabel: r.thresholdLabel ?? null,
    defaults: r.defaults,
    setting: ruleSetting(settings, r),
  }));
}

// ---- the run

let running: Promise<{ collected: number; alerts: number }> | null = null;

export function runNow() {
  running ??= runOnce().finally(() => (running = null));
  return running;
}

// Windows user names seen anywhere (activity or sign-ins) - the targets email senders link to.
async function windowsUserKeys(): Promise<string[]> {
  const fromActivity = await prisma.userActivityEvent.groupBy({ by: ["userKey"] });
  const fromSessions = await prisma.userSession.groupBy({ by: ["username"] });
  return [...new Set([...fromActivity.map((a) => a.userKey), ...fromSessions.map((s) => normaliseUserKey(s.username))])].filter((k) => !k.includes("@"));
}

// Email-sender activity and alerts filed under the right user after links change (or a new
// Windows user appears that an address now matches). `username` keeps the address as reported,
// so unlinking moves rows back.
async function applyIdentityLinks(resolve: (raw: string) => { userKey: string }) {
  const identities = await prisma.userActivityEvent.groupBy({ by: ["username", "userKey"], where: { username: { contains: "@" } } });
  for (const i of identities) {
    const target = resolve(i.username).userKey;
    if (target !== i.userKey) await prisma.userActivityEvent.updateMany({ where: { username: i.username, userKey: i.userKey }, data: { userKey: target } });
  }
  const alertIds = await prisma.userRiskAlert.groupBy({ by: ["username", "userKey"], where: { username: { contains: "@" } } });
  for (const a of alertIds) {
    const target = resolve(a.username).userKey;
    if (target !== a.userKey) await prisma.userRiskAlert.updateMany({ where: { username: a.username, userKey: a.userKey }, data: { userKey: target } });
  }
}

export async function recordAgentSignals(agentId: string, payload: SecuritySignalsPayload) {
  const settings = await getSettings();
  return ingestAgentSignals(agentId, payload.signals, identityResolver(settings, await windowsUserKeys()));
}

export async function listIdentities() {
  const settings = await getSettings();
  const users = await windowsUserKeys();
  const resolve = identityResolver(settings, users);
  const emails = await prisma.userActivityEvent.groupBy({ by: ["username"], where: { username: { contains: "@" } }, _count: { _all: true } });
  const byEmail = new Map<string, number>();
  for (const e of emails) byEmail.set(e.username.toLowerCase(), (byEmail.get(e.username.toLowerCase()) ?? 0) + e._count._all);
  for (const l of settings.identityLinks) if (!byEmail.has(l.email)) byEmail.set(l.email, 0);
  return {
    windowsUsers: users.sort(),
    emails: [...byEmail.entries()]
      .map(([email, activityCount]) => {
        const r = resolve(email);
        return { email, activityCount, linkedTo: r.userKey === email ? null : r.userKey, auto: r.auto };
      })
      .sort((a, b) => a.email.localeCompare(b.email)),
  };
}

async function runOnce(): Promise<{ collected: number; alerts: number }> {
  const row = await configRow();
  const cursors = JSON.parse(row.cursors) as Record<string, string>;
  const settings = await getSettings();
  const resolve = identityResolver(settings, await windowsUserKeys());
  const collected = await collect(cursors, resolve);
  await applyIdentityLinks(resolve);

  // First run looks back over the whole backfill, later runs over the last two days.
  const from = cursors.evaluatedAt ? new Date(Date.now() - EVALUATE_LOOKBACK_MS) : new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60_000);
  const events: ActivityRow[] = await prisma.userActivityEvent.findMany({
    where: { occurredAt: { gte: from } },
    select: { id: true, userKey: true, username: true, type: true, summary: true, detail: true, occurredAt: true, sourceId: true },
  });
  // Baselines look at each user's own last 30 days, for the activity types they cover.
  const baselineTypes = RULES.find((r) => r.key === "UNUSUAL_ACTIVITY")!.types as string[];
  const history: ActivityRow[] = await prisma.userActivityEvent.findMany({
    where: { occurredAt: { gte: new Date(Date.now() - (BASELINE_DAYS + 1) * 24 * 60 * 60_000) }, type: { in: baselineTypes } },
    select: { id: true, userKey: true, username: true, type: true, summary: true, detail: true, occurredAt: true, sourceId: true },
  });
  const drafts = [...evaluate(events, settings), ...evaluateBaselines(history, settings)];
  const firstRun = !cursors.evaluatedAt;
  const created: string[] = [];
  let alerts = 0;
  for (const d of drafts) {
    const existing = await prisma.userRiskAlert.findUnique({ where: { dedupeKey: d.dedupeKey }, select: { id: true, eventCount: true } });
    if (!existing) {
      const alert = await prisma.userRiskAlert.create({ data: { ...d, eventCount: d.eventIds.length, eventIds: JSON.stringify(d.eventIds) } });
      created.push(alert.id);
      alerts++;
    } else if (d.eventIds.length > existing.eventCount) {
      // More of the same in the same hour / day: grow the alert, keep its status and notes.
      await prisma.userRiskAlert.update({
        where: { id: existing.id },
        data: { title: d.title, detail: d.detail, eventCount: d.eventIds.length, eventIds: JSON.stringify(d.eventIds), windowEnd: d.windowEnd },
      });
    }
  }
  cursors.evaluatedAt = new Date().toISOString();

  // Email: not for the alerts of the first run's 30-day backfill - those are history, not news.
  if (!firstRun) await notifyNewAlerts(created);
  await maybeSendWeeklyDigest(cursors, settings.timezone);

  // Retention: activity older than the configured days goes; alerts are kept for a year.
  await prisma.userActivityEvent.deleteMany({ where: { occurredAt: { lt: new Date(Date.now() - settings.retentionDays * 24 * 60 * 60_000) } } });
  await prisma.userRiskAlert.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 365 * 24 * 60 * 60_000) } } });

  await prisma.userRiskConfig.update({ where: { id: "singleton" }, data: { cursors: JSON.stringify(cursors) } });
  if (collected > 0 || alerts > 0) logger.info({ collected, alerts }, "User risk: activity collected and evaluated");
  return { collected, alerts };
}

export function scheduleUserRisk() {
  const tick = () => runNow().catch((err) => logger.error({ err }, "User risk run failed"));
  setTimeout(tick, 30_000); // after start-up settles
  setInterval(tick, RUN_INTERVAL_MS);
}

// ---- queries

type AlertForScore = { points: number; windowEnd: Date; status: string };

export async function listUsers(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const settings = await getSettings();
  const excluded = new Set(settings.excludedUsers.map(normaliseUserKey));
  const activity = await prisma.userActivityEvent.groupBy({
    by: ["userKey"],
    where: { occurredAt: { gte: since } },
    _count: { _all: true },
    _max: { occurredAt: true },
  });
  const alerts = await prisma.userRiskAlert.findMany({
    where: { windowEnd: { gte: new Date(Math.min(since.getTime(), Date.now() - WEEK_MS)) } },
    select: { userKey: true, username: true, points: true, windowEnd: true, status: true, ruleKey: true, severity: true },
  });
  const keys = new Set([...activity.map((a) => a.userKey), ...alerts.map((a) => a.userKey)]);
  const latest = await prisma.userActivityEvent.findMany({
    where: { userKey: { in: [...keys] }, occurredAt: { gte: since } },
    orderBy: { occurredAt: "desc" },
    select: { userKey: true, username: true, hostname: true },
    take: 5000,
  });

  return [...keys]
    .filter((k) => !excluded.has(k))
    .map((userKey) => {
      const mine = alerts.filter((a) => a.userKey === userKey);
      const act = activity.find((a) => a.userKey === userKey);
      const seen = latest.filter((l) => l.userKey === userKey);
      const score = riskScore(mine as AlertForScore[]);
      const inPeriod = mine.filter((a) => a.windowEnd >= since);
      const ruleCounts = new Map<string, number>();
      for (const a of inPeriod) ruleCounts.set(a.ruleKey, (ruleCounts.get(a.ruleKey) ?? 0) + 1);
      return {
        userKey,
        username: seen[0]?.username ?? mine[0]?.username ?? userKey,
        score,
        level: riskLevel(score),
        alertCount: inPeriod.length,
        openAlertCount: mine.filter((a) => a.status === "NEW" || a.status === "INVESTIGATING").length,
        topRules: [...ruleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ruleKey, count]) => ({ ruleKey, title: RULES.find((r) => r.key === ruleKey)?.title ?? ruleKey, count })),
        activityCount: act?._count._all ?? 0,
        lastActivityAt: act?._max.occurredAt?.toISOString() ?? null,
        endpoints: [...new Set(seen.map((s) => s.hostname).filter((h): h is string => !!h))].slice(0, 5),
      };
    })
    .sort((a, b) => b.score - a.score || b.alertCount - a.alertCount || b.activityCount - a.activityCount);
}

export async function getUser(userKey: string) {
  const alerts = await prisma.userRiskAlert.findMany({ where: { userKey }, orderBy: { createdAt: "desc" }, take: 200 });
  const last = await prisma.userActivityEvent.findFirst({ where: { userKey }, orderBy: { occurredAt: "desc" }, select: { username: true } });
  if (!last && alerts.length === 0) return null;
  // Score at the end of each of the last 14 days.
  const history = Array.from({ length: 14 }, (_, i) => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    end.setDate(end.getDate() - (13 - i));
    const at = end.getTime() > Date.now() ? new Date() : end;
    return { day: at.toISOString().slice(0, 10), score: riskScore(alerts.filter((a) => a.windowEnd <= at), at) };
  });
  const score = riskScore(alerts);
  return {
    userKey,
    username: last?.username ?? alerts[0].username,
    score,
    level: riskLevel(score),
    history,
    alerts: alerts.map(alertView),
  };
}

export async function getTimeline(userKey: string, days: number, types: string[] | null) {
  const events = await prisma.userActivityEvent.findMany({
    where: { userKey, occurredAt: { gte: new Date(Date.now() - days * 24 * 60 * 60_000) }, ...(types && types.length > 0 ? { type: { in: types } } : {}) },
    orderBy: { occurredAt: "desc" },
    take: 1000,
  });
  // Antivirus "opens" collected before they were filtered out aren't user activity.
  const visible = events.filter((e) => e.type !== "SCREENSHOT_OPENED" || !isIgnoredScreenshotOpener(String((JSON.parse(e.detail) as { process?: string }).process ?? "")));
  return visible.map((e) => ({
    id: e.id,
    type: e.type,
    summary: e.summary,
    detail: JSON.parse(e.detail) as Record<string, unknown>,
    occurredAt: e.occurredAt.toISOString(),
    agentId: e.agentId,
    hostname: e.hostname,
  }));
}

function alertView(a: Awaited<ReturnType<typeof prisma.userRiskAlert.findMany>>[number]) {
  return {
    id: a.id,
    userKey: a.userKey,
    username: a.username,
    ruleKey: a.ruleKey,
    ruleTitle: RULES.find((r) => r.key === a.ruleKey)?.title ?? a.ruleKey,
    severity: a.severity,
    points: a.points,
    title: a.title,
    detail: a.detail,
    eventCount: a.eventCount,
    eventIds: JSON.parse(a.eventIds) as string[],
    windowStart: a.windowStart.toISOString(),
    windowEnd: a.windowEnd.toISOString(),
    status: a.status as UserRiskAlertStatus,
    notes: JSON.parse(a.notes) as { at: string; by: string; text: string }[],
    createdAt: a.createdAt.toISOString(),
  };
}

export async function listAlerts(params: { days: number; status?: string; severity?: string }) {
  const statuses = params.status === "OPEN" ? ["NEW", "INVESTIGATING"] : params.status ? [params.status] : undefined;
  const alerts = await prisma.userRiskAlert.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - params.days * 24 * 60 * 60_000) },
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(params.severity ? { severity: params.severity } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  return alerts.map(alertView);
}

export async function getAlertEvents(id: string) {
  const alert = await prisma.userRiskAlert.findUnique({ where: { id } });
  if (!alert) return null;
  const ids = JSON.parse(alert.eventIds) as string[];
  const events = ids.length > 0 ? await prisma.userActivityEvent.findMany({ where: { id: { in: ids } }, orderBy: { occurredAt: "asc" } }) : [];
  return events.map((e) => ({ id: e.id, type: e.type, summary: e.summary, occurredAt: e.occurredAt.toISOString(), hostname: e.hostname, agentId: e.agentId }));
}

export async function updateAlert(id: string, body: UpdateUserRiskAlertRequest, adminEmail: string) {
  const alert = await prisma.userRiskAlert.findUnique({ where: { id } });
  if (!alert) return null;
  const notes = JSON.parse(alert.notes) as { at: string; by: string; text: string }[];
  if (body.status && body.status !== alert.status) notes.push({ at: new Date().toISOString(), by: adminEmail, text: `Status changed to ${body.status.replace("_", " ").toLowerCase()}` });
  if (body.note) notes.push({ at: new Date().toISOString(), by: adminEmail, text: body.note });
  const updated = await prisma.userRiskAlert.update({ where: { id }, data: { status: body.status ?? alert.status, notes: JSON.stringify(notes) } });
  return alertView(updated);
}

export async function overview() {
  const users = await listUsers(7);
  const open = await prisma.userRiskAlert.groupBy({ by: ["severity"], where: { status: { in: ["NEW", "INVESTIGATING"] } }, _count: { _all: true } });
  const row = await configRow();
  const cursors = JSON.parse(row.cursors) as Record<string, string>;
  return {
    usersByLevel: { CRITICAL: users.filter((u) => u.level === "CRITICAL").length, HIGH: users.filter((u) => u.level === "HIGH").length, MEDIUM: users.filter((u) => u.level === "MEDIUM").length, LOW: users.filter((u) => u.level === "LOW").length },
    openAlerts: Object.fromEntries(open.map((o) => [o.severity, o._count._all])) as Record<string, number>,
    monitoredUsers: users.length,
    lastRunAt: cursors.evaluatedAt ?? null,
  };
}
