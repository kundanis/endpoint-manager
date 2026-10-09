import type { AssignedDataDiscoveryPolicyWire, DataDiscoveryRegulation, DataDiscoveryScanResultPayload } from "@em/shared";
import { prisma } from "../db";
import { isAgentPaused } from "./pause.service";

export async function resolveAssignedPoliciesForAgent(agentId: string): Promise<AssignedDataDiscoveryPolicyWire[]> {
  if (await isAgentPaused(agentId)) return [];

  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);

  const assignments = await prisma.dataDiscoveryPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const policyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (policyIds.length === 0) return [];

  // A paused policy (enabled: false) is skipped entirely, same semantics as Zero Trust.
  const policies = await prisma.dataDiscoveryPolicy.findMany({ where: { id: { in: policyIds }, enabled: true } });

  return policies.map((p) => ({
    policyId: p.id,
    targetPaths: JSON.parse(p.targetPaths) as string[],
    regulation: p.regulation as DataDiscoveryRegulation,
  }));
}

// Unlike Security Config/Zero Trust's grade-on-ingestion (a fixed rule set, upserted by
// rule/condition id every scan), this is an open-ended file-tree walk — the agent
// already decided which files match (matching happens agent-side against the shared
// PII pattern catalog, never sending raw file content to the server). A fresh scan
// replaces the finding set for this agent+policy: files no longer present in the
// payload (deleted/edited/moved so they no longer match) are deleted, not left stale.
export async function recordScanResult(agentId: string, payload: DataDiscoveryScanResultPayload): Promise<void> {
  const currentPaths = payload.findings.map((f) => f.filePath);

  await prisma.dataDiscoveryFinding.deleteMany({
    where: { agentId, policyId: payload.policyId, filePath: { notIn: currentPaths } },
  });

  for (const f of payload.findings) {
    await prisma.dataDiscoveryFinding.upsert({
      where: { agentId_policyId_filePath: { agentId, policyId: payload.policyId, filePath: f.filePath } },
      create: {
        agentId,
        policyId: payload.policyId,
        filePath: f.filePath,
        fileSizeBytes: BigInt(f.fileSizeBytes),
        fileModifiedAt: new Date(f.fileModifiedAt),
        matchedPatternKeys: JSON.stringify(f.matchedPatternKeys),
        matchCounts: JSON.stringify(f.matchCounts),
        maskedSamples: JSON.stringify(f.maskedSamples),
      },
      update: {
        fileSizeBytes: BigInt(f.fileSizeBytes),
        fileModifiedAt: new Date(f.fileModifiedAt),
        matchedPatternKeys: JSON.stringify(f.matchedPatternKeys),
        matchCounts: JSON.stringify(f.matchCounts),
        maskedSamples: JSON.stringify(f.maskedSamples),
        lastSeenAt: new Date(),
      },
    });
  }

  // scanRequested: false — whether this run was on the normal interval or triggered by
  // an admin's "Scan now" click, a result just came in, so any pending request is fulfilled.
  await prisma.dataDiscoveryScanState.upsert({
    where: { agentId_policyId: { agentId, policyId: payload.policyId } },
    create: { agentId, policyId: payload.policyId, filesScanned: payload.filesScanned, lastScannedAt: new Date(), scanRequested: false },
    update: { filesScanned: payload.filesScanned, lastScannedAt: new Date(), scanRequested: false },
  });
}
