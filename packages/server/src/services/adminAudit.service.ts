import { commandProtection } from "@em/shared";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";
import { logger } from "../logger";

// Identity Governance -> Admin logs. Every change made through the admin API is recorded by one
// middleware (so new features are covered without anyone remembering to log), plus console
// sign-ins and the viewing of sensitive data. Entries are append-only: nothing here edits or
// deletes a single entry; only retention and a super admin's "clear older than" remove old ones,
// and both leave an entry of their own.

export const MIN_RETENTION_DAYS = 90;
export const MAX_RETENTION_DAYS = 3650;

export interface AuditEntry {
  adminId?: string | null;
  adminEmail: string;
  ipAddress?: string | null;
  category: string;
  action: string;
  module?: string | null;
  summary: string;
  targetId?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  success: boolean;
  detail?: unknown;
}

const MAX_DETAIL = 8000;
const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|private[-_]?key|pfx|credential|^key$|cert(ificate)?$/i;

// Values that must never be stored: anything under a key that looks like a secret.
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? (v === "" || v == null ? v : "[redacted]") : redact(v, depth + 1)]),
    );
  }
  if (typeof value === "string" && value.length > 4000) return `${value.slice(0, 4000)}… (${value.length} characters)`;
  return value;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    let detail = JSON.stringify(redact(entry.detail ?? {}));
    if (detail.length > MAX_DETAIL) detail = JSON.stringify({ truncated: true, start: detail.slice(0, MAX_DETAIL - 100) });
    await prisma.adminAuditLog.create({
      data: {
        adminId: entry.adminId ?? null,
        adminEmail: entry.adminEmail.slice(0, 320),
        ipAddress: entry.ipAddress?.slice(0, 64) ?? null,
        category: entry.category.slice(0, 40),
        action: entry.action.slice(0, 60),
        module: entry.module?.slice(0, 60) ?? null,
        summary: entry.summary.slice(0, 500),
        targetId: entry.targetId?.slice(0, 100) ?? null,
        method: entry.method ?? null,
        path: entry.path?.slice(0, 500) ?? null,
        statusCode: entry.statusCode ?? null,
        success: entry.success,
        detail,
      },
    });
  } catch (err) {
    // Never fail the admin's request because the log write failed - but say so loudly.
    logger.error({ err, entry: { ...entry, detail: undefined } }, "Admin log write failed");
  }
}

// ---- describing an API call

const MODULES: Record<string, { label: string; category: string }> = {
  commands: { label: "Commands", category: "Endpoints" },
  "command-templates": { label: "Command templates", category: "Settings" },
  packages: { label: "Software packages", category: "Endpoints" },
  deployments: { label: "Software deployment", category: "Endpoints" },
  "agent-updates": { label: "Agent updates", category: "Endpoints" },
  patches: { label: "Patches", category: "Endpoints" },
  vulnerabilities: { label: "Vulnerabilities", category: "Endpoints" },
  "asset-groups": { label: "Asset groups", category: "Settings" },
  "custom-fields": { label: "Custom fields", category: "Settings" },
  "software-licenses": { label: "Software licences", category: "Settings" },
  "network-scans": { label: "Network scan", category: "Endpoints" },
  "network-vlans": { label: "Network VLANs", category: "Settings" },
  "security-config": { label: "Security configuration", category: "Policies" },
  "zero-trust": { label: "Zero Trust", category: "Policies" },
  "data-discovery": { label: "Data discovery", category: "Policies" },
  dlp: { label: "DLP", category: "Policies" },
  "data-movement": { label: "Data movement", category: "Policies" },
  "screen-capture": { label: "Screen capture", category: "Policies" },
  "app-control": { label: "Application control", category: "Policies" },
  "web-block": { label: "Web blocking", category: "Policies" },
  "pii-block": { label: "PII blocking", category: "Policies" },
  "pii-email-block": { label: "Email attachment blocking", category: "Policies" },
  "command-block": { label: "Command blocking", category: "Policies" },
  "ip-block": { label: "IP blocking", category: "Policies" },
  "screenshot-block": { label: "Screenshot blocking", category: "Policies" },
  "usb-control": { label: "USB control", category: "Policies" },
  "data-types": { label: "Data types", category: "Policies" },
  "policy-exceptions": { label: "Access exceptions", category: "Policies" },
  "agent-security": { label: "Agent security", category: "Settings" },
  "user-productivity": { label: "User productivity", category: "Settings" },
  "user-risk": { label: "User risk", category: "Settings" },
  edr: { label: "EDR", category: "Policies" },
  "ai-guard": { label: "AI Guard", category: "Policies" },
  license: { label: "Licence", category: "Settings" },
  "module-visibility": { label: "Module visibility", category: "Settings" },
  "admin-users": { label: "Administrators", category: "Administrators" },
  // the shared /api/admin router
  agents: { label: "Endpoints", category: "Endpoints" },
  "enrollment-tokens": { label: "Enrollment tokens", category: "Settings" },
  "agent-connection": { label: "Server connection details", category: "Settings" },
  "remote-install": { label: "Remote install", category: "Endpoints" },
};

const VERBS: Record<string, string> = {
  assign: "Assigned",
  run: "Ran",
  "scan-now": "Requested a scan",
  quarantine: "Quarantined",
  "quarantine-bulk": "Quarantined",
  release: "Released",
  "release-bulk": "Released",
  pause: "Paused",
  resume: "Resumed",
  "uninstall-agent": "Started uninstalling the agent",
  "uninstall-software": "Uninstalled software",
  "sync-inventory": "Requested a software sync",
  enable: "Enabled",
  disable: "Disabled",
  apply: "Applied",
  test: "Sent a test",
  notes: "Added a note",
  dispatch: "Dispatched",
  rescan: "Requested a rescan",
  import: "Imported",
  activate: "Activated",
  revalidate: "Revalidated",
  "setup-exe": "Built a setup file",
  delete: "Deleted",
  "emergency-release": "Emergency release - paused every endpoint",
  "resume-all": "Resumed every paused endpoint",
  approve: "Approved",
  reject: "Rejected",
  end: "Ended early",
  "download-images": "Downloaded screenshot images",
  "delete-images": "Deleted screenshot images",
};

// GET requests that read sensitive data - logged as views. Each one is described with readable
// names (endpoint, user, day, policy) looked up when it's logged, never with raw IDs.
type ViewInfo = { summary: string; detail?: Record<string, string> };
type ViewDescriber = (m: RegExpMatchArray, q: Record<string, string | undefined>) => ViewInfo | Promise<ViewInfo>;

async function hostnameOf(id: string | undefined): Promise<string | undefined> {
  if (!id) return undefined;
  const a = await prisma.agent.findUnique({ where: { id }, select: { hostname: true } }).catch(() => null);
  return a?.hostname ?? undefined;
}

async function screenPolicyName(id: string): Promise<string | undefined> {
  const p = await prisma.screenCapturePolicy.findUnique({ where: { id }, select: { name: true } }).catch(() => null);
  return p?.name ?? undefined;
}

async function screenshotOwner(eventId: string): Promise<{ user?: string; endpoint?: string; file?: string }> {
  const e = await prisma.screenCaptureEvent
    .findUnique({ where: { id: eventId }, select: { username: true, filePath: true, agent: { select: { hostname: true } } } })
    .catch(() => null);
  return e ? { user: e.username, endpoint: e.agent.hostname, file: e.filePath.split(/[\\/]/).pop() } : {};
}

// Drops empty values so the stored detail has only what's known.
function fields(f: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter((e): e is [string, string] => !!e[1]));
}

const onEndpoint = (host?: string) => (host ? ` on ${host}` : "");
const forDay = (day?: string) => (day ? ` for ${day}` : "");

const SENSITIVE_VIEWS: { pattern: RegExp; describe: ViewDescriber; module: string }[] = [
  { pattern: /^\/user-risk\/users\/([^/]+)\/timeline$/, describe: (m) => ({ summary: `Viewed the activity timeline of ${decodeURIComponent(m[1])}` }), module: "User risk" },
  { pattern: /^\/user-risk\/users\/([^/]+)$/, describe: (m) => ({ summary: `Viewed the risk profile of ${decodeURIComponent(m[1])}` }), module: "User risk" },
  { pattern: /^\/user-risk\/alerts\/([^/]+)\/events$/, describe: () => ({ summary: "Viewed the activity behind a user risk alert" }), module: "User risk" },
  { pattern: /^\/enrollment-tokens\/([^/]+)\/value$/, describe: () => ({ summary: "Revealed an enrollment token" }), module: "Enrollment tokens" },
  {
    pattern: /^\/data-discovery\/agents\/([^/]+)$/,
    describe: async (m) => {
      const host = await hostnameOf(m[1]);
      return { summary: `Viewed the personal-data findings${onEndpoint(host)}`, detail: fields({ Endpoint: host }) };
    },
    module: "Data discovery",
  },
  {
    pattern: /^\/screen-capture\/([^/]+)\/captures$/,
    describe: async (m, q) => {
      const [host, policy] = await Promise.all([hostnameOf(q.agentId), screenPolicyName(m[1])]);
      return {
        summary: `Viewed the screenshots of ${q.username ?? "a user"}${onEndpoint(host)}${forDay(q.day)}`,
        detail: fields({ User: q.username, Endpoint: host, Day: q.day, Policy: policy }),
      };
    },
    module: "Screen capture",
  },
  {
    pattern: /^\/screen-capture\/endpoints\/([^/]+)\/captures$/,
    describe: async (m, q) => {
      const host = await hostnameOf(m[1]);
      return {
        summary: `Viewed the screenshots of ${q.username ?? "a user"}${onEndpoint(host)}${forDay(q.day)}`,
        detail: fields({ User: q.username, Endpoint: host, Day: q.day }),
      };
    },
    module: "Screen capture",
  },
  {
    pattern: /^\/screen-capture\/images\/([^/]+)\/download$/,
    describe: async (m) => {
      const o = await screenshotOwner(m[1]);
      return {
        summary: `Downloaded a screenshot${o.user ? ` of ${o.user}` : ""}${onEndpoint(o.endpoint)}`,
        detail: fields({ User: o.user, Endpoint: o.endpoint, File: o.file }),
      };
    },
    module: "Screen capture",
  },
];

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^builtin:/i;

export function describe(method: string, path: string, body: unknown): { module: string; category: string; action: string; summary: string; targetId: string | null } {
  const parts = path.split("/").filter(Boolean);
  const mod = MODULES[parts[0]] ?? { label: parts[0] ?? "Console", category: "Settings" };
  const targetId = parts.find((p) => ID.test(p)) ?? null;
  const last = [...parts].reverse().find((p) => !ID.test(p)) ?? "";
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  // A Command blocking protection is named by its title, not its key.
  const protection = b.ruleType === "PROTECTION" && typeof b.value === "string" ? commandProtection(b.value)?.title : undefined;
  const name = [protection, b.name, b.title, b.email, b.hostname, b.label, b.softwareName].find((v) => typeof v === "string" && v.trim()) as string | undefined;

  // Endpoint -> Software tab Block / Release (the console sends the names for this log).
  if (last === "software-blocks" && (method === "POST" || method === "DELETE")) {
    const sw = typeof b.softwareName === "string" && b.softwareName ? `"${b.softwareName}"` : "software";
    const on = typeof b.hostname === "string" && b.hostname ? ` on ${b.hostname}` : " on an endpoint";
    return method === "POST"
      ? { module: mod.label, category: mod.category, action: "BLOCK_SOFTWARE", summary: `Blocked unlicensed software ${sw}${on}`, targetId }
      : { module: mod.label, category: mod.category, action: "RELEASE_SOFTWARE", summary: `Released blocked software ${sw}${on}`, targetId };
  }

  let action: string;
  let verb: string;
  if (method === "DELETE") {
    const unassign = parts.includes("assign");
    action = unassign ? "UNASSIGN" : "DELETE";
    verb = unassign ? "Removed an assignment from" : "Deleted";
  } else if (VERBS[last] && last !== parts[0]) {
    action = last.toUpperCase().replace(/-/g, "_");
    verb = VERBS[last];
  } else if (method === "POST") {
    action = "CREATE";
    verb = "Created";
  } else {
    action = "UPDATE";
    verb = "Changed";
  }

  const what = name ? `${mod.label}: "${name}"` : mod.label;
  // An action on something ("Endpoints: uninstalled the agent") reads better area-first.
  if (VERBS[last] && last !== parts[0] && method !== "DELETE") {
    return { module: mod.label, category: mod.category, action, summary: `${what}: ${verb.charAt(0).toLowerCase()}${verb.slice(1)}`, targetId };
  }
  const sub = last && last !== parts[0] && !VERBS[last] ? ` (${last.replace(/-/g, " ")})` : "";
  return { module: mod.label, category: mod.category, action, summary: `${verb} ${what}${sub}`, targetId };
}

// ---- the middleware (mounted on /api/admin ahead of every admin router)

export function auditCapture(req: Request, res: Response, next: NextFunction) {
  const path = req.path; // relative to /api/admin
  const method = req.method.toUpperCase();
  const view = method === "GET" ? SENSITIVE_VIEWS.find((v) => v.pattern.test(path)) : undefined;
  const isChange = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  // Admin logs' own calls log themselves (see adminAudit.routes.ts).
  if ((!isChange && !view) || path.startsWith("/audit-log")) return next();
  const body = req.body;

  res.on("finish", () => {
    if (!req.adminEmail) return; // never signed in (401) - nothing to attribute
    const ok = res.statusCode < 400;
    if (view) {
      const q = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));
      void Promise.resolve()
        .then(() => view.describe(path.match(view.pattern)!, q))
        .catch((): ViewInfo => ({ summary: `Viewed sensitive data (${view.module})` }))
        .then((info) =>
          writeAudit({
            adminId: req.adminId,
            adminEmail: req.adminEmail!,
            ipAddress: req.ip,
            category: "Sensitive data",
            action: "VIEW",
            module: view.module,
            summary: ok ? info.summary : `${info.summary} - failed (${res.statusCode})`,
            targetId: path.split("/").filter(Boolean).find((p) => ID.test(p)) ?? null,
            method,
            path: req.originalUrl.split("?")[0],
            statusCode: res.statusCode,
            success: ok,
            detail: info.detail ?? {},
          }),
        );
      return;
    }
    // A DELETE carries its names in the query string (it has no body).
    const sent = method === "DELETE" && Object.keys(req.query).length > 0 ? req.query : body;
    const d = describe(method, path, sent);
    void writeAudit({
      adminId: req.adminId,
      adminEmail: req.adminEmail,
      ipAddress: req.ip,
      category: d.category,
      action: d.action,
      module: d.module,
      summary: ok ? d.summary : `${d.summary} - failed (${res.statusCode})`,
      targetId: d.targetId,
      method,
      path: req.originalUrl.split("?")[0],
      statusCode: res.statusCode,
      success: ok,
      detail: { request: sent ?? null },
    });
  });
  next();
}

// ---- reading, retention, clearing (super admins only - see adminAudit.routes.ts)

export async function listAudit(f: { from?: Date; to?: Date; admin?: string; category?: string; success?: boolean; q?: string; page: number; pageSize: number }) {
  const where = {
    ...(f.from || f.to ? { at: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.admin ? { adminEmail: f.admin } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.success === undefined ? {} : { success: f.success }),
    ...(f.q ? { OR: [{ summary: { contains: f.q } }, { adminEmail: { contains: f.q } }, { ipAddress: { contains: f.q } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.adminAuditLog.count({ where }),
    prisma.adminAuditLog.findMany({ where, orderBy: { at: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
  ]);
  return { total, items: rows.map((r) => ({ ...r, at: r.at.toISOString(), detail: JSON.parse(r.detail) as unknown })) };
}

export async function auditFacets() {
  const [admins, categories] = await Promise.all([
    prisma.adminAuditLog.groupBy({ by: ["adminEmail"], orderBy: { adminEmail: "asc" } }),
    prisma.adminAuditLog.groupBy({ by: ["category"], orderBy: { category: "asc" } }),
  ]);
  return { admins: admins.map((a) => a.adminEmail), categories: categories.map((c) => c.category) };
}

export async function getAuditConfig() {
  const row = (await prisma.adminAuditConfig.findUnique({ where: { id: "singleton" } })) ?? (await prisma.adminAuditConfig.create({ data: { id: "singleton" } }));
  const oldest = await prisma.adminAuditLog.findFirst({ orderBy: { at: "asc" }, select: { at: true } });
  return { retentionDays: row.retentionDays, minRetentionDays: MIN_RETENTION_DAYS, oldestEntryAt: oldest?.at.toISOString() ?? null, totalEntries: await prisma.adminAuditLog.count() };
}

export class AuditError extends Error {}

export async function setRetention(days: number, by: Request) {
  if (!Number.isInteger(days) || days < MIN_RETENTION_DAYS || days > MAX_RETENTION_DAYS) {
    throw new AuditError(`Keep logs for between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS} days.`);
  }
  const before = (await getAuditConfig()).retentionDays;
  await prisma.adminAuditConfig.upsert({ where: { id: "singleton" }, create: { id: "singleton", retentionDays: days }, update: { retentionDays: days } });
  await writeAudit({
    adminId: by.adminId,
    adminEmail: by.adminEmail ?? "unknown",
    ipAddress: by.ip,
    category: "Admin logs",
    action: "UPDATE",
    module: "Admin logs",
    summary: `Changed how long admin logs are kept from ${before} to ${days} days`,
    method: "PUT",
    path: "/api/admin/audit-log/settings",
    statusCode: 200,
    success: true,
    detail: { before, after: days },
  });
  return getAuditConfig();
}

// Removes entries older than a date - at least MIN_RETENTION_DAYS ago, so recent activity can't
// be wiped. The clearing itself is recorded straight after.
export async function clearOlderThan(before: Date, by: Request) {
  const latestAllowed = new Date(Date.now() - MIN_RETENTION_DAYS * 24 * 60 * 60_000);
  if (Number.isNaN(before.getTime()) || before > latestAllowed) {
    throw new AuditError(`Only entries older than ${MIN_RETENTION_DAYS} days can be cleared (before ${latestAllowed.toISOString().slice(0, 10)} or earlier).`);
  }
  const { count } = await prisma.adminAuditLog.deleteMany({ where: { at: { lt: before } } });
  await writeAudit({
    adminId: by.adminId,
    adminEmail: by.adminEmail ?? "unknown",
    ipAddress: by.ip,
    category: "Admin logs",
    action: "CLEAR",
    module: "Admin logs",
    summary: `Cleared ${count} admin log ${count === 1 ? "entry" : "entries"} older than ${before.toISOString().slice(0, 10)}`,
    method: "POST",
    path: "/api/admin/audit-log/clear",
    statusCode: 200,
    success: true,
    detail: { before: before.toISOString(), removed: count },
  });
  return { removed: count };
}

export function scheduleAuditRetention() {
  const tick = async () => {
    try {
      const { retentionDays } = await getAuditConfig();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000);
      const { count } = await prisma.adminAuditLog.deleteMany({ where: { at: { lt: cutoff } } });
      if (count > 0) {
        await writeAudit({
          adminEmail: "system",
          category: "Admin logs",
          action: "RETENTION",
          module: "Admin logs",
          summary: `Removed ${count} admin log ${count === 1 ? "entry" : "entries"} older than ${retentionDays} days (retention setting)`,
          success: true,
          detail: { retentionDays, removed: count },
        });
      }
    } catch (err) {
      logger.error({ err }, "Admin log retention failed");
    }
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 6 * 60 * 60_000);
}
