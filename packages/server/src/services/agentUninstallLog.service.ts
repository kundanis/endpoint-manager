import { prisma } from "../db";
import { effectiveLastCheckin } from "../presence/presence";
import { writeAudit } from "./adminAudit.service";

// Agent uninstalls in Admin logs: when one starts (from the console, the tray icon on the PC, or
// Windows' Apps list / Setup) and when the endpoint confirms the agent is gone. The endpoint's own
// record is deleted at that point (which frees its licence), so these entries are what's left to
// show it happened. They also drive the alert bell (agents uninstalled) and the "Uninstalling"
// badge an endpoint shows in between.

// Same action the console's own Uninstall writes (adminAudit's VERBS "uninstall-agent").
export const UNINSTALL_STARTED_ACTION = "UNINSTALL_AGENT";
export const UNINSTALLED_ACTION = "AGENT_UNINSTALLED";
const MODULE = "Endpoints";
const CATEGORY = "Endpoints";
// Who did it, when it was done on the PC rather than by an administrator.
const ENDPOINT_ACTOR = "Endpoint";

// An endpoint shows "Uninstalling" this long after an uninstall started, unless it checks in again
// well after the start (so the uninstall didn't happen) - the removal itself takes about a minute.
const UNINSTALLING_FOR_MS = 15 * 60_000;
const STILL_RUNNING_AFTER_MS = 5 * 60_000;

export type UninstallSource = "endpoint" | "uninstaller" | "console";

const FROM: Record<string, string> = {
  endpoint: "from the tray icon on the PC",
  uninstaller: "from Windows' Apps list (Setup)",
  console: "from the console",
  "files-deleted": "by deleting the agent's files",
};

function fromText(how: string | undefined): string {
  return (how && FROM[how]) ?? "";
}

async function hostnameOf(agentId: string): Promise<string> {
  const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { hostname: true } }).catch(() => null);
  return a?.hostname ?? "an endpoint";
}

// An uninstall started on the PC (tray icon or Setup), after the server accepted the password; or
// a wrong password there (ok false), which is worth seeing too.
export async function logUninstallFromEndpoint(agentId: string, how: Exclude<UninstallSource, "console">, opts: { ok: boolean; user?: string; ipAddress?: string | null }) {
  const host = await hostnameOf(agentId);
  const by = opts.user ? ` by ${opts.user}` : "";
  await writeAudit({
    adminEmail: ENDPOINT_ACTOR,
    ipAddress: opts.ipAddress ?? null,
    category: CATEGORY,
    action: UNINSTALL_STARTED_ACTION,
    module: MODULE,
    summary: opts.ok
      ? `Agent uninstall started on ${host} ${fromText(how)}${by}`
      : `Agent uninstall on ${host} refused ${fromText(how)}${by}: wrong uninstall password`,
    targetId: agentId,
    success: opts.ok,
    detail: { Endpoint: host, From: fromText(how).replace(/^from |^by /, ""), ...(opts.user ? { User: opts.user } : {}) },
  });
}

export interface UninstalledReport {
  how?: string;
  released?: string[];
  problems?: string[];
}

// The agent is gone: written just before its record is deleted. `confirmed` false: the endpoint
// never said so, but a console uninstall finished and it hasn't been seen since.
export async function logAgentUninstalled(agent: { id: string; hostname: string }, report: UninstalledReport | undefined, confirmed = true) {
  const from = fromText(report?.how);
  const problems = report?.problems ?? [];
  await writeAudit({
    adminEmail: ENDPOINT_ACTOR,
    category: CATEGORY,
    action: UNINSTALLED_ACTION,
    module: MODULE,
    summary:
      `Agent uninstalled from ${agent.hostname}${from ? ` ${from}` : ""}` +
      (confirmed ? "" : " (the endpoint stopped checking in after the uninstall)") +
      (problems.length ? ` - ${problems.length} ${problems.length === 1 ? "setting" : "settings"} couldn't be released` : "") +
      "; its licence is free again",
    targetId: agent.id,
    success: true,
    detail: {
      Endpoint: agent.hostname,
      ...(from ? { From: from.replace(/^from |^by /, "") } : {}),
      ...(report?.released?.length ? { Released: report.released } : {}),
      ...(problems.length ? { Problems: problems } : {}),
    },
  });
}

// Endpoints with an uninstall in progress: agent id -> when it started.
export async function uninstallingSince(agentIds?: string[]): Promise<Map<string, Date>> {
  const now = Date.now();
  const rows = await prisma.adminAuditLog.findMany({
    where: {
      action: UNINSTALL_STARTED_ACTION,
      success: true,
      at: { gte: new Date(now - UNINSTALLING_FOR_MS) },
      targetId: agentIds ? { in: agentIds } : { not: null },
    },
    select: { targetId: true, at: true },
    orderBy: { at: "desc" },
  });
  const out = new Map<string, Date>();
  const latest = new Map<string, Date>();
  for (const r of rows) if (r.targetId && !latest.has(r.targetId)) latest.set(r.targetId, r.at);
  if (latest.size === 0) return out;
  const agents = await prisma.agent.findMany({ where: { id: { in: [...latest.keys()] } }, select: { id: true, lastCheckinAt: true } });
  for (const a of agents) {
    const started = latest.get(a.id)!;
    const seen = effectiveLastCheckin(a.id, a.lastCheckinAt);
    if (seen && seen.getTime() > started.getTime() + STILL_RUNNING_AFTER_MS) continue;
    out.set(a.id, started);
  }
  return out;
}
