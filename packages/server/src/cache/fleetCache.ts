import { prisma } from "../db";
import { logger } from "../logger";
import { getDashboardSummary } from "../services/dashboard.service";
import { getLatestAgentUpdateTaskByAgent } from "../services/agentUpdate.service";
import { getLastPatchInstalledAtByAgent } from "../services/patch.service";
import { excludeOverriddenFailures, getOverriddenKeysByAgent } from "../services/zeroTrustOverride.service";

// In-process cache of the fleet-wide aggregates that the Dashboard and the Endpoints list
// recompute on every poll from every open console tab: the dashboard summary, and the
// per-agent rollups (open-vulnerability count, Zero-Trust non-compliant count, last patch
// installed, latest agent-update task). These change slowly, so we recompute them once on a
// short timer and serve the cached copy to every request - turning (open tabs x poll rate)
// fleet-wide scans into one computation per REFRESH_MS.
//
// SCALING SEAM: this cache lives in this one server process. If the server is ever run as
// multiple instances behind a load balancer, move the stored values behind a shared store
// (Redis) so every instance serves the same data and a write on one instance is seen by all.
// Only getDashboardSummaryCached / getAgentRollupsCached and the refresh() body would change;
// the call sites stay the same.

type LastPatchMap = Awaited<ReturnType<typeof getLastPatchInstalledAtByAgent>>;
type LatestUpdateMap = Awaited<ReturnType<typeof getLatestAgentUpdateTaskByAgent>>;
type DashboardSummary = Awaited<ReturnType<typeof getDashboardSummary>>;

export interface AgentRollups {
  vulnCountByAgent: Map<string, number>;
  ztCountByAgent: Map<string, number>;
  lastPatchByAgent: LastPatchMap;
  latestUpdateTaskByAgent: LatestUpdateMap;
}

const REFRESH_MS = 10_000;

let dashboardSummary: DashboardSummary | null = null;
let agentRollups: AgentRollups | null = null;
let refreshing = false; // re-entrancy guard: never run two refreshes at once

async function computeRollups(): Promise<AgentRollups> {
  // Computed for the whole fleet (not a request's specific id list) so the cache is shared by
  // every endpoints-list request. An agent enrolled since the last refresh simply gets default
  // zeros until the next cycle.
  const agents = await prisma.agent.findMany({ select: { id: true } });
  const ids = agents.map((a) => a.id);

  const [openVulnGroups, nonCompliantZtRaw, lastPatchByAgent, latestUpdateTaskByAgent] = await Promise.all([
    prisma.vulnerabilityFinding.groupBy({ by: ["agentId"], where: { status: "OPEN" }, _count: { _all: true } }),
    prisma.zeroTrustFinding.findMany({
      where: { status: "FAIL", condition: { enabled: true } },
      select: { agentId: true, status: true, condition: { select: { conditionKey: true } } },
    }),
    getLastPatchInstalledAtByAgent(),
    getLatestAgentUpdateTaskByAgent(ids),
  ]);

  const overriddenByAgent = await getOverriddenKeysByAgent([...new Set(nonCompliantZtRaw.map((f) => f.agentId))]);
  const nonCompliantZt = excludeOverriddenFailures(
    nonCompliantZtRaw.map((f) => ({ agentId: f.agentId, status: f.status, conditionKey: f.condition.conditionKey })),
    overriddenByAgent,
  );

  const vulnCountByAgent = new Map<string, number>();
  for (const g of openVulnGroups) vulnCountByAgent.set(g.agentId, g._count._all);
  const ztCountByAgent = new Map<string, number>();
  for (const f of nonCompliantZt) ztCountByAgent.set(f.agentId, (ztCountByAgent.get(f.agentId) ?? 0) + 1);

  return { vulnCountByAgent, ztCountByAgent, lastPatchByAgent, latestUpdateTaskByAgent };
}

// Recomputes both cached values. On any DB error it logs and KEEPS the previous good values
// (never clears them), so a transient blip can't turn into an empty dashboard.
async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const [summary, rollups] = await Promise.all([getDashboardSummary(), computeRollups()]);
    dashboardSummary = summary;
    agentRollups = rollups;
  } catch (err) {
    logger.error({ err }, "Fleet cache refresh failed - serving last good values");
  } finally {
    refreshing = false;
  }
}

// Self-rescheduling (not setInterval): the next refresh is armed only after the current one
// finishes, so a slow DB can never stack overlapping refreshes.
function scheduleNext(): void {
  const t = setTimeout(() => {
    void refresh().finally(scheduleNext);
  }, REFRESH_MS);
  t.unref();
}

export function startFleetCache(): void {
  void refresh().finally(scheduleNext);
}

export async function getDashboardSummaryCached(): Promise<DashboardSummary> {
  if (!dashboardSummary) await refresh();
  // Fall back to a live compute only if the very first refresh also failed.
  return dashboardSummary ?? (await getDashboardSummary());
}

export async function getAgentRollupsCached(): Promise<AgentRollups> {
  if (!agentRollups) await refresh();
  return agentRollups ?? computeRollups();
}
