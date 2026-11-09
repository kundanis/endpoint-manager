import type { AppUsageKind, AppUsageReport, AppUsageRow, UserProductivityScanResultPayload } from "@em/shared";
import { prisma } from "../db";

export interface UserProductivitySummaryAgentView {
  agentId: string;
  hostname: string;
  activeUsernames: string[];
  totalActiveSecondsToday: number;
  totalIdleSecondsToday: number;
  firstLoginAtToday: string | null;
  lastLogoutAtToday: string | null;
}

export interface UserSessionView {
  id: string;
  username: string;
  loginAt: string;
  logoutAt: string | null;
  currentIdleSeconds: number;
  activeSecondsTotal: number;
  idleSecondsTotal: number;
  isActive: boolean;
}

export interface UserProductivityDailyLogView {
  id: string;
  username: string;
  logDate: string;
  firstLoginAt: string;
  lastSeenAt: string;
  lastLogoutAt: string | null;
  activeSecondsTotal: number;
  idleSecondsTotal: number;
}

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

// Accumulates into today's (agentId, username, logDate) rollup — read-then-write rather
// than an atomic increment because firstLoginAt/lastLogoutAt need min/max semantics, not
// just addition; safe here because one agent's scans are processed strictly sequentially
// (one POST per agent per interval), same non-atomic upsert shape already used for
// UserSession itself just above.
async function touchDailyLog(
  agentId: string,
  username: string,
  loginAtCandidate: Date | null,
  logoutAtCandidate: Date | null,
  activeDelta: number,
  idleDelta: number,
): Promise<void> {
  const now = new Date();
  const logDate = startOfDay(logoutAtCandidate ?? loginAtCandidate ?? now);
  const existing = await prisma.userProductivityDailyLog.findUnique({
    where: { agentId_username_logDate: { agentId, username, logDate } },
  });

  if (!existing) {
    await prisma.userProductivityDailyLog.create({
      data: {
        agentId,
        username,
        logDate,
        firstLoginAt: loginAtCandidate ?? now,
        lastSeenAt: now,
        lastLogoutAt: logoutAtCandidate,
        activeSecondsTotal: activeDelta,
        idleSecondsTotal: idleDelta,
      },
    });
    return;
  }

  await prisma.userProductivityDailyLog.update({
    where: { id: existing.id },
    data: {
      firstLoginAt: loginAtCandidate && loginAtCandidate < existing.firstLoginAt ? loginAtCandidate : existing.firstLoginAt,
      lastSeenAt: now,
      lastLogoutAt: logoutAtCandidate ?? existing.lastLogoutAt,
      activeSecondsTotal: existing.activeSecondsTotal + activeDelta,
      idleSecondsTotal: existing.idleSecondsTotal + idleDelta,
    },
  });
}

// Each reported session is identified by (agentId, username, loginAt) — Windows recycles
// session IDs, so loginAt is part of the identity, not just a timestamp field. Between two
// scans, the elapsed wall-clock window since lastSeenAt is bucketed entirely as idle or
// entirely as active based on the CURRENT report's idleSeconds vs. that elapsed window —
// coarse (bounded by scan interval granularity) rather than exact, same tradeoff already
// accepted by every other periodic-rescan module in this codebase.
export async function recordScanResult(agentId: string, payload: UserProductivityScanResultPayload): Promise<void> {
  const now = new Date();
  const seenKeys = new Set<string>();

  for (const session of payload.sessions) {
    const loginAt = new Date(session.logonAt);
    seenKeys.add(`${session.username}|${loginAt.toISOString()}`);

    const existing = await prisma.userSession.findUnique({
      where: { agentId_username_loginAt: { agentId, username: session.username, loginAt } },
    });

    if (!existing) {
      await prisma.userSession.create({
        data: {
          agentId,
          username: session.username,
          loginAt,
          lastSeenAt: now,
          currentIdleSeconds: session.idleSeconds,
          activeSecondsTotal: 0,
          idleSecondsTotal: 0,
          isActive: true,
        },
      });
      await touchDailyLog(agentId, session.username, loginAt, null, 0, 0);
      continue;
    }

    const elapsedSec = Math.max(0, Math.round((now.getTime() - existing.lastSeenAt.getTime()) / 1000));
    const wasIdleThroughout = session.idleSeconds >= elapsedSec;
    const activeDelta = wasIdleThroughout ? 0 : elapsedSec;
    const idleDelta = wasIdleThroughout ? elapsedSec : 0;

    await prisma.userSession.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: now,
        currentIdleSeconds: session.idleSeconds,
        activeSecondsTotal: existing.activeSecondsTotal + activeDelta,
        idleSecondsTotal: existing.idleSecondsTotal + idleDelta,
        isActive: true,
        logoutAt: null,
      },
    });
    await touchDailyLog(agentId, session.username, null, null, activeDelta, idleDelta);
  }

  // Any session this agent previously reported as active but that's absent from the
  // current report has logged out — inferred, bounded by this scan's interval, not exact.
  const stillActive = await prisma.userSession.findMany({
    where: { agentId, isActive: true },
    select: { id: true, username: true, loginAt: true },
  });
  const loggedOut = stillActive.filter((s) => !seenKeys.has(`${s.username}|${s.loginAt.toISOString()}`));

  if (loggedOut.length > 0) {
    await prisma.userSession.updateMany({
      where: { id: { in: loggedOut.map((s) => s.id) } },
      data: { isActive: false, logoutAt: now },
    });
    for (const s of loggedOut) {
      await touchDailyLog(agentId, s.username, null, now, 0, 0);
    }
  }
}

// "Today's" totals come from UserProductivityDailyLog — NOT from summing UserSession's
// own activeSecondsTotal/idleSecondsTotal, which are lifetime-cumulative for that one
// login (a session that never logs out can span many days). Using the daily log here is
// what actually keeps "today" scoped to today, rather than leaking a multi-day session's
// full lifetime total into today's number. "Currently active" usernames still come from
// UserSession (the daily log has no isActive concept), then unioned with whichever
// agents have a daily log row for today.
export async function getFleetSummary(): Promise<UserProductivitySummaryAgentView[]> {
  const today = startOfDay(new Date());

  const [logs, activeSessions] = await Promise.all([
    prisma.userProductivityDailyLog.findMany({
      where: { logDate: today },
      include: { agent: { select: { id: true, hostname: true } } },
    }),
    prisma.userSession.findMany({
      where: { isActive: true },
      select: { agentId: true, username: true, agent: { select: { hostname: true } } },
    }),
  ]);

  interface AgentBucket {
    hostname: string;
    logs: typeof logs;
    activeUsernames: Set<string>;
  }
  const byAgent = new Map<string, AgentBucket>();

  for (const l of logs) {
    const bucket = byAgent.get(l.agentId);
    if (bucket) bucket.logs.push(l);
    else byAgent.set(l.agentId, { hostname: l.agent.hostname, logs: [l], activeUsernames: new Set() });
  }
  for (const s of activeSessions) {
    const bucket = byAgent.get(s.agentId);
    if (bucket) bucket.activeUsernames.add(s.username);
    else byAgent.set(s.agentId, { hostname: s.agent.hostname, logs: [], activeUsernames: new Set([s.username]) });
  }

  return [...byAgent.entries()].map(([agentId, { hostname, logs: agentLogs, activeUsernames }]) => ({
    agentId,
    hostname,
    activeUsernames: [...activeUsernames],
    totalActiveSecondsToday: agentLogs.reduce((sum, l) => sum + l.activeSecondsTotal, 0),
    totalIdleSecondsToday: agentLogs.reduce((sum, l) => sum + l.idleSecondsTotal, 0),
    firstLoginAtToday: agentLogs.reduce<string | null>((earliest, l) => {
      const iso = l.firstLoginAt.toISOString();
      return !earliest || iso < earliest ? iso : earliest;
    }, null),
    // Blank while anyone's still active today (no "final" logout to report yet) — once
    // everyone assigned to this agent today has signed out, show the latest of those.
    lastLogoutAtToday:
      activeUsernames.size === 0
        ? agentLogs.reduce<string | null>((latest, l) => {
            const iso = l.lastLogoutAt?.toISOString() ?? null;
            if (!iso) return latest;
            return !latest || iso > latest ? iso : latest;
          }, null)
        : null,
  }));
}

export async function getAgentSessions(agentId: string): Promise<UserSessionView[]> {
  const sessions = await prisma.userSession.findMany({
    where: { agentId },
    orderBy: { loginAt: "desc" },
    take: 200,
  });

  return sessions.map((s) => ({
    id: s.id,
    username: s.username,
    loginAt: s.loginAt.toISOString(),
    logoutAt: s.logoutAt?.toISOString() ?? null,
    currentIdleSeconds: s.currentIdleSeconds,
    activeSecondsTotal: s.activeSecondsTotal,
    idleSecondsTotal: s.idleSecondsTotal,
    isActive: s.isActive,
  }));
}

// Mon-Fri only, walking back from today — the "no explicit range given" default. A
// custom from/to range (see getDailyLogs) is taken as-given with no weekend exclusion,
// since an admin who explicitly picks a range presumably wants exactly that range.
function lastNWorkingDays(n: number): Date[] {
  const days: Date[] = [];
  const cursor = startOfDay(new Date());
  while (days.length < n) {
    const dayOfWeek = cursor.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

export async function getDailyLogs(agentId: string, from?: Date, to?: Date): Promise<UserProductivityDailyLogView[]> {
  const logs = await prisma.userProductivityDailyLog.findMany({
    where:
      from || to
        ? { agentId, logDate: { gte: from, lte: to } }
        : { agentId, logDate: { in: lastNWorkingDays(10) } },
    orderBy: { logDate: "desc" },
    take: 500,
  });

  return logs.map((l) => ({
    id: l.id,
    username: l.username,
    logDate: l.logDate.toISOString(),
    firstLoginAt: l.firstLoginAt.toISOString(),
    lastSeenAt: l.lastSeenAt.toISOString(),
    lastLogoutAt: l.lastLogoutAt?.toISOString() ?? null,
    activeSecondsTotal: l.activeSecondsTotal,
    idleSecondsTotal: l.idleSecondsTotal,
  }));
}

// ---- Applications and websites --------------------------------------------------------------

// Adds a tray app report (seconds per app / website since its last report) to today's rows.
// A day's row can't exceed 24 hours, whatever a report claims.
export async function recordAppUsage(agentId: string, report: AppUsageReport): Promise<void> {
  const logDate = startOfDay(new Date());
  const merged = new Map<string, AppUsageReport["items"][number]>();
  for (const item of report.items) {
    const id = `${item.kind}|${item.key}`;
    const seen = merged.get(id);
    if (seen) seen.seconds += item.seconds;
    else merged.set(id, { ...item });
  }

  for (const item of merged.values()) {
    const where = { agentId_username_logDate_kind_key: { agentId, username: report.username, logDate, kind: item.kind, key: item.key } };
    const row = await prisma.userAppUsageDaily.upsert({
      where,
      create: { agentId, username: report.username, logDate, kind: item.kind, key: item.key, label: item.label, activeSeconds: item.seconds },
      update: { label: item.label, activeSeconds: { increment: item.seconds } },
    });
    if (row.activeSeconds > 86_400) await prisma.userAppUsageDaily.update({ where, data: { activeSeconds: 86_400 } });
  }
}

const MAX_USAGE_RANGE_DAYS = 31;

// Time per application or website between two days (inclusive), for one endpoint or for all,
// most used first. Defaults to today.
export async function getAppUsage(params: { agentId?: string; from?: Date; to?: Date; kind: AppUsageKind }): Promise<AppUsageRow[]> {
  const to = startOfDay(params.to ?? new Date());
  let from = startOfDay(params.from ?? to);
  const earliest = new Date(to);
  earliest.setDate(earliest.getDate() - (MAX_USAGE_RANGE_DAYS - 1));
  if (from < earliest) from = earliest;

  const rows = await prisma.userAppUsageDaily.findMany({
    where: { kind: params.kind, logDate: { gte: from, lte: to }, ...(params.agentId ? { agentId: params.agentId } : {}) },
    select: { key: true, label: true, activeSeconds: true, agentId: true, username: true, updatedAt: true },
  });

  const byKey = new Map<string, { label: string; labelAt: Date; activeSeconds: number; users: Set<string> }>();
  for (const r of rows) {
    const entry = byKey.get(r.key);
    if (!entry) {
      byKey.set(r.key, { label: r.label, labelAt: r.updatedAt, activeSeconds: r.activeSeconds, users: new Set([`${r.agentId}|${r.username}`]) });
      continue;
    }
    entry.activeSeconds += r.activeSeconds;
    entry.users.add(`${r.agentId}|${r.username}`);
    if (r.updatedAt > entry.labelAt) {
      entry.label = r.label;
      entry.labelAt = r.updatedAt;
    }
  }

  return [...byKey.entries()]
    .map(([key, e]) => ({ kind: params.kind, key, label: e.label, activeSeconds: e.activeSeconds, users: e.users.size }))
    .sort((a, b) => b.activeSeconds - a.activeSeconds)
    .slice(0, 200);
}
