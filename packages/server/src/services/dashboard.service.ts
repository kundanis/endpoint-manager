import { prisma } from "../db";
import { computeStatus, deriveDeviceType, extractOsEditionLabel } from "./agentDerived.util";
import { getFleetTrustSummary } from "./zeroTrustPolicy.service";
import { getNetworkDeviceSummary } from "./networkVlan.service";

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
    if (computeStatus(a.lastCheckinAt) === "ONLINE") onlineCount++;

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
  const [vulnAgentGroups, trustSummary, networkDeviceSummary] = await Promise.all([
    // Distinct agents with an open finding, counted in SQL (one row per agent) rather than
    // loading every open finding into Node - see getFleetVulnerabilitySummary's note.
    prisma.vulnerabilityFinding.groupBy({ by: ["agentId"], where: { status: "OPEN" }, _count: { _all: true } }),
    getFleetTrustSummary(),
    getNetworkDeviceSummary(),
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
  };
}
