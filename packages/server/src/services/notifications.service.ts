import type { AdminModuleKey } from "@em/shared";
import { prisma } from "../db";
import { countOpenLicenseChangeNotices } from "./licenseChange.service";
import { isModuleLicensed } from "./licenseActivation.service";
import { isModuleHidden } from "./moduleVisibility.service";
import { getPolicyReport } from "./screenCapturePolicy.service";

// The console's alert bell: policy violations and matches from every module over the last 7
// days, grouped by kind (one line per kind, not per event) so the list stays short enough to
// read. Each group says how many happened since the admin last opened the bell (`since`, kept
// in their browser), on how many endpoints, and which page to open. Groups the admin can't
// open - module not licensed, hidden on this deployment or not granted to them - are left out.

export const WINDOW_DAYS = 7;

export interface NotificationGroup {
  key: string;
  module: string; // area shown in the bell
  title: string; // "Files matched a DLP policy"
  path: string; // console page to open
  total: number; // last 7 days (or, for requests, everything still waiting)
  newCount: number; // since `since`
  endpoints: number | null; // distinct endpoints among `total` (null: not per endpoint)
  latestAt: string | null;
  tone: "crit" | "high" | "med";
}

interface Viewer {
  role: string | undefined;
  grants: string[];
}

async function canOpen(viewer: Viewer, moduleKey: AdminModuleKey, permission?: string): Promise<boolean> {
  if (await isModuleHidden(moduleKey)) return false;
  if (!(await isModuleLicensed(moduleKey as Parameters<typeof isModuleLicensed>[0]))) return false;
  if (viewer.role === "SUPER_ADMIN") return true;
  if (!viewer.grants.includes(moduleKey)) return false;
  return !permission || viewer.grants.includes(permission);
}

// Counts for one event table: total and endpoints in the window, new since `since`, latest time.
async function eventGroup(
  // Each Prisma delegate has its own types; they share count/groupBy/findFirst with these shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: any,
  timeField: string,
  where: Record<string, unknown>,
  windowStart: Date,
  since: Date,
  perEndpoint = true,
): Promise<Pick<NotificationGroup, "total" | "newCount" | "endpoints" | "latestAt">> {
  const inWindow = { ...where, [timeField]: { gte: windowStart } };
  const [total, newCount, latest, agents] = await Promise.all([
    delegate.count({ where: inWindow }) as Promise<number>,
    delegate.count({ where: { ...where, [timeField]: { gt: since } } }) as Promise<number>,
    delegate.findFirst({ where: inWindow, orderBy: { [timeField]: "desc" }, select: { [timeField]: true } }) as Promise<Record<string, Date> | null>,
    perEndpoint ? (delegate.groupBy({ by: ["agentId"], where: inWindow }) as Promise<unknown[]>) : Promise.resolve(null),
  ]);
  return { total, newCount, endpoints: agents ? agents.length : null, latestAt: latest ? latest[timeField].toISOString() : null };
}

export async function getNotifications(viewer: Viewer, sinceParam: Date | null): Promise<{ since: string; groups: NotificationGroup[] }> {
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  // Never opened (or longer ago than the window): everything in the window counts as new.
  const since = sinceParam && sinceParam > windowStart ? sinceParam : windowStart;

  const [data, security, users, userRisk, threats, aiGuard] = await Promise.all([
    canOpen(viewer, "DATA_MANAGER"),
    canOpen(viewer, "SECURITY_MANAGER"),
    canOpen(viewer, "USER_MANAGER"),
    canOpen(viewer, "USER_MANAGER", "USER_RISK"),
    canOpen(viewer, "THREAT_PROTECTION"),
    canOpen(viewer, "AI_GUARD"),
  ]);

  const jobs: Promise<NotificationGroup | null>[] = [];
  const add = (meta: Omit<NotificationGroup, "total" | "newCount" | "endpoints" | "latestAt">, counts: Promise<Pick<NotificationGroup, "total" | "newCount" | "endpoints" | "latestAt">>) =>
    jobs.push(counts.then((c) => (c.total > 0 ? { ...meta, ...c } : null)));

  if (data) {
    add(
      { key: "dlp", module: "DLP", title: "Files matched a DLP policy", path: "/dlp/content-policies", tone: "high" },
      eventGroup(prisma.dlpEvent, "occurredAt", {}, windowStart, since),
    );
    add(
      { key: "data-movement", module: "Data movement", title: "Files moved to USB, cloud or network drives", path: "/data-movement/files", tone: "med" },
      eventGroup(prisma.dataMovementEvent, "detectedAt", {}, windowStart, since),
    );
    jobs.push(screenCaptureGroup(windowStart, since));
    add(
      { key: "screenshot-block", module: "EPM", title: "Screenshots blocked", path: "/epm/screenshot-block", tone: "med" },
      eventGroup(prisma.screenshotBlockEvent, "occurredAt", {}, windowStart, since),
    );
    add(
      { key: "app-control", module: "EPM", title: "Blocked apps started", path: "/epm/app-control", tone: "med" },
      eventGroup(prisma.appControlEvent, "occurredAt", {}, windowStart, since),
    );
    add(
      { key: "command-block", module: "EPM", title: "Harmful commands blocked", path: "/epm/command-block", tone: "high" },
      eventGroup(prisma.commandBlockEvent, "occurredAt", {}, windowStart, since),
    );
    add(
      { key: "usb-control", module: "EPM", title: "USB devices blocked", path: "/epm/usb-control", tone: "med" },
      eventGroup(prisma.usbControlEvent, "occurredAt", {}, windowStart, since),
    );
    add(
      { key: "email-block", module: "EPM", title: "Emails with personal data in attachments", path: "/epm/email-attachment-block", tone: "high" },
      eventGroup(prisma.piiEmailBlockEvent, "occurredAt", {}, windowStart, since, false),
    );
    jobs.push(pauseRequestGroup(since));
  }
  if (viewer.role === "SUPER_ADMIN") jobs.push(licenseRequestGroup(since));
  if (security) {
    add(
      { key: "edr", module: "EDR", title: "High and critical threat detections", path: "/edr", tone: "crit" },
      eventGroup(prisma.edrEvent, "detectedAt", { severity: { in: ["HIGH", "CRITICAL"] } }, windowStart, since),
    );
  }
  if (threats) {
    add(
      { key: "threats", module: "Threat Protection", title: "Threats found on endpoints", path: "/threat-protection/threats", tone: "crit" },
      eventGroup(prisma.threatDetection, "detectedAt", {}, windowStart, since),
    );
  }
  if (aiGuard) {
    add(
      { key: "ai-prompts", module: "AI Guard", title: "Sensitive data caught in AI prompts", path: "/ai-guard/overview", tone: "high" },
      eventGroup(prisma.aiGuardPromptEvent, "occurredAt", {}, windowStart, since),
    );
  }
  if (users && userRisk) {
    add(
      { key: "user-risk", module: "User risk", title: "High and critical user risk alerts", path: "/user-risk/alerts", tone: "crit" },
      eventGroup(prisma.userRiskAlert, "createdAt", { severity: { in: ["HIGH", "CRITICAL"] } }, windowStart, since, false),
    );
  }

  const groups = (await Promise.all(jobs)).filter((g): g is NotificationGroup => !!g);
  groups.sort((a, b) => b.newCount - a.newCount || (b.latestAt ?? "").localeCompare(a.latestAt ?? ""));
  return { since: since.toISOString(), groups };
}

// Licence changes from the License Server waiting for a super admin's answer.
async function licenseRequestGroup(since: Date): Promise<NotificationGroup | null> {
  const open = await countOpenLicenseChangeNotices();
  if (open.total === 0) return null;
  return {
    key: "licence-requests",
    module: "Licensing",
    title: "Licence change requests waiting for your answer",
    path: "/licensing",
    tone: "high",
    total: open.total,
    newCount: open.newSince(since),
    endpoints: null,
    latestAt: open.latestAt?.toISOString() ?? null,
  };
}

// Users over a screen capture policy's daily limit (user-days, last 7 days).
async function screenCaptureGroup(windowStart: Date, since: Date): Promise<NotificationGroup | null> {
  const policies = await prisma.screenCapturePolicy.findMany({ where: { enabled: true }, select: { id: true } });
  const rows = (await Promise.all(policies.map((p) => getPolicyReport(p.id, WINDOW_DAYS))))
    .flatMap((r) => r?.rows ?? [])
    .filter((r) => r.overThreshold && new Date(r.lastCaptureAt) >= windowStart);
  // The same user-day can be over the limit in two policies: count it once.
  const unique = new Map(rows.map((r) => [`${r.agentId}|${r.username.toLowerCase()}|${r.day}`, r]));
  if (unique.size === 0) return null;
  const list = [...unique.values()];
  const latest = list.reduce((m, r) => (r.lastCaptureAt > m ? r.lastCaptureAt : m), "");
  return {
    key: "screen-capture",
    module: "Data movement",
    title: "Users over the daily screenshot limit",
    path: "/data-movement/screen-capture",
    tone: "high",
    total: list.length,
    newCount: list.filter((r) => new Date(r.lastCaptureAt) > since).length,
    endpoints: new Set(list.map((r) => r.agentId)).size,
    latestAt: latest || null,
  };
}

// Pause requests and access exceptions waiting for a decision (however old).
async function pauseRequestGroup(since: Date): Promise<NotificationGroup | null> {
  const pending = await prisma.policyAccessException.findMany({ where: { status: "PENDING" }, select: { agentId: true, createdAt: true } });
  if (pending.length === 0) return null;
  const latest = pending.reduce((m, p) => (p.createdAt > m ? p.createdAt : m), pending[0].createdAt);
  return {
    key: "access-requests",
    module: "Data governance",
    title: "Pause and access requests waiting for approval",
    path: "/access-exceptions",
    tone: "high",
    total: pending.length,
    newCount: pending.filter((p) => p.createdAt > since).length,
    endpoints: new Set(pending.map((p) => p.agentId)).size,
    latestAt: latest.toISOString(),
  };
}
