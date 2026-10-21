import type {
  AssignDataDiscoveryPolicyRequest,
  CreateDataDiscoveryPolicyRequest,
  DataDiscoveryKeywordGroup,
  DataDiscoveryRegulation,
  DataTypeView,
  UpdateDataDiscoveryPolicyRequest,
} from "@em/shared";
import { getPiiPatternLabel, PII_PATTERN_CATALOG } from "@em/shared";
import { prisma } from "../db";
import { newAssignmentTargets } from "../utils/assignments";
import { resolveTargetAgentIds } from "./agentTargeting.service";
import { listDataTypes } from "./dataTypes.service";

export class DataDiscoveryPolicyError extends Error {}

// Data types a discovery scan can look for inside files: personal data patterns and keywords.
export function isDiscoverableDataType(d: Pick<DataTypeView, "kind">): boolean {
  return d.kind === "PII_PATTERN" || d.kind === "KEYWORD";
}

// What the agent looks for, from the policy's chosen data types. Ids of data types deleted since
// are skipped.
export function resolveDiscoveryDataTypes(ids: string[], all: DataTypeView[]) {
  const chosen = ids.map((id) => all.find((d) => d.id === id)).filter((d): d is DataTypeView => !!d && isDiscoverableDataType(d));
  const patternKeys = [...new Set(chosen.filter((d) => d.kind === "PII_PATTERN").flatMap((d) => d.values))];
  const keywordGroups: DataDiscoveryKeywordGroup[] = chosen
    .filter((d) => d.kind === "KEYWORD")
    .map((d) => ({ key: d.id, keywords: d.values }));
  return { chosen, patternKeys, keywordGroups };
}

// The closest regulation to a set of patterns - stored for agents older than 0.2.12, which
// only understand regulation.
function legacyRegulationFor(patternKeys: string[]): DataDiscoveryRegulation {
  const inAll = (reg: "DPDP" | "GDPR") =>
    patternKeys.length > 0 && patternKeys.every((k) => PII_PATTERN_CATALOG.find((p) => p.key === k)?.regulations.includes(reg));
  if (inAll("DPDP")) return "DPDP";
  if (inAll("GDPR")) return "GDPR";
  return "BOTH";
}

async function validatedDataTypeIds(ids: string[]): Promise<{ ids: string[]; regulation: DataDiscoveryRegulation }> {
  const unique = [...new Set(ids)];
  const all = await listDataTypes();
  for (const id of unique) {
    const d = all.find((x) => x.id === id);
    if (!d) throw new DataDiscoveryPolicyError("One of the selected data categories no longer exists.");
    if (!isDiscoverableDataType(d)) throw new DataDiscoveryPolicyError(`"${d.name}" can't be searched for inside files.`);
  }
  return { ids: unique, regulation: legacyRegulationFor(resolveDiscoveryDataTypes(unique, all).patternKeys) };
}

function toPolicyView(
  p: { id: string; name: string; description: string | null; regulation: string; dataTypeIds: string | null; targetPaths: string; enabled: boolean; createdAt: Date },
  all: DataTypeView[],
  assignedAgentCount: number,
  filesWithFindingsCount: number,
) {
  const dataTypeIds = p.dataTypeIds ? (JSON.parse(p.dataTypeIds) as string[]) : null;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    regulation: p.regulation as DataDiscoveryRegulation,
    dataTypeIds,
    dataTypeNames: dataTypeIds ? resolveDiscoveryDataTypes(dataTypeIds, all).chosen.map((d) => d.name) : null,
    targetPaths: JSON.parse(p.targetPaths) as string[],
    enabled: p.enabled,
    assignedAgentCount,
    filesWithFindingsCount,
    createdAt: p.createdAt.toISOString(),
  };
}

async function resolveAssignedAgentIdsForPolicy(policyId: string): Promise<string[]> {
  const assignments = await prisma.dataDiscoveryPolicyAssignment.findMany({ where: { policyId } });
  const agentIds = assignments.filter((a) => a.agentId).map((a) => a.agentId!);
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  return resolveTargetAgentIds(agentIds, groupIds);
}

export async function createPolicy(params: CreateDataDiscoveryPolicyRequest, createdByAdminId: string) {
  if (!params.dataTypeIds && !params.regulation) throw new DataDiscoveryPolicyError("Choose at least one data category.");
  const fromTypes = params.dataTypeIds ? await validatedDataTypeIds(params.dataTypeIds) : null;
  const policy = await prisma.dataDiscoveryPolicy.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      regulation: fromTypes?.regulation ?? params.regulation!,
      dataTypeIds: fromTypes ? JSON.stringify(fromTypes.ids) : null,
      targetPaths: JSON.stringify(params.targetPaths),
      enabled: params.enabled,
      createdByAdminId,
    },
  });
  return getPolicy(policy.id);
}

export async function listPolicies() {
  const policies = await prisma.dataDiscoveryPolicy.findMany({
    orderBy: { createdAt: "asc" },
    include: { findings: { select: { id: true } } },
  });

  const all = await listDataTypes();
  return Promise.all(
    policies.map(async (p) => {
      const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(p.id);
      return toPolicyView(p, all, assignedAgentIds.length, p.findings.length);
    }),
  );
}

export async function getPolicy(id: string) {
  const policy = await prisma.dataDiscoveryPolicy.findUnique({ where: { id }, include: { findings: { select: { id: true } } } });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(id);
  return toPolicyView(policy, await listDataTypes(), assignedAgentIds.length, policy.findings.length);
}

export async function updatePolicy(id: string, params: UpdateDataDiscoveryPolicyRequest) {
  const fromTypes = params.dataTypeIds ? await validatedDataTypeIds(params.dataTypeIds) : null;
  await prisma.dataDiscoveryPolicy.update({
    where: { id },
    data: {
      name: params.name,
      description: params.description,
      regulation: fromTypes?.regulation ?? params.regulation,
      dataTypeIds: fromTypes ? JSON.stringify(fromTypes.ids) : undefined,
      targetPaths: params.targetPaths ? JSON.stringify(params.targetPaths) : undefined,
      enabled: params.enabled,
    },
  });
  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  try {
    await prisma.dataDiscoveryPolicy.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function assignPolicy(policyId: string, params: AssignDataDiscoveryPolicyRequest) {
  // Only targets not already assigned - repeat assignments used to add duplicate rows.
  const existing = await prisma.dataDiscoveryPolicyAssignment.findMany({ where: { policyId }, select: { agentId: true, groupId: true } });
  const fresh = newAssignmentTargets(existing, params.agentIds, params.groupIds);
  if (fresh.agentIds.length + fresh.groupIds.length > 0) {
    await prisma.dataDiscoveryPolicyAssignment.createMany({
      data: [
        ...fresh.agentIds.map((agentId) => ({ policyId, agentId })),
        ...fresh.groupIds.map((groupId) => ({ policyId, groupId })),
      ],
    });
  }
  return getPolicy(policyId);
}

export async function listAssignments(policyId: string) {
  const assignments = await prisma.dataDiscoveryPolicyAssignment.findMany({
    where: { policyId },
    include: { agent: true, group: true },
  });
  return assignments.map((a) => ({
    id: a.id,
    agentId: a.agentId,
    hostname: a.agent?.hostname ?? null,
    groupId: a.groupId,
    groupName: a.group?.name ?? null,
  }));
}

export async function unassign(policyId: string, assignmentId: string): Promise<boolean> {
  const result = await prisma.dataDiscoveryPolicyAssignment.deleteMany({ where: { id: assignmentId, policyId } });
  return result.count > 0;
}

// Delivered to the agent via the next checkin response (same mechanism as
// CommandTask/PatchTask dispatch) rather than any new push channel — the agent
// already polls every ~30s, so this reaches it far sooner than the 12-hour interval
// scan would on its own. Scoped to one agentId when given, otherwise every agent
// currently assigned the policy.
export async function requestScanNow(policyId: string, agentId?: string) {
  const policy = await prisma.dataDiscoveryPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(policyId);
  const targetAgentIds = agentId ? assignedAgentIds.filter((id) => id === agentId) : assignedAgentIds;

  for (const id of targetAgentIds) {
    await prisma.dataDiscoveryScanState.upsert({
      where: { agentId_policyId: { agentId: id, policyId } },
      create: { agentId: id, policyId, scanRequested: true },
      update: { scanRequested: true },
    });
  }

  return { requestedCount: targetAgentIds.length };
}

export async function getPolicyAgentBreakdown(policyId: string) {
  const policy = await prisma.dataDiscoveryPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(policyId);
  const agents = assignedAgentIds.length > 0 ? await prisma.agent.findMany({ where: { id: { in: assignedAgentIds } } }) : [];
  const findings = await prisma.dataDiscoveryFinding.findMany({ where: { policyId } });
  const scanStates = await prisma.dataDiscoveryScanState.findMany({ where: { policyId } });

  const findingsByAgent = new Map<string, typeof findings>();
  for (const f of findings) {
    const list = findingsByAgent.get(f.agentId) ?? [];
    list.push(f);
    findingsByAgent.set(f.agentId, list);
  }
  const scanStateByAgent = new Map(scanStates.map((s) => [s.agentId, s]));

  return {
    policyId,
    name: policy.name,
    agents: agents.map((a) => {
      const agentFindings = findingsByAgent.get(a.id) ?? [];
      const scanState = scanStateByAgent.get(a.id);
      return {
        agentId: a.id,
        hostname: a.hostname,
        scanned: scanState?.lastScannedAt != null,
        scanPending: scanState?.scanRequested ?? false,
        fileCount: agentFindings.length,
        // How many files the last scan actually read — 0 means it found nothing to look
        // at (wrong/missing target folders), which is not the same thing as "clean".
        filesScanned: scanState?.filesScanned ?? null,
        lastScanAt: scanState?.lastScannedAt?.toISOString() ?? null,
      };
    }),
  };
}

export async function getFindingsForAgent(agentId: string) {
  const findings = await prisma.dataDiscoveryFinding.findMany({
    where: { agentId },
    include: { policy: true },
    orderBy: [{ lastSeenAt: "desc" }],
  });

  // Keyword matches are reported under their data type's id.
  const dataTypeNames = new Map((await listDataTypes()).map((d) => [d.id, d.name]));
  return findings.map((f) => {
    const matchedPatternKeys = JSON.parse(f.matchedPatternKeys) as string[];
    const matchCounts = JSON.parse(f.matchCounts) as Record<string, number>;
    const maskedSamples = JSON.parse(f.maskedSamples) as Record<string, string[]>;
    return {
      id: f.id,
      policyId: f.policyId,
      policyName: f.policy.name,
      filePath: f.filePath,
      fileSizeBytes: f.fileSizeBytes.toString(),
      fileModifiedAt: f.fileModifiedAt.toISOString(),
      matches: matchedPatternKeys.map((k) => ({
        label: dataTypeNames.get(k) ?? getPiiPatternLabel(k),
        count: matchCounts[k] ?? 0,
        samples: maskedSamples[k] ?? [],
      })),
      detectedAt: f.detectedAt.toISOString(),
      lastSeenAt: f.lastSeenAt.toISOString(),
    };
  });
}
