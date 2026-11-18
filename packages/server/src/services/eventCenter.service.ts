import type { AdminModuleKey } from "@em/shared";
import { prisma } from "../db";
import { isModuleLicensed } from "./licenseActivation.service";
import { getModuleVisibility, isModuleHidden } from "./moduleVisibility.service";
import { RULES as USER_RISK_RULES } from "./userRisk/rules";

// Events: one place for everything the agents and the console record - threats, policy
// matches and blocks, compliance failures, user risk alerts and software changes (admin
// actions are not events - they stay in Admin logs). Nothing is copied: each kind is read from its own table (the same rows each
// module's page shows), so this needs no table of its own. Two views: "by event" (each kind of
// event once, with how many endpoints it happened on) and a timeline. Kinds the admin can't
// open - module not licensed, hidden, or not granted to them - are left out, as in the bell.

export const EVENT_CATEGORIES = [
  "THREATS",
  "DATA_PROTECTION",
  "DEVICE_CONTROL",
  "POLICY_VIOLATIONS",
  "COMPLIANCE",
  "USER_RISK",
  "SOFTWARE_CHANGES",
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];

export const MAX_PERIOD_DAYS = 90;

export interface EventFilter {
  from: Date;
  to: Date;
  agentId?: string;
  groupId?: string;
  categories?: EventCategory[];
  severities?: EventSeverity[];
  types?: string[]; // source ids
}

export interface Viewer {
  role: string | undefined;
  grants: string[];
}

export interface EventGroupEndpoint {
  agentId: string;
  hostname: string;
  count: number;
  lastAt: string;
}

export interface EventGroupView {
  key: string; // `${type}|${groupKey}` - pass back as ?event= to see its timeline
  type: string;
  typeLabel: string;
  category: EventCategory;
  severity: EventSeverity;
  title: string;
  occurrences: number;
  endpointCount: number | null; // null: not tied to endpoints (e.g. user risk alerts)
  firstAt: string;
  lastAt: string;
  path: string;
  endpoints: EventGroupEndpoint[]; // most occurrences first, capped
}

export interface EventItemView {
  id: string;
  type: string;
  typeLabel: string;
  category: EventCategory;
  severity: EventSeverity;
  title: string;
  detail: string | null;
  at: string;
  agentId: string | null;
  hostname: string | null;
  user: string | null;
  path: string;
}

export interface EventTypeView {
  type: string;
  label: string;
  category: EventCategory;
}

// ---- sources

interface Access {
  module: AdminModuleKey;
  permission?: string;
  itemPath?: string; // sidebar item; hidden item = hidden events
}

type Row = Record<string, unknown>;

interface Source {
  type: string;
  label: string;
  category: EventCategory;
  access: Access;
  perEndpoint: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: () => any;
  timeField: string; // the time the window and the timeline use
  baseWhere?: Row;
  keyFields: string[]; // one "event" = one combination of these
  // Severity: a fixed one, or from a field (top level, or a relation path like "rule.severity").
  severity: { fixed: EventSeverity } | { field: string; map: Record<string, EventSeverity>; fallback: EventSeverity };
  // Titles (and severity, when it lives on a related row) for groups.
  describe: (keys: Row[]) => Promise<{ title: string; severity?: EventSeverity }[]>;
  select: Row; // timeline row fields (agentId and time are added)
  toItem: (row: Row) => { title: string; detail?: string | null; user?: string | null; severity?: EventSeverity };
  path: (agentId: string | null) => string;
}

const str = (v: unknown) => (v == null ? "" : String(v));
const titleCase = (v: unknown) => {
  const s = str(v).replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const jsonList = (v: unknown): string[] => {
  try {
    const parsed = JSON.parse(str(v));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

// Names for the ids in a set of group keys, one query.
async function namesById(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: any,
  ids: unknown[],
  field = "name",
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (unique.length === 0) return new Map();
  const rows = (await delegate.findMany({ where: { id: { in: unique } }, select: { id: true, [field]: true } })) as Row[];
  return new Map(rows.map((r) => [str(r.id), str(r[field])]));
}

const THREAT_SEVERITY: Record<string, EventSeverity> = { SEVERE: "CRITICAL", HIGH: "HIGH", MODERATE: "MEDIUM", LOW: "LOW", UNKNOWN: "MEDIUM" };
const PLAIN_SEVERITY: Record<string, EventSeverity> = { CRITICAL: "CRITICAL", HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", INFO: "INFO" };
const CHANNEL_LABEL: Record<string, string> = { USB: "USB drive", CLOUD_SYNC: "cloud-sync folder", NETWORK_SHARE: "network drive" };
const SCREENSHOT_KIND: Record<string, string> = { KEY: "Print Screen key", TOOL: "screenshot tool", CLIPBOARD: "copy to clipboard" };
const RISK_RULE_TITLE = new Map(USER_RISK_RULES.map((r) => [r.key, r.title]));

export const SOURCES: Source[] = [
  {
    type: "threat",
    label: "Threat detected",
    category: "THREATS",
    access: { module: "THREAT_PROTECTION" },
    perEndpoint: true,
    delegate: () => prisma.threatDetection,
    timeField: "detectedAt",
    keyFields: ["threatName", "severity"],
    severity: { field: "severity", map: THREAT_SEVERITY, fallback: "MEDIUM" },
    describe: async (keys) => keys.map((k) => ({ title: str(k.threatName) })),
    select: { threatName: true, severity: true, filePath: true, username: true, status: true, source: true },
    toItem: (r) => ({
      title: str(r.threatName),
      detail: [titleCase(r.status), r.source === "YARA" ? "YARA" : "Defender", str(r.filePath)].filter(Boolean).join(" · "),
      user: (r.username as string | null) ?? null,
    }),
    path: (agentId) => (agentId ? `/threat-protection/threats?agent=${encodeURIComponent(agentId)}` : "/threat-protection/threats"),
  },
  {
    type: "edr",
    label: "EDR detection",
    category: "THREATS",
    access: { module: "SECURITY_MANAGER" },
    perEndpoint: true,
    delegate: () => prisma.edrEvent,
    timeField: "detectedAt",
    keyFields: ["summary", "severity"],
    severity: { field: "severity", map: PLAIN_SEVERITY, fallback: "MEDIUM" },
    describe: async (keys) => keys.map((k) => ({ title: str(k.summary) })),
    select: { summary: true, severity: true, category: true, killed: true },
    toItem: (r) => ({ title: str(r.summary), detail: [titleCase(r.category), r.killed ? "Process stopped" : ""].filter(Boolean).join(" · ") }),
    path: () => "/edr",
  },
  {
    type: "dlp",
    label: "DLP match",
    category: "DATA_PROTECTION",
    access: { module: "DATA_MANAGER", itemPath: "/dlp" },
    perEndpoint: true,
    delegate: () => prisma.dlpEvent,
    timeField: "occurredAt",
    keyFields: ["policyId", "action"],
    severity: { field: "action", map: { BLOCKED: "HIGH", ALERTED: "MEDIUM" }, fallback: "MEDIUM" },
    describe: async (keys) => {
      const names = await namesById(prisma.dlpPolicy, keys.map((k) => k.policyId));
      return keys.map((k) => ({ title: `${k.action === "BLOCKED" ? "File blocked" : "Sensitive file found"} by DLP policy ${names.get(str(k.policyId)) ?? "(deleted)"}` }));
    },
    select: { action: true, filePath: true, processName: true, policy: { select: { name: true } } },
    toItem: (r) => ({
      title: `${r.action === "BLOCKED" ? "File blocked" : "Sensitive file found"} by DLP policy ${str((r.policy as Row | null)?.name)}`,
      detail: [str(r.filePath), str(r.processName)].filter(Boolean).join(" · "),
    }),
    path: () => "/dlp/content-policies",
  },
  {
    type: "data-movement",
    label: "File moved off the endpoint",
    category: "DATA_PROTECTION",
    access: { module: "DATA_MANAGER", itemPath: "/data-movement" },
    perEndpoint: true,
    delegate: () => prisma.dataMovementEvent,
    timeField: "detectedAt",
    keyFields: ["policyId", "channel"],
    severity: { fixed: "MEDIUM" },
    describe: async (keys) => {
      const names = await namesById(prisma.dataMovementPolicy, keys.map((k) => k.policyId));
      return keys.map((k) => ({ title: `Files copied to a ${CHANNEL_LABEL[str(k.channel)] ?? titleCase(k.channel)} (policy ${names.get(str(k.policyId)) ?? "(deleted)"})` }));
    },
    select: { channel: true, filePath: true, userName: true, operation: true },
    toItem: (r) => ({
      title: `File ${r.operation === "MOVE" ? "moved" : "copied"} to a ${CHANNEL_LABEL[str(r.channel)] ?? titleCase(r.channel)}`,
      detail: str(r.filePath),
      user: (r.userName as string | null) ?? null,
    }),
    path: () => "/data-movement/files",
  },
  {
    type: "email-block",
    label: "Email attachment with personal data",
    category: "DATA_PROTECTION",
    access: { module: "DATA_MANAGER", itemPath: "/epm" },
    perEndpoint: false,
    delegate: () => prisma.piiEmailBlockEvent,
    timeField: "occurredAt",
    keyFields: ["action"],
    severity: { field: "action", map: { BLOCKED: "HIGH", ALLOWED_WARNED: "MEDIUM" }, fallback: "MEDIUM" },
    describe: async (keys) =>
      keys.map((k) => ({ title: k.action === "BLOCKED" ? "Email stopped: attachment with personal data" : "Email sent after a personal data warning" })),
    select: { action: true, senderEmail: true, attachmentName: true, matchedCategoryLabels: true },
    toItem: (r) => ({
      title: r.action === "BLOCKED" ? "Email stopped: attachment with personal data" : "Email sent after a personal data warning",
      detail: [str(r.attachmentName), jsonList(r.matchedCategoryLabels).join(", ")].filter(Boolean).join(" · "),
      user: str(r.senderEmail) || null,
    }),
    path: () => "/epm/email-attachment-block",
  },
  {
    type: "usb-blocked",
    label: "USB device blocked",
    category: "DEVICE_CONTROL",
    access: { module: "DATA_MANAGER", itemPath: "/epm" },
    perEndpoint: true,
    delegate: () => prisma.usbControlEvent,
    timeField: "occurredAt",
    keyFields: ["serialNumber", "deviceDescription"],
    severity: { fixed: "MEDIUM" },
    describe: async (keys) => keys.map((k) => ({ title: `USB device blocked: ${str(k.deviceDescription) || str(k.serialNumber)}` })),
    select: { serialNumber: true, deviceDescription: true },
    toItem: (r) => ({ title: `USB device blocked: ${str(r.deviceDescription) || str(r.serialNumber)}`, detail: `Serial ${str(r.serialNumber)}` }),
    path: () => "/epm/usb-control",
  },
  {
    type: "screenshot-blocked",
    label: "Screenshot blocked",
    category: "DEVICE_CONTROL",
    access: { module: "DATA_MANAGER", itemPath: "/epm" },
    perEndpoint: true,
    delegate: () => prisma.screenshotBlockEvent,
    timeField: "occurredAt",
    keyFields: ["kind"],
    severity: { fixed: "LOW" },
    describe: async (keys) => keys.map((k) => ({ title: `Screenshot blocked (${SCREENSHOT_KIND[str(k.kind)] ?? titleCase(k.kind)})` })),
    select: { kind: true, detail: true, username: true },
    toItem: (r) => ({
      title: `Screenshot blocked (${SCREENSHOT_KIND[str(r.kind)] ?? titleCase(r.kind)})`,
      detail: str(r.detail) || null,
      user: str(r.username) || null,
    }),
    path: () => "/epm/screenshot-block",
  },
  {
    type: "app-blocked",
    label: "Blocked app started",
    category: "POLICY_VIOLATIONS",
    access: { module: "DATA_MANAGER", itemPath: "/epm" },
    perEndpoint: true,
    delegate: () => prisma.appControlEvent,
    timeField: "occurredAt",
    keyFields: ["processName", "policyId"],
    severity: { fixed: "MEDIUM" },
    describe: async (keys) => {
      const names = await namesById(prisma.appControlPolicy, keys.map((k) => k.policyId));
      return keys.map((k) => ({
        title: `Blocked app started: ${str(k.processName) || "unknown app"}${k.policyId ? ` (policy ${names.get(str(k.policyId)) ?? "(deleted)"})` : ""}`,
      }));
    },
    select: { processName: true, matchedPath: true },
    toItem: (r) => ({ title: `Blocked app started: ${str(r.processName) || "unknown app"}`, detail: str(r.matchedPath) || null }),
    path: () => "/epm/app-control",
  },
  {
    type: "command-blocked",
    label: "Harmful command",
    category: "POLICY_VIOLATIONS",
    access: { module: "DATA_MANAGER", itemPath: "/epm" },
    perEndpoint: true,
    delegate: () => prisma.commandBlockEvent,
    timeField: "occurredAt",
    keyFields: ["ruleId", "action", "processName"],
    severity: { field: "action", map: { BLOCKED: "HIGH", ALERTED: "MEDIUM" }, fallback: "HIGH" },
    describe: async (keys) => {
      const rules = await prisma.commandBlockRule.findMany({
        where: { id: { in: [...new Set(keys.map((k) => str(k.ruleId)))] } },
        select: { id: true, label: true, value: true },
      });
      const byId = new Map(rules.map((r) => [r.id, r.label || r.value]));
      return keys.map((k) => ({
        title: `${k.action === "BLOCKED" ? "Command blocked" : "Command allowed with alert"}: ${byId.get(str(k.ruleId)) ?? str(k.processName) ?? "rule"}`,
      }));
    },
    select: { action: true, processName: true, matchedCommandLine: true },
    toItem: (r) => ({
      title: `${r.action === "BLOCKED" ? "Command blocked" : "Command allowed with alert"}${r.processName ? `: ${str(r.processName)}` : ""}`,
      detail: str(r.matchedCommandLine).slice(0, 500),
    }),
    path: () => "/epm/command-block",
  },
  {
    type: "zero-trust",
    label: "Zero Trust check failed",
    category: "COMPLIANCE",
    access: { module: "SECURITY_MANAGER", itemPath: "/zero-trust" },
    perEndpoint: true,
    delegate: () => prisma.zeroTrustFinding,
    // A failing check is a state, not a one-off: it is shown from the last time it was seen failing.
    timeField: "lastSeenAt",
    baseWhere: { status: "FAIL" },
    keyFields: ["conditionId"],
    severity: { fixed: "HIGH" },
    describe: async (keys) => {
      const names = await namesById(prisma.zeroTrustCondition, keys.map((k) => k.conditionId), "title");
      return keys.map((k) => ({ title: `Zero Trust check failed: ${names.get(str(k.conditionId)) ?? "(deleted check)"}` }));
    },
    select: { actualValue: true, detectedAt: true, condition: { select: { title: true } } },
    toItem: (r) => ({
      title: `Zero Trust check failed: ${str((r.condition as Row | null)?.title)}`,
      detail: [str(r.actualValue).slice(0, 300), r.detectedAt instanceof Date ? `failing since ${r.detectedAt.toISOString().slice(0, 10)}` : ""]
        .filter(Boolean)
        .join(" · "),
    }),
    path: () => "/zero-trust",
  },
  {
    type: "security-config",
    label: "Security configuration check failed",
    category: "COMPLIANCE",
    access: { module: "SECURITY_MANAGER", itemPath: "/security-config" },
    perEndpoint: true,
    delegate: () => prisma.securityBenchmarkFinding,
    timeField: "lastSeenAt",
    baseWhere: { status: "FAIL" },
    keyFields: ["ruleId"],
    severity: { field: "rule.severity", map: PLAIN_SEVERITY, fallback: "MEDIUM" },
    describe: async (keys) => {
      const rules = await prisma.securityBenchmarkRule.findMany({
        where: { id: { in: [...new Set(keys.map((k) => str(k.ruleId)))] } },
        select: { id: true, title: true, severity: true },
      });
      const byId = new Map(rules.map((r) => [r.id, r]));
      return keys.map((k) => {
        const rule = byId.get(str(k.ruleId));
        return { title: `Security configuration failed: ${rule?.title ?? "(deleted rule)"}`, severity: PLAIN_SEVERITY[rule?.severity ?? ""] ?? "MEDIUM" };
      });
    },
    select: { actualValue: true, rule: { select: { title: true, severity: true } } },
    toItem: (r) => {
      const rule = (r.rule as Row | null) ?? {};
      return {
        title: `Security configuration failed: ${str(rule.title)}`,
        detail: str(r.actualValue).slice(0, 300) || null,
        severity: PLAIN_SEVERITY[str(rule.severity)] ?? "MEDIUM",
      };
    },
    path: () => "/security-config",
  },
  {
    type: "user-risk",
    label: "User risk alert",
    category: "USER_RISK",
    access: { module: "USER_MANAGER", permission: "USER_RISK", itemPath: "/user-risk" },
    perEndpoint: false,
    delegate: () => prisma.userRiskAlert,
    timeField: "createdAt",
    keyFields: ["ruleKey", "severity"],
    severity: { field: "severity", map: PLAIN_SEVERITY, fallback: "MEDIUM" },
    describe: async (keys) => keys.map((k) => ({ title: RISK_RULE_TITLE.get(str(k.ruleKey)) ?? titleCase(k.ruleKey) })),
    select: { title: true, detail: true, username: true, severity: true, status: true },
    toItem: (r) => ({ title: str(r.title), detail: str(r.detail).slice(0, 500) || null, user: str(r.username) || null }),
    path: () => "/user-risk/alerts",
  },
  {
    type: "software-change",
    label: "Software change",
    category: "SOFTWARE_CHANGES",
    access: { module: "ENDPOINT_MANAGER", itemPath: "/endpoints" },
    perEndpoint: true,
    delegate: () => prisma.agentSoftwareChange,
    timeField: "detectedAt",
    keyFields: ["change", "name"],
    severity: { fixed: "INFO" },
    describe: async (keys) => keys.map((k) => ({ title: `${titleCase(k.change)}: ${str(k.name)}` })),
    select: { change: true, name: true, version: true, oldVersion: true, publisher: true },
    toItem: (r) => ({
      title: `${titleCase(r.change)}: ${str(r.name)}`,
      detail:
        r.change === "UPDATED"
          ? `${str(r.oldVersion) || "?"} → ${str(r.version) || "?"}`
          : [str(r.version), str(r.publisher)].filter(Boolean).join(" · ") || null,
    }),
    path: (agentId) => (agentId ? `/endpoints/${encodeURIComponent(agentId)}` : "/endpoints"),
  },
];

// ---- access

export async function visibleSources(viewer: Viewer): Promise<Source[]> {
  const visibility = await getModuleVisibility();
  const hiddenPaths = new Set(visibility.hiddenItemPaths);
  const moduleOk = new Map<AdminModuleKey, boolean>();
  for (const key of new Set(SOURCES.map((s) => s.access.module))) {
    const ok =
      !(await isModuleHidden(key)) &&
      (await isModuleLicensed(key as Parameters<typeof isModuleLicensed>[0])) &&
      (viewer.role === "SUPER_ADMIN" || viewer.grants.includes(key));
    moduleOk.set(key, ok);
  }
  return SOURCES.filter((s) => {
    if (!moduleOk.get(s.access.module)) return false;
    if (s.access.permission && viewer.role !== "SUPER_ADMIN" && !viewer.grants.includes(s.access.permission)) return false;
    if (s.access.itemPath && hiddenPaths.has(s.access.itemPath)) return false;
    return true;
  });
}

// ---- where clauses

// { "rule.severity": x } -> { rule: { severity: x } }
function nested(path: string, value: unknown): Row {
  return path
    .split(".")
    .reverse()
    .reduce<unknown>((acc, part) => ({ [part]: acc }), value) as Row;
}

function rawSeverities(source: Source, wanted: EventSeverity[]): string[] {
  if ("fixed" in source.severity) return [];
  return Object.entries(source.severity.map)
    .filter(([, sev]) => wanted.includes(sev))
    .map(([raw]) => raw);
}

// The where for one source under a filter, or null when the filter rules the source out.
export function sourceWhere(source: Source, f: EventFilter, groupKey?: Row): Row | null {
  if (f.types?.length && !f.types.includes(source.type)) return null;
  if (f.categories?.length && !f.categories.includes(source.category)) return null;
  const and: Row[] = [{ [source.timeField]: { gte: f.from, lte: f.to } }];
  if (source.baseWhere) and.push(source.baseWhere);
  // Endpoint or group filter: kinds not tied to an endpoint drop out.
  if (f.agentId || f.groupId) {
    if (!source.perEndpoint) return null;
    and.push(f.agentId ? { agentId: f.agentId } : { agent: { groupMemberships: { some: { groupId: f.groupId } } } });
  }
  // Severity: fixed per source, or from a field.
  if (f.severities?.length) {
    if ("fixed" in source.severity) {
      if (!f.severities.includes(source.severity.fixed)) return null;
    } else {
      const raws = rawSeverities(source, f.severities);
      const allMapped = Object.keys(source.severity.map);
      if (f.severities.includes(source.severity.fallback)) {
        // Unmapped values count as the fallback: exclude the mapped values not wanted instead.
        const unwanted = allMapped.filter((raw) => !raws.includes(raw));
        if (unwanted.length) and.push(nested(source.severity.field, { notIn: unwanted }));
      } else {
        if (raws.length === 0) return null;
        and.push(nested(source.severity.field, { in: raws }));
      }
    }
  }
  if (groupKey) {
    for (const field of source.keyFields) and.push({ [field]: groupKey[field] ?? null });
  }
  return { AND: and };
}

async function hostnames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 1000) {
    const rows = await prisma.agent.findMany({ where: { id: { in: unique.slice(i, i + 1000) } }, select: { id: true, hostname: true } });
    for (const r of rows) out.set(r.id, r.hostname);
  }
  return out;
}

const encodeKey = (source: Source, row: Row) => `${source.type}|${JSON.stringify(source.keyFields.map((k) => row[k] ?? null))}`;

export function decodeEventKey(key: string): { type: string; groupKey: Row } | null {
  const bar = key.indexOf("|");
  if (bar < 1) return null;
  const type = key.slice(0, bar);
  const source = SOURCES.find((s) => s.type === type);
  if (!source) return null;
  try {
    const values = JSON.parse(key.slice(bar + 1));
    if (!Array.isArray(values) || values.length !== source.keyFields.length) return null;
    return { type, groupKey: Object.fromEntries(source.keyFields.map((k, i) => [k, values[i]])) };
  } catch {
    return null;
  }
}

function severityOfKey(source: Source, row: Row): EventSeverity {
  if ("fixed" in source.severity) return source.severity.fixed;
  if (source.severity.field.includes(".")) return source.severity.fallback; // from describe
  return source.severity.map[str(row[source.severity.field])] ?? source.severity.fallback;
}

const SEVERITY_RANK: Record<EventSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
export const MAX_GROUP_ENDPOINTS = 200;

// ---- by event

export async function getEventGroups(viewer: Viewer, f: EventFilter) {
  const sources = await visibleSources(viewer);
  const perSource = await Promise.all(
    sources.map(async (source) => {
      const where = sourceWhere(source, f);
      if (!where) return [];
      const by = source.perEndpoint ? [...source.keyFields, "agentId"] : source.keyFields;
      const rows = (await source.delegate().groupBy({
        by,
        where,
        _count: { _all: true },
        _min: { [source.timeField]: true },
        _max: { [source.timeField]: true },
      })) as (Row & { _count: { _all: number }; _min: Row; _max: Row })[];
      // Fold the per-endpoint rows into one group per key.
      const groups = new Map<string, { keyRow: Row; count: number; first: Date; last: Date; agents: Map<string, { count: number; last: Date }> }>();
      for (const r of rows) {
        const key = encodeKey(source, r);
        const first = r._min[source.timeField] as Date;
        const last = r._max[source.timeField] as Date;
        const g = groups.get(key) ?? { keyRow: r, count: 0, first, last, agents: new Map() };
        g.count += r._count._all;
        if (first < g.first) g.first = first;
        if (last > g.last) g.last = last;
        if (source.perEndpoint && typeof r.agentId === "string") {
          const a = g.agents.get(r.agentId) ?? { count: 0, last };
          a.count += r._count._all;
          if (last > a.last) a.last = last;
          g.agents.set(r.agentId, a);
        }
        groups.set(key, g);
      }
      const list = [...groups.entries()];
      const described = await source.describe(list.map(([, g]) => g.keyRow));
      return list.map(([key, g], i) => ({ source, key, g, title: described[i]?.title ?? source.label, severity: described[i]?.severity ?? severityOfKey(source, g.keyRow) }));
    }),
  );

  let flat = perSource.flat();
  // Severities taken from a related row (describe) are filtered here too.
  if (f.severities?.length) flat = flat.filter((x) => f.severities!.includes(x.severity));

  const names = await hostnames(flat.flatMap((x) => [...x.g.agents.keys()]));
  const groups: EventGroupView[] = flat.map(({ source, key, g, title, severity }) => ({
    key,
    type: source.type,
    typeLabel: source.label,
    category: source.category,
    severity,
    title,
    occurrences: g.count,
    endpointCount: source.perEndpoint ? g.agents.size : null,
    firstAt: g.first.toISOString(),
    lastAt: g.last.toISOString(),
    path: source.path(f.agentId ?? null),
    endpoints: [...g.agents.entries()]
      .sort((a, b) => b[1].count - a[1].count || b[1].last.getTime() - a[1].last.getTime())
      .slice(0, MAX_GROUP_ENDPOINTS)
      .map(([agentId, a]) => ({ agentId, hostname: names.get(agentId) ?? "(removed endpoint)", count: a.count, lastAt: a.last.toISOString() })),
  }));
  groups.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.lastAt.localeCompare(a.lastAt));

  const allEndpoints = new Set(flat.flatMap((x) => [...x.g.agents.keys()]));
  const bySeverity = Object.fromEntries(EVENT_SEVERITIES.map((s) => [s, 0])) as Record<EventSeverity, number>;
  const byCategory: Partial<Record<EventCategory, number>> = {};
  for (const g of groups) {
    bySeverity[g.severity] += g.occurrences;
    byCategory[g.category] = (byCategory[g.category] ?? 0) + g.occurrences;
  }
  return {
    from: f.from.toISOString(),
    to: f.to.toISOString(),
    totals: {
      events: groups.reduce((n, g) => n + g.occurrences, 0),
      kinds: groups.length,
      endpoints: allEndpoints.size,
      bySeverity,
      byCategory,
    },
    groups,
  };
}

// ---- timeline

export const TIMELINE_PAGE = 100;

// Newest first. `before` (the last row's time) pages back; each source gives at most one page,
// then they are merged.
export async function getEventTimeline(viewer: Viewer, f: EventFilter, opts: { before?: Date; event?: string; limit?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? TIMELINE_PAGE, 1), 500);
  const sources = await visibleSources(viewer);
  const decoded = opts.event ? decodeEventKey(opts.event) : null;
  const to = opts.before && opts.before < f.to ? opts.before : f.to;
  const window: EventFilter = { ...f, to };

  const perSource = await Promise.all(
    sources.map(async (source) => {
      if (decoded && decoded.type !== source.type) return [];
      const where = sourceWhere(source, window, decoded?.groupKey);
      if (!where) return [];
      // `before` is exclusive: rows at exactly the cursor time were on the previous page.
      if (opts.before) (where.AND as Row[]).push({ [source.timeField]: { lt: opts.before } });
      const rows = (await source.delegate().findMany({
        where,
        orderBy: { [source.timeField]: "desc" },
        take: limit,
        select: { id: true, [source.timeField]: true, ...(source.perEndpoint ? { agentId: true } : {}), ...source.select },
      })) as Row[];
      return rows.map((row) => {
        const item = source.toItem(row);
        const agentId = source.perEndpoint ? str(row.agentId) || null : null;
        return {
          id: `${source.type}:${str(row.id)}`,
          type: source.type,
          typeLabel: source.label,
          category: source.category,
          severity: item.severity ?? severityOfKey(source, row),
          title: item.title,
          detail: item.detail ?? null,
          at: (row[source.timeField] as Date).toISOString(),
          agentId,
          hostname: null as string | null,
          user: item.user ?? null,
          path: source.path(agentId),
        } satisfies EventItemView;
      });
    }),
  );

  let items = perSource.flat();
  if (f.severities?.length) items = items.filter((i) => f.severities!.includes(i.severity));
  items.sort((a, b) => b.at.localeCompare(a.at));
  const page = items.slice(0, limit);
  const names = await hostnames(page.map((i) => i.agentId).filter((v): v is string => !!v));
  for (const i of page) if (i.agentId) i.hostname = names.get(i.agentId) ?? "(removed endpoint)";
  // More if any source filled its page or the merge cut rows off.
  const hasMore = items.length > limit || perSource.some((rows) => rows.length >= limit);
  return { items: page, nextBefore: hasMore && page.length ? page[page.length - 1].at : null };
}

// ---- filter choices

export async function getEventOptions(viewer: Viewer) {
  const sources = await visibleSources(viewer);
  const [agents, groups] = await Promise.all([
    prisma.agent.findMany({ select: { id: true, hostname: true }, orderBy: { hostname: "asc" } }),
    prisma.assetGroup.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    types: sources.map((s): EventTypeView => ({ type: s.type, label: s.label, category: s.category })),
    agents,
    groups,
  };
}
