import { createHash } from "node:crypto";
import {
  AI_APP_CATALOG,
  hostMatchesDomain,
  normaliseAiDomain,
  processNameOf,
  type AiAppCategory,
  type AiAppRisk,
  type AppControlRuleWire,
} from "@em/shared";
import { prisma } from "../db";
import { isAgentPaused } from "./pause.service";
import { isModuleHidden } from "./moduleVisibility.service";
import { isModuleLicensed } from "./licenseActivation.service";
import { isPolicyExcepted } from "./policyAccessException.service";
import { assertAssignable } from "./policyExclusivity.service";
import { effectiveMemberships, membersOfGroups, membershipsUnderGroups } from "./groupTree.service";

// AI Guard (licence module AI_GUARD) - generative-AI discovery and control, phase 1.
//
// Discovery needs nothing new on the endpoint: the tray app already reports, per user and day,
// the program in the foreground and the active browser tab's domain (UserAppUsageDaily). Those
// are matched here against the AI tool catalogue (built-in + the admin's own tools).
//
// Blocking rides on two existing enforcers instead of a new one: blocked AI websites are added to
// the endpoint's website block list (webBlockScan.service), and blocked AI desktop programs to its
// application control block rules (appControlScan.service). So a pause, uninstall or emergency
// release removes AI Guard blocks exactly like every other block.

export type AiAction = "ALLOW" | "BLOCK";

export interface AiApp {
  key: string;
  name: string;
  vendor: string;
  category: AiAppCategory | string;
  risk: AiAppRisk;
  riskNote: string;
  domains: string[];
  executables: string[];
  installedNames: string[];
  custom: boolean;
}

export class AiGuardNotFoundError extends Error {}
export class AiGuardValidationError extends Error {}

// --- Catalogue --------------------------------------------------------------------------------

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function listAiApps(): Promise<AiApp[]> {
  const custom = await prisma.aiGuardCustomApp.findMany({ orderBy: { name: "asc" } });
  return [
    ...AI_APP_CATALOG.map((a) => ({ ...a, custom: false })),
    ...custom.map((c) => ({
      key: `custom:${c.id}`,
      name: c.name,
      vendor: "Added by your team",
      category: c.category,
      risk: c.risk as AiAppRisk,
      riskNote: "",
      domains: parseList(c.domains),
      executables: parseList(c.executables),
      installedNames: [],
      custom: true,
    })),
  ];
}

// Domains and program names an admin can add: plain host names / file names only.
function cleanDomains(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const d = normaliseAiDomain(v.replace(/^https?:\/\//i, "").split("/")[0] ?? "");
    if (!d) continue;
    if (!/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) throw new AiGuardValidationError(`"${v}" isn't a website domain (e.g. chat.example.com)`);
    out.add(d);
  }
  return [...out];
}

function cleanExecutables(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const name = v.trim().toLowerCase();
    if (!name) continue;
    if (!/^[^\\/:*?"<>|]{1,120}\.exe$/.test(name)) throw new AiGuardValidationError(`"${v}" isn't a program file name (e.g. assistant.exe)`);
    out.add(name);
  }
  return [...out];
}

export interface CustomAppInput {
  name: string;
  category: string;
  risk: AiAppRisk;
  domains: string[];
  executables: string[];
}

function customAppData(input: CustomAppInput) {
  const domains = cleanDomains(input.domains);
  const executables = cleanExecutables(input.executables);
  if (domains.length === 0 && executables.length === 0) throw new AiGuardValidationError("Add at least one website domain or program name");
  return { name: input.name.trim(), category: input.category, risk: input.risk, domains: JSON.stringify(domains), executables: JSON.stringify(executables) };
}

export async function createCustomApp(input: CustomAppInput, adminId: string) {
  return prisma.aiGuardCustomApp.create({ data: { ...customAppData(input), createdByAdminId: adminId } });
}

export async function updateCustomApp(id: string, input: CustomAppInput) {
  const existing = await prisma.aiGuardCustomApp.findUnique({ where: { id } });
  if (!existing) throw new AiGuardNotFoundError();
  return prisma.aiGuardCustomApp.update({ where: { id }, data: customAppData(input) });
}

export async function deleteCustomApp(id: string) {
  const existing = await prisma.aiGuardCustomApp.findUnique({ where: { id } });
  if (!existing) throw new AiGuardNotFoundError();
  await prisma.aiGuardCustomApp.delete({ where: { id } });
}

// --- Policies ---------------------------------------------------------------------------------

function parseActions(raw: string): Record<string, AiAction> {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(v).filter(([, a]) => a === "ALLOW" || a === "BLOCK")) as Record<string, AiAction>;
  } catch {
    return {};
  }
}

export interface PolicyInput {
  name: string;
  description?: string | null;
  enabled: boolean;
  defaultAction: AiAction;
  appActions: Record<string, AiAction>;
  // Phase 2 - prompt protection (aiGuardPrompt.service.ts). Left as they are when not given.
  promptProtection?: boolean;
  promptDataTypes?: string[];
  promptAction?: "WARN" | "BLOCK" | "REDACT";
}

async function policyData(input: PolicyInput) {
  const keys = new Set((await listAiApps()).map((a) => a.key));
  // AI tools, and AI add-ons ("addon:<kind>:<host>:<id>", see aiGuardAddons.service.ts).
  const isAddon = (k: string) => /^addon:(BROWSER_EXTENSION|IDE_EXTENSION|CLI_TOOL):[a-z]+:.{1,200}$/.test(k);
  const appActions = Object.fromEntries(Object.entries(input.appActions).filter(([k]) => keys.has(k) || isAddon(k)));
  return {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    enabled: input.enabled,
    defaultAction: input.defaultAction,
    appActions: JSON.stringify(appActions),
    ...(input.promptProtection !== undefined ? { promptProtection: input.promptProtection } : {}),
    ...(input.promptDataTypes !== undefined ? { promptDataTypes: JSON.stringify([...new Set(input.promptDataTypes)]) } : {}),
    ...(input.promptAction !== undefined ? { promptAction: input.promptAction } : {}),
  };
}

function policyView(p: Awaited<ReturnType<typeof loadPolicies>>[number]) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    enabled: p.enabled,
    defaultAction: p.defaultAction as AiAction,
    appActions: parseActions(p.appActions),
    promptProtection: p.promptProtection,
    promptDataTypes: parseList(p.promptDataTypes),
    promptAction: p.promptAction as "WARN" | "BLOCK" | "REDACT",
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    assignments: p.assignments.map((a) => ({
      id: a.id,
      agentId: a.agentId,
      groupId: a.groupId,
      name: a.agent?.hostname ?? a.group?.name ?? "(deleted)",
      kind: a.agentId ? ("ENDPOINT" as const) : ("GROUP" as const),
    })),
  };
}

function loadPolicies(where: { id?: string } = {}) {
  return prisma.aiGuardPolicy.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: { assignments: { include: { agent: { select: { hostname: true } }, group: { select: { name: true } } } } },
  });
}

export async function listPolicies() {
  return (await loadPolicies()).map(policyView);
}

export async function getPolicy(id: string) {
  const [p] = await loadPolicies({ id });
  if (!p) throw new AiGuardNotFoundError();
  return policyView(p);
}

export async function createPolicy(input: PolicyInput, adminId: string) {
  const created = await prisma.aiGuardPolicy.create({ data: { ...(await policyData(input)), createdByAdminId: adminId } });
  return getPolicy(created.id);
}

export async function updatePolicy(id: string, input: PolicyInput) {
  if (!(await prisma.aiGuardPolicy.findUnique({ where: { id } }))) throw new AiGuardNotFoundError();
  await prisma.aiGuardPolicy.update({ where: { id }, data: await policyData(input) });
  return getPolicy(id);
}

export async function deletePolicy(id: string) {
  if (!(await prisma.aiGuardPolicy.findUnique({ where: { id } }))) throw new AiGuardNotFoundError();
  await prisma.aiGuardPolicy.delete({ where: { id } });
}

// Replaces the policy's targets with exactly these endpoints and groups.
export async function setPolicyAssignments(id: string, agentIds: string[], groupIds: string[]) {
  if (!(await prisma.aiGuardPolicy.findUnique({ where: { id } }))) throw new AiGuardNotFoundError();
  const agents = await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true } });
  const groups = await prisma.assetGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true } });
  // One AI Guard policy per endpoint: the targets being added mustn't have another one.
  const current = await prisma.aiGuardPolicyAssignment.findMany({ where: { policyId: id }, select: { agentId: true, groupId: true } });
  await assertAssignable(
    "AI_GUARD",
    id,
    agents.map((a) => a.id).filter((a) => !current.some((c) => c.agentId === a)),
    groups.map((g) => g.id).filter((g) => !current.some((c) => c.groupId === g)),
  );
  await prisma.$transaction([
    prisma.aiGuardPolicyAssignment.deleteMany({ where: { policyId: id } }),
    prisma.aiGuardPolicyAssignment.createMany({
      data: [...agents.map((a) => ({ policyId: id, agentId: a.id })), ...groups.map((g) => ({ policyId: id, groupId: g.id }))],
    }),
  ]);
  return getPolicy(id);
}

// --- What an endpoint enforces ----------------------------------------------------------------

async function aiGuardActive(): Promise<boolean> {
  return !(await isModuleHidden("AI_GUARD")) && (await isModuleLicensed("AI_GUARD"));
}

function blockedKeysOf(policy: { defaultAction: string; appActions: string }, apps: AiApp[]): string[] {
  const actions = parseActions(policy.appActions);
  return apps.filter((a) => (actions[a.key] ?? policy.defaultAction) === "BLOCK").map((a) => a.key);
}

// The AI tools blocked on this endpoint: an AI tool is blocked when ANY enabled AI Guard policy
// assigned to it (directly or through a group) blocks it - by name, or by its default action.
// Nothing while the endpoint is paused or AI Guard isn't licensed / is hidden.
// The enabled AI Guard policies in force on this endpoint: assigned directly or through a group,
// not lifted by an approved access (pause) exception. None while paused or unlicensed/hidden.
export async function activeAiPoliciesForAgent(agentId: string) {
  if (!(await aiGuardActive())) return [];
  if (await isAgentPaused(agentId)) return [];
  const groupIds = (await effectiveMemberships(agentId)).map((m) => m.groupId);
  const assignments = await prisma.aiGuardPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const policyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (policyIds.length === 0) return [];
  const policies = await prisma.aiGuardPolicy.findMany({ where: { id: { in: policyIds }, enabled: true } });
  const excepted = await Promise.all(policies.map((p) => isPolicyExcepted("AI_GUARD", p.id, agentId)));
  return policies.filter((_, i) => !excepted[i]);
}

export async function blockedAiAppsForAgent(agentId: string): Promise<AiApp[]> {
  const policies = await activeAiPoliciesForAgent(agentId);
  if (policies.length === 0) return [];
  const apps = await listAiApps();
  const blocked = new Set(policies.flatMap((p) => blockedKeysOf(p, apps)));
  return apps.filter((a) => blocked.has(a.key));
}

// Website domains to add to this endpoint's website block list.
export async function aiGuardBlockedDomains(agentId: string): Promise<string[]> {
  return [...new Set((await blockedAiAppsForAgent(agentId)).flatMap((a) => a.domains.map(normaliseAiDomain)))];
}

// The same rule id on every sync, so an application control event can be traced back to the AI tool.
export function aiGuardRuleId(appKey: string, executable: string): string {
  const h = createHash("sha256").update(`aiguard:${appKey}:${executable.toLowerCase()}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Program-name block rules to add to this endpoint's application control rules.
export async function aiGuardAppControlRules(agentId: string): Promise<AppControlRuleWire[]> {
  return (await blockedAiAppsForAgent(agentId)).flatMap((a) =>
    a.executables.map((exe) => ({ ruleId: aiGuardRuleId(a.key, exe), ruleType: "EXECUTABLE" as const, value: exe })),
  );
}

// --- Discovery --------------------------------------------------------------------------------

// Same day boundary as UserAppUsageDaily.logDate (server-local midnight).
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function appForUsage(apps: AiApp[], kind: string, key: string): AiApp | undefined {
  if (kind === "WEB") return apps.find((a) => a.domains.some((d) => hostMatchesDomain(key, d)));
  const name = processNameOf(key);
  return apps.find((a) => a.executables.some((e) => processNameOf(e) === name));
}

// Installed-software matching reads every endpoint's software list: kept for a few minutes.
let installedCache: { at: number; byApp: Map<string, Set<string>> } | null = null;
const INSTALLED_CACHE_MS = 5 * 60 * 1000;

async function installedAiApps(apps: AiApp[]): Promise<Map<string, Set<string>>> {
  if (installedCache && Date.now() - installedCache.at < INSTALLED_CACHE_MS) return installedCache.byApp;
  const withNames = apps.filter((a) => a.installedNames.length > 0);
  const byApp = new Map<string, Set<string>>();
  const inventories = await prisma.inventorySnapshot.findMany({ select: { agentId: true, installedSoftware: true } });
  for (const inv of inventories) {
    let list: { name?: string }[] = [];
    try {
      list = JSON.parse(inv.installedSoftware);
    } catch {
      continue;
    }
    const names = list.map((s) => (s.name ?? "").toLowerCase()).filter(Boolean);
    for (const app of withNames) {
      if (names.some((n) => app.installedNames.some((m) => n === m || n.startsWith(`${m} `) || n.includes(` ${m}`) || n.startsWith(m)))) {
        if (!byApp.has(app.key)) byApp.set(app.key, new Set());
        byApp.get(app.key)!.add(inv.agentId);
      }
    }
  }
  installedCache = { at: Date.now(), byApp };
  return byApp;
}

export interface AiUsageResult {
  from: string;
  to: string;
  totals: { tools: number; users: number; endpoints: number; activeSeconds: number; blockedLaunches: number };
  apps: {
    key: string;
    name: string;
    vendor: string;
    category: string;
    risk: AiAppRisk;
    riskNote: string;
    custom: boolean;
    users: number;
    endpoints: number;
    activeSeconds: number;
    lastUsed: string | null;
    installedOn: number;
    blockedOn: number;
    blockedLaunches: number;
    topUsers: { username: string; hostname: string; activeSeconds: number; lastUsed: string }[];
  }[];
  users: { username: string; hostnames: string[]; activeSeconds: number; apps: { key: string; name: string; risk: AiAppRisk; activeSeconds: number }[] }[];
}

const MAX_DAYS = 90;

// AI use between `days` days ago and today (inclusive), optionally for one group's endpoints.
export async function getAiUsage(params: { days: number; groupId?: string }): Promise<AiUsageResult> {
  const days = Math.min(Math.max(Math.trunc(params.days) || 7, 1), MAX_DAYS);
  const to = startOfDay(new Date());
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));

  const apps = await listAiApps();
  const agentFilter = params.groupId
    ? (await membersOfGroups([params.groupId])).map((m) => m.agentId)
    : null;

  const webConditions = [...new Set(apps.flatMap((a) => a.domains.map(normaliseAiDomain)))].flatMap((d) => [
    { kind: "WEB", key: d },
    { kind: "WEB", key: `www.${d}` },
    { kind: "WEB", key: { endsWith: `.${d}` } },
  ]);
  const processNames = [...new Set(apps.flatMap((a) => a.executables.map(processNameOf)))];
  const rows = await prisma.userAppUsageDaily.findMany({
    where: {
      logDate: { gte: from, lte: to },
      ...(agentFilter ? { agentId: { in: agentFilter } } : {}),
      OR: [...webConditions, ...(processNames.length ? [{ kind: "APP", key: { in: processNames } }] : [])],
    },
    select: { agentId: true, username: true, logDate: true, kind: true, key: true, activeSeconds: true, agent: { select: { hostname: true } } },
  });

  type AppAgg = { users: Set<string>; endpoints: Set<string>; seconds: number; last: Date | null; byUser: Map<string, { username: string; hostname: string; seconds: number; last: Date }> };
  const byApp = new Map<string, AppAgg>();
  const byUser = new Map<string, { username: string; hostnames: Set<string>; seconds: number; apps: Map<string, number> }>();
  for (const r of rows) {
    const app = appForUsage(apps, r.kind, r.key);
    if (!app) continue;
    const agg = byApp.get(app.key) ?? { users: new Set(), endpoints: new Set(), seconds: 0, last: null, byUser: new Map() };
    agg.users.add(r.username.toLowerCase());
    agg.endpoints.add(r.agentId);
    agg.seconds += r.activeSeconds;
    if (!agg.last || r.logDate > agg.last) agg.last = r.logDate;
    const uk = `${r.username.toLowerCase()}|${r.agentId}`;
    const u = agg.byUser.get(uk) ?? { username: r.username, hostname: r.agent.hostname, seconds: 0, last: r.logDate };
    u.seconds += r.activeSeconds;
    if (r.logDate > u.last) u.last = r.logDate;
    agg.byUser.set(uk, u);
    byApp.set(app.key, agg);

    const user = byUser.get(r.username.toLowerCase()) ?? { username: r.username, hostnames: new Set<string>(), seconds: 0, apps: new Map<string, number>() };
    user.hostnames.add(r.agent.hostname);
    user.seconds += r.activeSeconds;
    user.apps.set(app.key, (user.apps.get(app.key) ?? 0) + r.activeSeconds);
    byUser.set(r.username.toLowerCase(), user);
  }

  // Where each tool is blocked now, and blocked launches of AI desktop programs in the range.
  const assignedAgentIds = await agentsWithAiPolicies(agentFilter);
  const blockedOn = new Map<string, number>();
  for (const agentId of assignedAgentIds) {
    for (const a of await blockedAiAppsForAgent(agentId)) blockedOn.set(a.key, (blockedOn.get(a.key) ?? 0) + 1);
  }
  const ruleToApp = new Map(apps.flatMap((a) => a.executables.map((e) => [aiGuardRuleId(a.key, e), a.key] as const)));
  const launches = ruleToApp.size
    ? await prisma.appControlEvent.findMany({
        where: {
          ruleId: { in: [...ruleToApp.keys()] },
          occurredAt: { gte: from },
          ...(agentFilter ? { agentId: { in: agentFilter } } : {}),
        },
        select: { ruleId: true },
      })
    : [];
  const launchesByApp = new Map<string, number>();
  for (const e of launches) {
    const key = e.ruleId ? ruleToApp.get(e.ruleId) : undefined;
    if (key) launchesByApp.set(key, (launchesByApp.get(key) ?? 0) + 1);
  }

  const installed = await installedAiApps(apps);
  const inScope = (ids: Set<string> | undefined) => (ids ? [...ids].filter((id) => !agentFilter || agentFilter.includes(id)).length : 0);

  const appRows = apps
    .map((a) => {
      const agg = byApp.get(a.key);
      return {
        key: a.key,
        name: a.name,
        vendor: a.vendor,
        category: a.category,
        risk: a.risk,
        riskNote: a.riskNote,
        custom: a.custom,
        users: agg?.users.size ?? 0,
        endpoints: agg?.endpoints.size ?? 0,
        activeSeconds: agg?.seconds ?? 0,
        lastUsed: agg?.last?.toISOString() ?? null,
        installedOn: inScope(installed.get(a.key)),
        blockedOn: blockedOn.get(a.key) ?? 0,
        blockedLaunches: launchesByApp.get(a.key) ?? 0,
        topUsers: agg
          ? [...agg.byUser.values()]
              .sort((x, y) => y.seconds - x.seconds)
              .slice(0, 50)
              .map((u) => ({ username: u.username, hostname: u.hostname, activeSeconds: u.seconds, lastUsed: u.last.toISOString() }))
          : [],
      };
    })
    .filter((a) => a.users > 0 || a.installedOn > 0 || a.blockedLaunches > 0)
    .sort((x, y) => y.activeSeconds - x.activeSeconds || y.installedOn - x.installedOn);

  const appByKey = new Map(apps.map((a) => [a.key, a]));
  const userRows = [...byUser.entries()]
    .map(([, u]) => {
      return {
        username: u.username,
        hostnames: [...u.hostnames].sort(),
        activeSeconds: u.seconds,
        apps: [...u.apps.entries()]
          .map(([key, seconds]) => ({ key, name: appByKey.get(key)?.name ?? key, risk: appByKey.get(key)?.risk ?? ("MEDIUM" as AiAppRisk), activeSeconds: seconds }))
          .sort((x, y) => y.activeSeconds - x.activeSeconds),
      };
    })
    .sort((x, y) => y.activeSeconds - x.activeSeconds);

  const allUsers = new Set(rows.filter((r) => appForUsage(apps, r.kind, r.key)).map((r) => r.username.toLowerCase()));
  const allEndpoints = new Set(rows.filter((r) => appForUsage(apps, r.kind, r.key)).map((r) => r.agentId));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      tools: appRows.filter((a) => a.users > 0).length,
      users: allUsers.size,
      endpoints: allEndpoints.size,
      activeSeconds: appRows.reduce((s, a) => s + a.activeSeconds, 0),
      blockedLaunches: launches.length,
    },
    apps: appRows,
    users: userRows,
  };
}

async function agentsWithAiPolicies(agentFilter: string[] | null): Promise<string[]> {
  const assignments = await prisma.aiGuardPolicyAssignment.findMany({
    where: { policy: { enabled: true } },
    select: { agentId: true, groupId: true },
  });
  const ids = new Set(assignments.map((a) => a.agentId).filter((x): x is string => !!x));
  const groupIds = assignments.map((a) => a.groupId).filter((x): x is string => !!x);
  if (groupIds.length) {
    for (const m of await membersOfGroups(groupIds)) ids.add(m.agentId);
  }
  return [...ids].filter((id) => !agentFilter || agentFilter.includes(id));
}

// --- Sync status --------------------------------------------------------------------------------
// AI Guard's website blocks travel in the endpoint's website-block sync, which reports back the
// policy ids it applied: AI Guard policies are carried there as "aiguard:<id>".
export const AI_GUARD_SYNC_PREFIX = "aiguard:";

export async function recordAiGuardSync(agentId: string, payload: { policyIds: string[]; status: string; errorMessage: string | null }) {
  const ids = payload.policyIds.filter((id) => id.startsWith(AI_GUARD_SYNC_PREFIX)).map((id) => id.slice(AI_GUARD_SYNC_PREFIX.length));
  if (ids.length === 0) return;
  const groupIds = (await effectiveMemberships(agentId)).map((m) => m.groupId);
  await prisma.aiGuardPolicyAssignment.updateMany({
    where: { policyId: { in: ids }, OR: [{ agentId }, ...(groupIds.length ? [{ groupId: { in: groupIds } }] : [])] },
    data: { lastSyncedAt: new Date(), lastSyncStatus: payload.status, lastSyncError: payload.errorMessage?.slice(0, 1000) ?? null },
  });
}

// One row per endpoint the policy reaches (directly or through a group), with that endpoint's
// last sync - a direct assignment's row wins over a group's.
export async function getPolicySyncStatus(policyId: string) {
  if (!(await prisma.aiGuardPolicy.findUnique({ where: { id: policyId } }))) throw new AiGuardNotFoundError();
  const assignments = await prisma.aiGuardPolicyAssignment.findMany({ where: { policyId }, include: { group: { select: { name: true } } } });
  const groupIds = assignments.map((a) => a.groupId).filter((x): x is string => !!x);
  const memberships = groupIds.length
    ? await membershipsUnderGroups(groupIds)
    : [];
  const agentIds = [...new Set([...assignments.map((a) => a.agentId).filter((x): x is string => !!x), ...memberships.map((m) => m.agentId)])];
  const agents = agentIds.length
    ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, hostname: true, inventory: { select: { lastLoggedOnUser: true } } } })
    : [];
  return agents
    .map((agent) => {
      const direct = assignments.find((a) => a.agentId === agent.id);
      const viaGroup = memberships.find((m) => m.agentId === agent.id);
      const row = direct ?? (viaGroup ? assignments.find((a) => a.groupId === viaGroup.groupId) : undefined);
      return {
        agentId: agent.id,
        hostname: agent.hostname,
        groupName: direct ? null : (row?.group?.name ?? null),
        lastLoggedOnUser: agent.inventory?.lastLoggedOnUser ?? null,
        lastSyncStatus: row?.lastSyncStatus ?? null,
        lastSyncError: row?.lastSyncError ?? null,
        lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
      };
    })
    .sort((a, b) => a.hostname.localeCompare(b.hostname));
}
