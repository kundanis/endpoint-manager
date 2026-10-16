import { prisma } from "../db";
import { computeStatus, deriveDeviceType, extractOsEditionLabel } from "./agentDerived.util";
import { effectiveLastCheckin } from "../presence/presence";
import { getFleetTrustSummary } from "./zeroTrustPolicy.service";
import { getNetworkDeviceSummary } from "./networkVlan.service";
import { normalizeSeverity, type NormalizedSeverity } from "@em/shared";

// Missing patches across the fleet: how many endpoints need any, and how many distinct patches
// are missing per severity (Microsoft leaves many updates unrated - those count as UNKNOWN).
// Grouped in SQL, so it stays cheap on a large fleet.
async function getPatchSummary() {
  const [byAgent, byPatch] = await Promise.all([
    prisma.patchFinding.groupBy({ by: ["agentId"], where: { status: "MISSING" } }),
    prisma.patchFinding.groupBy({ by: ["patchDefinitionId"], where: { status: "MISSING" }, _count: { _all: true } }),
  ]);
  const definitions = byPatch.length
    ? await prisma.patchDefinition.findMany({ where: { id: { in: byPatch.map((p) => p.patchDefinitionId) } }, select: { id: true, severity: true } })
    : [];
  const missingBySeverity: Record<NormalizedSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const d of definitions) missingBySeverity[normalizeSeverity(d.severity)]++;
  return {
    endpointsMissingPatches: byAgent.length,
    missingPatches: definitions.length,
    missingBySeverity,
  };
}

// Security configuration (benchmark) posture: endpoints assessed / compliant (no failing
// rule) / not compliant, and the rules failing on the most endpoints.
async function getConfigurationSummary() {
  const [byAgentStatus, topRules] = await Promise.all([
    prisma.securityBenchmarkFinding.groupBy({ by: ["agentId", "status"], _count: { _all: true } }),
    prisma.securityBenchmarkFinding.groupBy({
      by: ["ruleId"],
      where: { status: "FAIL" },
      _count: { _all: true },
      orderBy: { _count: { ruleId: "desc" } },
      take: 5,
    }),
  ]);
  const assessed = new Set<string>();
  const failing = new Set<string>();
  let failedChecks = 0;
  for (const g of byAgentStatus) {
    assessed.add(g.agentId);
    if (g.status === "FAIL") {
      failing.add(g.agentId);
      failedChecks += g._count._all;
    }
  }
  const rules = topRules.length
    ? await prisma.securityBenchmarkRule.findMany({ where: { id: { in: topRules.map((r) => r.ruleId) } }, select: { id: true, title: true } })
    : [];
  const titleById = new Map(rules.map((r) => [r.id, r.title]));
  return {
    assessedEndpoints: assessed.size,
    compliantEndpoints: assessed.size - failing.size,
    nonCompliantEndpoints: failing.size,
    failedChecks,
    topFailingRules: topRules.map((r) => ({ title: titleById.get(r.ruleId) ?? "Unknown rule", endpoints: r._count._all })),
  };
}

export async function getDashboardSummary() {
  // One query drives status/device-type/OS-wise — all three are cheap derivations over
  // the same small selection, no need for three separate fleet scans.
  const agents = await prisma.agent.findMany({
    select: {
      id: true,
      lastCheckinAt: true,
      deviceTypeOverride: true,
      inventory: { select: { osInfo: true, pcSystemType: true } },
    },
  });

  const totalAgents = agents.length;
  let onlineCount = 0;
  const deviceTypeCounts = { LAPTOP: 0, DESKTOP: 0, SERVER: 0 };
  const osCounts = new Map<string, number>();

  for (const a of agents) {
    if (computeStatus(effectiveLastCheckin(a.id, a.lastCheckinAt)) === "ONLINE") onlineCount++;

    // `|| ` (not `??`) deliberately also catches a genuinely empty distro string —
    // seen on this real fleet from an agent enrolled before osInfo.distro was reliably
    // populated — which would otherwise render as a blank, unreadable legend entry.
    const osLabel = extractOsEditionLabel(a.inventory?.osInfo) || "Unknown";
    osCounts.set(osLabel, (osCounts.get(osLabel) ?? 0) + 1);

    const deviceType = a.deviceTypeOverride ?? deriveDeviceType(a.inventory?.pcSystemType ?? null, osLabel);
    deviceTypeCounts[deviceType as keyof typeof deviceTypeCounts]++;
  }

  // Same query shape already used in admin.routes.ts's agent list route for
  // openVulnerabilityCount — reused here just to build a distinct-agent count instead of
  // a per-agent count.
  const [vulnAgentGroups, trustSummary, networkDeviceSummary, patchSummary, configurationSummary] = await Promise.all([
    // Distinct agents with an open finding, counted in SQL (one row per agent) rather than
    // loading every open finding into Node - see getFleetVulnerabilitySummary's note.
    prisma.vulnerabilityFinding.groupBy({ by: ["agentId"], where: { status: "OPEN" }, _count: { _all: true } }),
    getFleetTrustSummary(),
    getNetworkDeviceSummary(),
    getPatchSummary(),
    getConfigurationSummary(),
  ]);
  const agentsWithVulnerabilities = vulnAgentGroups.length;

  // Fleet-wide comparison of "agents installed" vs "endpoints seen by a network scan" —
  // discoveredByNetworkScan/notInstalled are just sums over each VLAN's latest-scan totals
  // already computed above; a VLAN with no scan yet contributes 0, not an unknown.
  const scannedVlans = networkDeviceSummary.perVlan.filter((v) => v.hasScan);
  const agentCoverage = {
    agentsInstalled: totalAgents,
    discoveredByNetworkScan: scannedVlans.reduce((sum, v) => sum + v.total, 0),
    notInstalled: scannedVlans.reduce((sum, v) => sum + v.unmanaged, 0),
  };

  return {
    totalAgents,
    onlineCount,
    offlineCount: totalAgents - onlineCount,
    deviceTypeCounts,
    osCounts: [...osCounts.entries()].map(([label, count]) => ({ label, count })),
    vulnerabilitySummary: {
      withVulnerabilities: agentsWithVulnerabilities,
      clean: totalAgents - agentsWithVulnerabilities,
    },
    trustSummary,
    networkDeviceSummary: networkDeviceSummary.perVlan,
    unmanagedHosts: networkDeviceSummary.unmanagedHosts,
    agentCoverage,
    patchSummary,
    configurationSummary,
  };
}
