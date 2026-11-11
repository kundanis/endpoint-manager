import { isIgnoredScreenshotOpener } from "@em/shared";
import { prisma } from "../../db";
import { normaliseUserKey } from "./rules";

// Maps a reported username to the user it belongs to (see identityResolver).
export type ResolveUser = (rawUsername: string) => { userKey: string };
let resolveUser: ResolveUser = (raw) => ({ userKey: normaliseUserKey(raw) });

// Copies activity from every module's own tables into UserActivityEvent, one row per event per
// user. Most module events only know the endpoint, so each is attributed to whoever was signed in
// there at that moment (User productivity's sessions), else the endpoint's last logged-on user.
// Idempotent: (sourceTable, sourceId, type) is unique, so re-reading an overlap adds nothing.

const BATCH = 2000;
const OVERLAP_MS = 15 * 60_000; // re-read a little before the cursor: rows can land slightly out of order
export const BACKFILL_DAYS = 30;

interface NewActivity {
  agentId: string | null;
  username: string | null; // known user (screen capture, email), else attributed
  type: string;
  summary: string;
  detail: Record<string, unknown>;
  occurredAt: Date;
  sourceTable: string;
  sourceId: string;
}

type Cursors = Record<string, string>;

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

// ---- who was signed in

interface SessionRow {
  agentId: string;
  username: string;
  loginAt: Date;
  lastSeenAt: Date;
  logoutAt: Date | null;
}

async function attributor(items: NewActivity[]) {
  const agentIds = [...new Set(items.map((i) => i.agentId).filter((id): id is string => !!id))];
  if (agentIds.length === 0) return { userAt: () => null as string | null, hostOf: () => null as string | null };
  const times = items.map((i) => i.occurredAt.getTime());
  const from = new Date(Math.min(...times) - 24 * 60 * 60_000);
  const to = new Date(Math.max(...times));
  const sessions: SessionRow[] = await prisma.userSession.findMany({
    where: { agentId: { in: agentIds }, loginAt: { lte: to }, OR: [{ logoutAt: null }, { logoutAt: { gte: from } }] },
    select: { agentId: true, username: true, loginAt: true, lastSeenAt: true, logoutAt: true },
  });
  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, hostname: true, inventory: { select: { lastLoggedOnUser: true } } },
  });
  const byAgent = new Map<string, SessionRow[]>();
  for (const s of sessions) byAgent.set(s.agentId, [...(byAgent.get(s.agentId) ?? []), s]);
  const agentInfo = new Map(agents.map((a) => [a.id, a]));

  return {
    userAt(agentId: string | null, t: Date): string | null {
      if (!agentId) return null;
      const candidates = (byAgent.get(agentId) ?? []).filter((s) => {
        const end = (s.logoutAt ?? new Date(s.lastSeenAt.getTime() + 15 * 60_000)).getTime();
        return s.loginAt.getTime() <= t.getTime() && t.getTime() <= end;
      });
      candidates.sort((a, b) => b.loginAt.getTime() - a.loginAt.getTime());
      return candidates[0]?.username ?? agentInfo.get(agentId)?.inventory?.lastLoggedOnUser ?? null;
    },
    hostOf(agentId: string | null): string | null {
      return agentId ? (agentInfo.get(agentId)?.hostname ?? null) : null;
    },
  };
}

async function save(items: NewActivity[]): Promise<number> {
  if (items.length === 0) return 0;
  const who = await attributor(items);
  let added = 0;
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500);
    const existing = await prisma.userActivityEvent.findMany({
      where: { sourceTable: chunk[0].sourceTable, sourceId: { in: [...new Set(chunk.map((c) => c.sourceId))] } },
      select: { sourceId: true, type: true },
    });
    const have = new Set(existing.map((e) => `${e.sourceId}|${e.type}`));
    const rows = chunk
      .filter((c) => !have.has(`${c.sourceId}|${c.type}`))
      .map((c) => {
        const username = c.username ?? who.userAt(c.agentId, c.occurredAt) ?? "(unknown user)";
        return {
          userKey: resolveUser(username).userKey.slice(0, 200),
          username: username.slice(0, 300),
          agentId: c.agentId,
          hostname: who.hostOf(c.agentId),
          type: c.type,
          summary: c.summary.slice(0, 500),
          detail: JSON.stringify(c.detail).slice(0, 2000),
          occurredAt: c.occurredAt,
          sourceTable: c.sourceTable,
          sourceId: c.sourceId,
        };
      });
    if (rows.length > 0) {
      await prisma.userActivityEvent.createMany({ data: rows });
      added += rows.length;
    }
  }
  return added;
}

// Signals the agent reads itself (see agent securitySignals.ts) go straight into the stream.
export async function ingestAgentSignals(
  agentId: string,
  signals: { key: string; type: string; occurredAt: string; username: string | null; summary: string; detail: Record<string, unknown> }[],
  resolver: ResolveUser,
): Promise<number> {
  resolveUser = resolver;
  return save(
    signals.map((s) => ({
      agentId,
      username: s.username,
      type: s.type,
      summary: s.summary,
      detail: s.detail,
      occurredAt: new Date(s.occurredAt),
      sourceTable: "AgentSignal",
      sourceId: `${agentId.slice(0, 36)}|${s.key}`.slice(0, 100),
    })),
  );
}

// ---- sources

function since(cursors: Cursors, key: string): Date {
  const c = cursors[key];
  return c ? new Date(new Date(c).getTime() - OVERLAP_MS) : new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60_000);
}

function recent(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60_000);
}

// Each source: read rows newer than its cursor (in batches), convert, save, advance.
async function collectSource<T>(
  cursors: Cursors,
  key: string,
  read: (from: Date) => Promise<T[]>,
  timeOf: (row: T) => Date,
  convert: (row: T) => NewActivity[],
): Promise<number> {
  let from = since(cursors, key);
  let added = 0;
  for (let round = 0; round < 50; round++) {
    const rows = await read(from);
    if (rows.length === 0) break;
    added += await save(rows.flatMap(convert));
    const last = timeOf(rows[rows.length - 1]);
    cursors[key] = last.toISOString();
    if (rows.length < BATCH || last.getTime() <= from.getTime()) break;
    from = last;
  }
  return added;
}

export async function collect(cursors: Cursors, resolver: ResolveUser): Promise<number> {
  resolveUser = resolver;
  let added = 0;

  added += await collectSource(
    cursors,
    "dataMovement",
    (from) => prisma.dataMovementEvent.findMany({ where: { detectedAt: { gt: from } }, orderBy: { detectedAt: "asc" }, take: BATCH }),
    (r) => r.detectedAt,
    (r) => {
      const type = r.channel === "USB" ? "USB_COPY" : r.channel === "CLOUD_SYNC" ? "CLOUD_COPY" : "SHARE_COPY";
      const where = r.channel === "USB" ? "USB drive" : r.channel === "CLOUD_SYNC" ? "cloud-sync folder" : "network drive";
      return [{ agentId: r.agentId, username: null, type, summary: `${fileName(r.filePath)} copied to ${where}`, detail: { file: r.filePath, channel: r.channel, size: Number(r.fileSizeBytes) }, occurredAt: r.detectedAt, sourceTable: "DataMovementEvent", sourceId: r.id }];
    },
  );

  added += await collectSource(
    cursors,
    "dlp",
    (from) => prisma.dlpEvent.findMany({ where: { occurredAt: { gt: from } }, orderBy: { occurredAt: "asc" }, take: BATCH }),
    (r) => r.occurredAt,
    (r) => [{ agentId: r.agentId, username: null, type: "DLP_EVENT", summary: `DLP ${r.action.toLowerCase()}: ${fileName(r.filePath)}${r.destinationIsRemovable ? " (removable drive)" : ""}`, detail: { file: r.filePath, action: r.action, removable: r.destinationIsRemovable, process: r.processName }, occurredAt: r.occurredAt, sourceTable: "DlpEvent", sourceId: r.id }],
  );

  added += await collectSource(
    cursors,
    "email",
    (from) => prisma.piiEmailBlockEvent.findMany({ where: { occurredAt: { gt: from } }, orderBy: { occurredAt: "asc" }, take: BATCH }),
    (r) => r.occurredAt,
    (r) => [{ agentId: null, username: r.senderEmail, type: "EMAIL_BLOCKED", summary: `Email ${r.action === "BLOCKED" ? "blocked" : "warned"}: attachment ${r.attachmentName}`, detail: { attachment: r.attachmentName, action: r.action, categories: JSON.parse(r.matchedCategoryLabels) }, occurredAt: r.occurredAt, sourceTable: "PiiEmailBlockEvent", sourceId: r.id }],
  );

  added += await collectSource(
    cursors,
    "usbBlock",
    (from) => prisma.usbControlEvent.findMany({ where: { occurredAt: { gt: from } }, orderBy: { occurredAt: "asc" }, take: BATCH }),
    (r) => r.occurredAt,
    (r) => [{ agentId: r.agentId, username: null, type: "USB_DEVICE_BLOCKED", summary: `USB device blocked: ${r.deviceDescription ?? r.serialNumber}`, detail: { device: r.deviceDescription, serial: r.serialNumber }, occurredAt: r.occurredAt, sourceTable: "UsbControlEvent", sourceId: r.id }],
  );

  added += await collectSource(
    cursors,
    "appBlock",
    (from) => prisma.appControlEvent.findMany({ where: { occurredAt: { gt: from } }, orderBy: { occurredAt: "asc" }, take: BATCH }),
    (r) => r.occurredAt,
    (r) => [{ agentId: r.agentId, username: null, type: "APP_BLOCKED", summary: `Application blocked: ${r.processName ?? (r.matchedPath ? fileName(r.matchedPath) : "unknown")}`, detail: { process: r.processName, path: r.matchedPath }, occurredAt: r.occurredAt, sourceTable: "AppControlEvent", sourceId: r.id }],
  );

  added += await collectSource(
    cursors,
    "screenshotBlock",
    (from) => prisma.screenshotBlockEvent.findMany({ where: { occurredAt: { gt: from } }, orderBy: { occurredAt: "asc" }, take: BATCH }),
    (r) => r.occurredAt,
    (r) => [{ agentId: r.agentId, username: r.username, type: "SCREENSHOT_BLOCKED", summary: `Screenshot blocked: ${r.detail}`, detail: { kind: r.kind, what: r.detail }, occurredAt: r.occurredAt, sourceTable: "ScreenshotBlockEvent", sourceId: r.id }],
  );

  added += await collectSource(
    cursors,
    "commandBlock",
    (from) => prisma.commandBlockEvent.findMany({ where: { occurredAt: { gt: from } }, orderBy: { occurredAt: "asc" }, take: BATCH }),
    (r) => r.occurredAt,
    (r) => [{ agentId: r.agentId, username: null, type: "COMMAND_BLOCKED", summary: `Command blocked: ${r.matchedCommandLine.slice(0, 200)}`, detail: { command: r.matchedCommandLine.slice(0, 1000), process: r.processName, action: r.action }, occurredAt: r.occurredAt, sourceTable: "CommandBlockEvent", sourceId: r.id }],
  );

  added += await collectSource(
    cursors,
    "edr",
    (from) => prisma.edrEvent.findMany({ where: { createdAt: { gt: from } }, orderBy: { createdAt: "asc" }, take: BATCH }),
    (r) => r.createdAt,
    (r) => [{ agentId: r.agentId, username: null, type: "EDR_DETECTION", summary: `Threat (${r.severity.toLowerCase()}): ${r.summary}`, detail: { severity: r.severity, category: r.category, rule: r.ruleKey }, occurredAt: r.detectedAt, sourceTable: "EdrEvent", sourceId: r.id }],
  );

  // Sign-ins and screenshots change after they are first recorded (a session is reported late,
  // a screenshot is deleted or opened later), so the recent ones are re-read every run.
  const firstRun = !cursors.sessions;
  const sessions = await prisma.userSession.findMany({ where: { loginAt: { gte: recent(firstRun ? BACKFILL_DAYS : 2) } }, orderBy: { loginAt: "asc" } });
  added += await save(
    sessions.map((s) => ({ agentId: s.agentId, username: s.username, type: "LOGON", summary: `Signed in`, detail: {}, occurredAt: s.loginAt, sourceTable: "UserSession", sourceId: s.id })),
  );
  cursors.sessions = new Date().toISOString();

  const captures = await prisma.screenCaptureEvent.findMany({ where: { capturedAt: { gte: recent(firstRun ? BACKFILL_DAYS : 2) } }, orderBy: { capturedAt: "asc" } });
  const captureItems: NewActivity[] = [];
  for (const c of captures) {
    const base = { agentId: c.agentId, username: c.username, sourceTable: "ScreenCaptureEvent" };
    captureItems.push({ ...base, type: "SCREENSHOT", summary: `Screenshot ${fileName(c.filePath)}`, detail: { captureId: c.id, file: c.filePath, source: c.source }, occurredAt: c.capturedAt, sourceId: c.id });
    if (c.deletedAt) {
      const minutesAfter = Math.round((c.deletedAt.getTime() - c.capturedAt.getTime()) / 60_000);
      captureItems.push({ ...base, type: "SCREENSHOT_DELETED", summary: `Screenshot ${fileName(c.filePath)} deleted ${minutesAfter} min after it was taken`, detail: { captureId: c.id, file: c.filePath, minutesAfter }, occurredAt: c.deletedAt, sourceId: c.id });
    }
    for (const o of (JSON.parse(c.openedBy) as { process: string; at: string }[]).filter((x) => !isIgnoredScreenshotOpener(x.process))) {
      captureItems.push({ ...base, type: "SCREENSHOT_OPENED", summary: `Screenshot ${fileName(c.filePath)} opened by ${o.process}`, detail: { captureId: c.id, file: c.filePath, process: o.process }, occurredAt: new Date(o.at), sourceId: `${c.id}|${o.process.toLowerCase()}`.slice(0, 100) });
    }
  }
  added += await save(captureItems);

  return added;
}
