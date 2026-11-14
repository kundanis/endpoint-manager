import type {
  AssignThreatProtectionPolicyRequest,
  AssignedThreatProtectionWire,
  CreateThreatProtectionPolicyRequest,
  RequestThreatAction,
  RequestThreatScan,
  ThreatProtectionReport,
  ThreatProtectionSettingsWire,
  ThreatTaskResult,
  UpdateThreatProtectionPolicyRequest,
} from "@em/shared";
import { prisma } from "../db";
import { newAssignmentTargets } from "../utils/assignments";
import { resolveTargetAgentIds } from "./agentTargeting.service";
import { isModuleLicensed } from "./licenseActivation.service";
import { isModuleHidden } from "./moduleVisibility.service";
import { requestScan } from "./scanRequests";

// Threat Protection: Microsoft Defender managed from the console. Policies (Defender settings)
// assigned to endpoints or groups, each endpoint's reported protection status and threats, and
// scans / actions an admin sends to endpoints.

// Whether this deployment includes Threat Protection at all (its edition, licence and settings).
// When it doesn't, agents are told so and leave Defender exactly as it is.
export async function isThreatProtectionAvailable(): Promise<boolean> {
  if (await isModuleHidden("THREAT_PROTECTION")) return false;
  return isModuleLicensed("THREAT_PROTECTION");
}

type PolicyRow = NonNullable<Awaited<ReturnType<typeof prisma.threatProtectionPolicy.findUnique>>>;

const parseList = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

async function groupIdsForAgent(agentId: string): Promise<string[]> {
  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  return memberships.map((m) => m.groupId);
}

export async function resolveAssignedAgentIdsForPolicy(policyId: string): Promise<string[]> {
  const assignments = await prisma.threatProtectionPolicyAssignment.findMany({ where: { policyId } });
  return resolveTargetAgentIds(
    assignments.filter((a) => a.agentId).map((a) => a.agentId!),
    assignments.filter((a) => a.groupId).map((a) => a.groupId!),
  );
}

// Endpoints pick up a changed policy at their next check-in rather than the next sync cycle.
async function nudgePolicyAgents(policyId: string): Promise<void> {
  requestScan("threatProtection", await resolveAssignedAgentIdsForPolicy(policyId));
}

async function toView(p: PolicyRow) {
  const agentIds = await resolveAssignedAgentIdsForPolicy(p.id);
  const activeThreats = agentIds.length > 0 ? await prisma.threatDetection.count({ where: { agentId: { in: agentIds }, status: { in: ["ACTIVE", "FAILED"] } } }) : 0;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    enabled: p.enabled,
    realTimeProtection: p.realTimeProtection,
    cloudProtection: p.cloudProtection,
    submitSamples: p.submitSamples,
    puaProtection: p.puaProtection,
    scanType: p.scanType as "QUICK" | "FULL",
    scanScheduleDay: p.scanScheduleDay,
    scanScheduleTime: p.scanScheduleTime,
    signatureUpdateHours: p.signatureUpdateHours,
    excludedPaths: parseList(p.excludedPaths),
    excludedExtensions: parseList(p.excludedExtensions),
    excludedProcesses: parseList(p.excludedProcesses),
    assignedAgentCount: agentIds.length,
    activeThreats,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

const settingsData = (params: UpdateThreatProtectionPolicyRequest) => ({
  name: params.name,
  description: params.description,
  enabled: params.enabled,
  realTimeProtection: params.realTimeProtection,
  cloudProtection: params.cloudProtection,
  submitSamples: params.submitSamples,
  puaProtection: params.puaProtection,
  scanType: params.scanType,
  scanScheduleDay: params.scanScheduleDay,
  scanScheduleTime: params.scanScheduleTime,
  signatureUpdateHours: params.signatureUpdateHours,
  excludedPaths: params.excludedPaths ? JSON.stringify(params.excludedPaths) : undefined,
  excludedExtensions: params.excludedExtensions ? JSON.stringify(params.excludedExtensions.map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase())) : undefined,
  excludedProcesses: params.excludedProcesses ? JSON.stringify(params.excludedProcesses) : undefined,
});

export async function createPolicy(params: CreateThreatProtectionPolicyRequest, createdByAdminId: string) {
  const policy = await prisma.threatProtectionPolicy.create({
    data: { ...settingsData(params), name: params.name, description: params.description ?? null, createdByAdminId },
  });
  return getPolicy(policy.id);
}

export async function listPolicies() {
  const policies = await prisma.threatProtectionPolicy.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(policies.map(toView));
}

export async function getPolicy(id: string) {
  const policy = await prisma.threatProtectionPolicy.findUnique({ where: { id } });
  return policy ? toView(policy) : null;
}

export async function updatePolicy(id: string, params: UpdateThreatProtectionPolicyRequest) {
  await prisma.threatProtectionPolicy.update({ where: { id }, data: settingsData(params) });
  await nudgePolicyAgents(id);
  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  const agentIds = await resolveAssignedAgentIdsForPolicy(id);
  try {
    await prisma.threatProtectionPolicy.delete({ where: { id } });
  } catch {
    return false;
  }
  requestScan("threatProtection", agentIds);
  return true;
}

export async function assignPolicy(policyId: string, params: AssignThreatProtectionPolicyRequest) {
  const existing = await prisma.threatProtectionPolicyAssignment.findMany({ where: { policyId }, select: { agentId: true, groupId: true } });
  const fresh = newAssignmentTargets(existing, params.agentIds, params.groupIds);
  if (fresh.agentIds.length + fresh.groupIds.length > 0) {
    await prisma.threatProtectionPolicyAssignment.createMany({
      data: [...fresh.agentIds.map((agentId) => ({ policyId, agentId })), ...fresh.groupIds.map((groupId) => ({ policyId, groupId }))],
    });
  }
  await nudgePolicyAgents(policyId);
  return getPolicy(policyId);
}

export async function listAssignments(policyId: string) {
  const assignments = await prisma.threatProtectionPolicyAssignment.findMany({ where: { policyId }, include: { agent: true, group: true } });
  return assignments.map((a) => ({
    id: a.id,
    agentId: a.agentId,
    hostname: a.agent?.hostname ?? null,
    groupId: a.groupId,
    groupName: a.group?.name ?? null,
    lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
    lastSyncStatus: a.lastSyncStatus,
    lastSyncError: a.lastSyncError,
  }));
}

export async function unassign(policyId: string, assignmentId: string): Promise<boolean> {
  const before = await resolveAssignedAgentIdsForPolicy(policyId);
  const result = await prisma.threatProtectionPolicyAssignment.deleteMany({ where: { id: assignmentId, policyId } });
  if (result.count > 0) requestScan("threatProtection", before);
  return result.count > 0;
}

// Per endpoint of the policy: whether its settings applied, and what Windows refused.
export async function getPolicySyncStatus(policyId: string) {
  const policy = await prisma.threatProtectionPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;
  const agentIds = await resolveAssignedAgentIdsForPolicy(policyId);
  if (agentIds.length === 0) return { agents: [] };
  const [agents, assignments, memberships] = await Promise.all([
    prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, hostname: true, osPlatform: true } }),
    prisma.threatProtectionPolicyAssignment.findMany({ where: { policyId } }),
    prisma.agentGroupMembership.findMany({ where: { agentId: { in: agentIds } }, select: { agentId: true, groupId: true } }),
  ]);
  const assignmentFor = (agentId: string) =>
    assignments.find((a) => a.agentId === agentId) ??
    assignments.find((a) => a.groupId && memberships.some((m) => m.agentId === agentId && m.groupId === a.groupId)) ??
    null;
  return {
    agents: agents
      .map((a) => {
        const assignment = assignmentFor(a.id);
        return {
          agentId: a.id,
          hostname: a.hostname,
          windows: a.osPlatform === "win32",
          lastSyncedAt: assignment?.lastSyncedAt?.toISOString() ?? null,
          lastSyncStatus: assignment?.lastSyncStatus ?? null,
          lastSyncError: assignment?.lastSyncError ?? null,
        };
      })
      .sort((x, y) => x.hostname.localeCompare(y.hostname)),
  };
}

// ---- Overview: every endpoint's protection state

const SIGNATURES_OUT_OF_DATE_DAYS = 3;

export async function getOverview() {
  const [agents, statuses, activeCounts] = await Promise.all([
    prisma.agent.findMany({ select: { id: true, hostname: true, osPlatform: true, lastCheckinAt: true, agentVersion: true } }),
    prisma.endpointProtectionStatus.findMany(),
    prisma.threatDetection.groupBy({ by: ["agentId"], where: { status: { in: ["ACTIVE", "FAILED"] } }, _count: { _all: true } }),
  ]);
  const statusBy = new Map(statuses.map((s) => [s.agentId, s]));
  const activeBy = new Map(activeCounts.map((c) => [c.agentId, c._count._all]));
  const outOfDateBefore = Date.now() - SIGNATURES_OUT_OF_DATE_DAYS * 86_400_000;

  const endpoints = agents
    .map((a) => {
      const s = statusBy.get(a.id);
      const signaturesOutOfDate = !!s?.signatureUpdatedAt && s.signatureUpdatedAt.getTime() < outOfDateBefore;
      // One word per endpoint for the list and the counts: the most urgent thing about it.
      const state: "AT_RISK" | "UNPROTECTED" | "OUT_OF_DATE" | "PROTECTED" | "THIRD_PARTY" | "NOT_REPORTED" | "NOT_WINDOWS" =
        a.osPlatform !== "win32"
          ? "NOT_WINDOWS"
          : !s
            ? "NOT_REPORTED"
            : (activeBy.get(a.id) ?? 0) > 0
              ? "AT_RISK"
              : s.defenderMode === "PASSIVE" || s.defenderMode === "EDR_BLOCK"
                ? "THIRD_PARTY"
                : s.defenderMode !== "ACTIVE" || s.realTimeOn === false
                  ? "UNPROTECTED"
                  : signaturesOutOfDate
                    ? "OUT_OF_DATE"
                    : "PROTECTED";
      return {
        agentId: a.id,
        hostname: a.hostname,
        osPlatform: a.osPlatform,
        lastCheckinAt: a.lastCheckinAt?.toISOString() ?? null,
        state,
        activeThreats: activeBy.get(a.id) ?? 0,
        defenderMode: s?.defenderMode ?? null,
        antivirusProducts: s ? (JSON.parse(s.antivirusProducts) as { name: string; enabled: boolean | null; upToDate: boolean | null }[]) : [],
        realTimeOn: s?.realTimeOn ?? null,
        cloudProtectionOn: s?.cloudProtectionOn ?? null,
        puaProtectionOn: s?.puaProtectionOn ?? null,
        tamperProtected: s?.tamperProtected ?? null,
        externallyManaged: s?.externallyManaged ?? false,
        signatureVersion: s?.signatureVersion ?? null,
        signatureUpdatedAt: s?.signatureUpdatedAt?.toISOString() ?? null,
        signaturesOutOfDate,
        lastQuickScanAt: s?.lastQuickScanAt?.toISOString() ?? null,
        lastFullScanAt: s?.lastFullScanAt?.toISOString() ?? null,
        reportedAt: s?.reportedAt.toISOString() ?? null,
      };
    })
    .sort((x, y) => x.hostname.localeCompare(y.hostname));

  const count = (state: string) => endpoints.filter((e) => e.state === state).length;
  return {
    totals: {
      endpoints: endpoints.filter((e) => e.state !== "NOT_WINDOWS").length,
      protected: count("PROTECTED"),
      atRisk: count("AT_RISK"),
      unprotected: count("UNPROTECTED"),
      outOfDate: count("OUT_OF_DATE"),
      thirdParty: count("THIRD_PARTY"),
      notReported: count("NOT_REPORTED"),
      activeThreats: endpoints.reduce((n, e) => n + e.activeThreats, 0),
    },
    endpoints,
  };
}

// ---- Threats

const toDetectionView = (d: Awaited<ReturnType<typeof prisma.threatDetection.findFirst>> & {}, hostname: string) => ({
  id: d.id,
  agentId: d.agentId,
  hostname,
  source: d.source,
  threatName: d.threatName,
  severity: d.severity,
  category: d.category,
  filePath: d.filePath,
  resources: parseList(d.resources),
  username: d.username,
  processName: d.processName,
  status: d.status,
  actionDetail: d.actionDetail,
  detectedAt: d.detectedAt.toISOString(),
  lastSeenAt: d.lastSeenAt.toISOString(),
  resolvedAt: d.resolvedAt?.toISOString() ?? null,
  canRestoreOrAllow: d.source === "DEFENDER" && d.defenderThreatId != null,
});

export async function listDetections(filter: { status?: "open" | "all"; agentId?: string; days: number }) {
  const since = new Date(Date.now() - filter.days * 86_400_000);
  const rows = await prisma.threatDetection.findMany({
    where: {
      ...(filter.agentId ? { agentId: filter.agentId } : {}),
      ...(filter.status === "open" ? { status: { in: ["ACTIVE", "FAILED"] } } : { lastSeenAt: { gte: since } }),
    },
    include: { agent: { select: { hostname: true } } },
    orderBy: { lastSeenAt: "desc" },
    take: 1000,
  });
  return rows.map((d) => toDetectionView(d, d.agent.hostname));
}

// An admin marks a threat dealt with (e.g. Defender already removed it, or it was a test file).
export async function resolveDetection(id: string, adminId: string): Promise<boolean> {
  const result = await prisma.threatDetection.updateMany({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedByAdminId: adminId } });
  return result.count > 0;
}

// ---- Scans and actions

export async function requestScans(params: RequestThreatScan, adminId: string) {
  const agents = await prisma.agent.findMany({ where: { id: { in: params.agentIds }, osPlatform: "win32" }, select: { id: true } });
  if (agents.length === 0) return { created: 0 };
  await prisma.threatScanTask.createMany({
    data: agents.map((a) => ({ agentId: a.id, scanType: params.scanType, paths: JSON.stringify(params.scanType === "CUSTOM" ? params.paths : []), requestedByAdminId: adminId })),
  });
  requestScan("threatProtection", agents.map((a) => a.id));
  return { created: agents.length };
}

export class ThreatActionError extends Error {}

export async function requestActions(params: RequestThreatAction, adminId: string) {
  let targets: { agentId: string; detectionId: string | null }[];
  if (params.action === "UPDATE_SIGNATURES") {
    const agents = await prisma.agent.findMany({ where: { id: { in: params.agentIds }, osPlatform: "win32" }, select: { id: true } });
    targets = agents.map((a) => ({ agentId: a.id, detectionId: null }));
  } else {
    if (!params.detectionId) throw new ThreatActionError("Choose the threat to act on.");
    const detection = await prisma.threatDetection.findUnique({ where: { id: params.detectionId } });
    if (!detection) throw new ThreatActionError("That threat no longer exists.");
    if (detection.source !== "DEFENDER") throw new ThreatActionError("Only Microsoft Defender threats can be acted on from here.");
    if ((params.action === "RESTORE" || params.action === "ALLOW") && detection.defenderThreatId == null) {
      throw new ThreatActionError("Defender didn't report an ID for this threat, so it can't be restored or allowed.");
    }
    targets = [{ agentId: detection.agentId, detectionId: detection.id }];
  }
  if (targets.length === 0) return { created: 0 };
  await prisma.threatActionTask.createMany({
    data: targets.map((t) => ({ agentId: t.agentId, detectionId: t.detectionId, action: params.action, requestedByAdminId: adminId })),
  });
  requestScan("threatProtection", [...new Set(targets.map((t) => t.agentId))]);
  return { created: targets.length };
}

// Recent scans and actions (newest first), for the Activity tab.
export async function listTasks(days: number, agentId?: string) {
  // An endpoint that went offline mid-task never reports back: give up on it after a while
  // (full scans can take hours).
  const now = Date.now();
  await prisma.threatScanTask.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(now - 12 * 3_600_000) } },
    data: { status: "FAILED", finishedAt: new Date(), errorMessage: "No result from the endpoint within 12 hours." },
  });
  await prisma.threatActionTask.updateMany({
    where: { status: "SENT", requestedAt: { lt: new Date(now - 2 * 3_600_000) } },
    data: { status: "FAILED", finishedAt: new Date(), resultMessage: "No result from the endpoint within 2 hours." },
  });
  const since = new Date(now - days * 86_400_000);
  const where = { requestedAt: { gte: since }, ...(agentId ? { agentId } : {}) };
  const [scans, actions] = await Promise.all([
    prisma.threatScanTask.findMany({ where, include: { agent: { select: { hostname: true } } }, orderBy: { requestedAt: "desc" }, take: 500 }),
    prisma.threatActionTask.findMany({ where, include: { agent: { select: { hostname: true } } }, orderBy: { requestedAt: "desc" }, take: 500 }),
  ]);
  const detectionIds = actions.map((a) => a.detectionId).filter((id): id is string => !!id);
  const detections = detectionIds.length > 0 ? await prisma.threatDetection.findMany({ where: { id: { in: detectionIds } }, select: { id: true, threatName: true } }) : [];
  const threatName = new Map(detections.map((d) => [d.id, d.threatName]));
  return [
    ...scans.map((s) => ({
      id: s.id,
      kind: "SCAN" as const,
      agentId: s.agentId,
      hostname: s.agent.hostname,
      what: s.scanType,
      paths: parseList(s.paths),
      threatName: null as string | null,
      status: s.status,
      requestedAt: s.requestedAt.toISOString(),
      finishedAt: s.finishedAt?.toISOString() ?? null,
      message: s.errorMessage,
    })),
    ...actions.map((a) => ({
      id: a.id,
      kind: "ACTION" as const,
      agentId: a.agentId,
      hostname: a.agent.hostname,
      what: a.action,
      paths: [] as string[],
      threatName: a.detectionId ? (threatName.get(a.detectionId) ?? null) : null,
      status: a.status,
      requestedAt: a.requestedAt.toISOString(),
      finishedAt: a.finishedAt?.toISOString() ?? null,
      message: a.resultMessage,
    })),
  ].sort((x, y) => y.requestedAt.localeCompare(x.requestedAt));
}

// ---- Agent side

function mergeSettings(policies: PolicyRow[]): ThreatProtectionSettingsWire {
  const first = policies[0]; // earliest created: its schedule wins
  const union = (pick: (p: PolicyRow) => string) => [...new Set(policies.flatMap((p) => parseList(pick(p))))];
  return {
    realTimeProtection: policies.some((p) => p.realTimeProtection),
    cloudProtection: policies.some((p) => p.cloudProtection),
    submitSamples: policies.some((p) => p.submitSamples),
    puaProtection: policies.some((p) => p.puaProtection),
    scanType: policies.some((p) => p.scanType === "FULL") ? "FULL" : "QUICK",
    scanScheduleDay: first.scanScheduleDay,
    scanScheduleTime: first.scanScheduleTime,
    signatureUpdateHours: Math.min(...policies.map((p) => p.signatureUpdateHours)),
    excludedPaths: union((p) => p.excludedPaths),
    excludedExtensions: union((p) => p.excludedExtensions),
    excludedProcesses: union((p) => p.excludedProcesses),
  };
}

export async function resolveForAgent(agentId: string): Promise<AssignedThreatProtectionWire> {
  const none: AssignedThreatProtectionWire = { available: false, policyIds: [], settings: null, scanTasks: [], actionTasks: [] };
  if (!(await isThreatProtectionAvailable())) return none;

  const groupIds = await groupIdsForAgent(agentId);
  const assignments = await prisma.threatProtectionPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const ids = [...new Set(assignments.map((a) => a.policyId))];
  const policies = ids.length > 0 ? await prisma.threatProtectionPolicy.findMany({ where: { id: { in: ids }, enabled: true }, orderBy: { createdAt: "asc" } }) : [];

  // Waiting scans and actions go out once; the agent reports each one's result.
  const [scans, actions] = await Promise.all([
    prisma.threatScanTask.findMany({ where: { agentId, status: "PENDING" }, orderBy: { requestedAt: "asc" }, take: 5 }),
    prisma.threatActionTask.findMany({ where: { agentId, status: "PENDING" }, orderBy: { requestedAt: "asc" }, take: 20 }),
  ]);
  if (scans.length > 0) await prisma.threatScanTask.updateMany({ where: { id: { in: scans.map((s) => s.id) } }, data: { status: "RUNNING", startedAt: new Date() } });
  if (actions.length > 0) await prisma.threatActionTask.updateMany({ where: { id: { in: actions.map((a) => a.id) } }, data: { status: "SENT" } });
  const detectionIds = actions.map((a) => a.detectionId).filter((id): id is string => !!id);
  const detections = detectionIds.length > 0 ? await prisma.threatDetection.findMany({ where: { id: { in: detectionIds } } }) : [];
  const detectionBy = new Map(detections.map((d) => [d.id, d]));

  return {
    available: true,
    policyIds: policies.map((p) => p.id),
    settings: policies.length > 0 ? mergeSettings(policies) : null,
    scanTasks: scans.map((s) => ({ id: s.id, scanType: s.scanType as "QUICK" | "FULL" | "CUSTOM", paths: parseList(s.paths) })),
    actionTasks: actions.map((a) => {
      const d = a.detectionId ? detectionBy.get(a.detectionId) : undefined;
      return {
        id: a.id,
        action: a.action as "REMOVE" | "RESTORE" | "ALLOW" | "UPDATE_SIGNATURES",
        defenderThreatId: d?.defenderThreatId != null ? d.defenderThreatId.toString() : null,
        threatName: d?.threatName ?? null,
      };
    }),
  };
}

const dateOrNull = (v: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : d;
};

export async function recordReport(agentId: string, report: ThreatProtectionReport): Promise<void> {
  if (report.status) {
    const s = report.status;
    const data = {
      antivirusProducts: JSON.stringify(s.antivirusProducts),
      defenderMode: s.defenderMode,
      realTimeOn: s.realTimeOn,
      behaviorMonitorOn: s.behaviorMonitorOn,
      cloudProtectionOn: s.cloudProtectionOn,
      puaProtectionOn: s.puaProtectionOn,
      tamperProtected: s.tamperProtected,
      externallyManaged: s.externallyManaged,
      productVersion: s.productVersion,
      engineVersion: s.engineVersion,
      signatureVersion: s.signatureVersion,
      signatureUpdatedAt: dateOrNull(s.signatureUpdatedAt),
      lastQuickScanAt: dateOrNull(s.lastQuickScanAt),
      lastFullScanAt: dateOrNull(s.lastFullScanAt),
      activeThreats: report.detections.filter((d) => d.status === "ACTIVE" || d.status === "FAILED").length,
      reportedAt: new Date(),
    };
    await prisma.endpointProtectionStatus.upsert({ where: { agentId }, create: { agentId, ...data }, update: data });
  }

  for (const d of report.detections) {
    const detectedAt = dateOrNull(d.detectedAt) ?? new Date();
    const lastSeenAt = dateOrNull(d.lastSeenAt) ?? detectedAt;
    const fields = {
      threatName: d.threatName,
      defenderThreatId: d.defenderThreatId && /^\d+$/.test(d.defenderThreatId) ? BigInt(d.defenderThreatId) : null,
      severity: d.severity,
      category: d.category,
      filePath: d.filePath,
      resources: JSON.stringify(d.resources),
      username: d.username,
      processName: d.processName,
      actionDetail: d.actionDetail,
      lastSeenAt,
    };
    const existing = await prisma.threatDetection.findUnique({ where: { agentId_source_externalKey: { agentId, source: "DEFENDER", externalKey: d.externalKey } } });
    if (!existing) {
      await prisma.threatDetection.create({ data: { agentId, source: "DEFENDER", externalKey: d.externalKey, status: d.status, detectedAt, ...fields } });
      continue;
    }
    // An admin's "Mark resolved" stands until Defender reports the threat active again later.
    const keepResolved = existing.status === "RESOLVED" && existing.resolvedAt && !(d.status === "ACTIVE" && lastSeenAt > existing.resolvedAt);
    await prisma.threatDetection.update({
      where: { id: existing.id },
      data: { ...fields, ...(keepResolved ? {} : { status: d.status, ...(d.status === "ACTIVE" || d.status === "FAILED" ? { resolvedAt: null, resolvedByAdminId: null } : {}) }) },
    });
  }

  if (report.policyIds.length > 0 && report.syncStatus) {
    const groupIds = await groupIdsForAgent(agentId);
    await prisma.threatProtectionPolicyAssignment.updateMany({
      where: { policyId: { in: report.policyIds }, OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
      data: { lastSyncedAt: new Date(), lastSyncStatus: report.syncStatus, lastSyncError: report.syncError },
    });
  }
}

export async function recordTaskResult(agentId: string, result: ThreatTaskResult): Promise<boolean> {
  const finished = result.status !== "RUNNING" ? new Date() : null;
  if (result.kind === "SCAN") {
    const r = await prisma.threatScanTask.updateMany({
      where: { id: result.id, agentId },
      data: { status: result.status, errorMessage: result.message, ...(finished ? { finishedAt: finished } : {}) },
    });
    return r.count > 0;
  }
  const r = await prisma.threatActionTask.updateMany({
    where: { id: result.id, agentId },
    data: { status: result.status === "RUNNING" ? "SENT" : result.status, resultMessage: result.message, ...(finished ? { finishedAt: finished } : {}) },
  });
  return r.count > 0;
}
