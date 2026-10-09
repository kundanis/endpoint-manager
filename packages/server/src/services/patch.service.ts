import type { PatchInstallResultPayload, PatchScanResultPayload } from "@em/shared";
import { normalizeSeverity } from "@em/shared";
import { prisma } from "../db";

export interface LatestMissingPatchView {
  title: string;
  severity: string | null;
  normalizedSeverity: ReturnType<typeof normalizeSeverity>;
  kbArticleIds: string[];
  firstSeenAt: string;
}

export class PatchTaskNotOwnedError extends Error {}

export async function recordPatchScan(agentId: string, payload: PatchScanResultPayload): Promise<void> {
  const seenDefinitionIds: string[] = [];

  for (const update of payload.updates) {
    const definition = await prisma.patchDefinition.upsert({
      where: { updateId: update.updateId },
      create: {
        updateId: update.updateId,
        revisionNumber: update.revisionNumber,
        title: update.title,
        severity: update.severity,
        kbArticleIds: JSON.stringify(update.kbArticleIds),
        categories: JSON.stringify(update.categories),
        sizeBytes: update.sizeBytes ? BigInt(update.sizeBytes) : null,
      },
      update: {
        revisionNumber: update.revisionNumber,
        title: update.title,
        severity: update.severity,
        kbArticleIds: JSON.stringify(update.kbArticleIds),
        categories: JSON.stringify(update.categories),
        sizeBytes: update.sizeBytes ? BigInt(update.sizeBytes) : null,
        lastSeenAt: new Date(),
      },
    });

    seenDefinitionIds.push(definition.id);

    await prisma.patchFinding.upsert({
      where: { agentId_patchDefinitionId: { agentId, patchDefinitionId: definition.id } },
      create: { agentId, patchDefinitionId: definition.id, status: "MISSING" },
      update: { status: "MISSING", lastSeenAt: new Date() },
    });
  }

  // Anything previously MISSING for this agent that didn't show up in this scan is resolved —
  // symmetric with how a fresh InventorySnapshot fully replaces the prior one.
  await prisma.patchFinding.updateMany({
    where: {
      agentId,
      status: "MISSING",
      patchDefinitionId: { notIn: seenDefinitionIds },
    },
    data: { status: "INSTALLED", installedAt: new Date() },
  });
}

// groupId scopes "missing across the fleet" down to one asset group (e.g. "Production" vs
// "Test") - the environment-filtering this RFP clause actually asks for reuses the asset
// groups that already exist rather than inventing a parallel "environment" concept.
export async function getFleetPatchSummary(groupId?: string) {
  const agentIdFilter = groupId
    ? (await prisma.agentGroupMembership.findMany({ where: { groupId }, select: { agentId: true } })).map(
        (m) => m.agentId,
      )
    : undefined;

  const grouped = await prisma.patchFinding.groupBy({
    by: ["patchDefinitionId"],
    where: { status: "MISSING", ...(agentIdFilter ? { agentId: { in: agentIdFilter } } : {}) },
    _count: true,
  });

  if (grouped.length === 0) return [];

  const definitions = await prisma.patchDefinition.findMany({
    where: { id: { in: grouped.map((g) => g.patchDefinitionId) } },
  });
  const definitionById = new Map(definitions.map((d) => [d.id, d]));

  return grouped
    .map((g) => {
      const def = definitionById.get(g.patchDefinitionId);
      if (!def) return null;
      return {
        patchDefinitionId: def.id,
        updateId: def.updateId,
        title: def.title,
        severity: def.severity,
        normalizedSeverity: normalizeSeverity(def.severity),
        kbArticleIds: JSON.parse(def.kbArticleIds) as string[],
        categories: JSON.parse(def.categories) as string[],
        sizeBytes: def.sizeBytes?.toString() ?? null,
        missingAgentCount: g._count,
        // When this update was first seen missing anywhere in the fleet - the closest
        // available proxy for a vendor "release date", since no update-catalog sync
        // stores Microsoft's actual publish date anywhere in this schema.
        firstSeenAt: def.firstSeenAt.toISOString(),
        lastSeenAt: def.lastSeenAt.toISOString(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime());
}

interface CreatePatchJobParams {
  updateIds: string[];
  agentIds: string[]; // already resolved (groups expanded, deduped) by the caller
  groupIds: string[]; // kept for display/audit only — task fan-out uses agentIds
  createdByAdminId: string;
  // Null/undefined/past = dispatch immediately (today's only behavior, tasks created
  // PENDING). A future timestamp creates tasks as SCHEDULED instead - see
  // promoteScheduledPatchTasks, which is the only thing that ever moves them to PENDING.
  scheduledAt?: Date | null;
}

export async function createPatchJob(params: CreatePatchJobParams): Promise<{ jobId: string }> {
  const isFutureSchedule = !!params.scheduledAt && params.scheduledAt.getTime() > Date.now();
  const job = await prisma.patchJob.create({
    data: {
      updateIds: JSON.stringify(params.updateIds),
      createdByAdminId: params.createdByAdminId,
      targetGroupIds: JSON.stringify(params.groupIds),
      scheduledAt: isFutureSchedule ? params.scheduledAt : null,
      tasks: {
        create: params.agentIds.map((agentId) => ({ agentId, status: isFutureSchedule ? "SCHEDULED" : "PENDING" })),
      },
    },
  });
  return { jobId: job.id };
}

// Called from a periodic sweep (see index.ts) - checkin.service.ts's task-fetch only ever
// looks at status="PENDING", so this is the sole place a SCHEDULED task ever becomes
// deliverable. Deliberately a plain time check, not a precise-to-the-second cron: a patch
// job's scheduled time slipping by a few minutes against the sweep interval is harmless.
export async function promoteScheduledPatchTasks(): Promise<number> {
  const dueJobs = await prisma.patchJob.findMany({
    where: { scheduledAt: { lte: new Date() }, tasks: { some: { status: "SCHEDULED" } } },
    select: { id: true },
  });
  if (dueJobs.length === 0) return 0;

  const result = await prisma.patchTask.updateMany({
    where: { jobId: { in: dueJobs.map((j) => j.id) }, status: "SCHEDULED" },
    data: { status: "PENDING" },
  });
  return result.count;
}

async function resolveGroupNames(groupIdsJson: string): Promise<string[]> {
  const groupIds = JSON.parse(groupIdsJson) as string[];
  if (groupIds.length === 0) return [];
  const groups = await prisma.assetGroup.findMany({ where: { id: { in: groupIds } } });
  const byId = new Map(groups.map((g) => [g.id, g.name]));
  return groupIds.map((id) => byId.get(id) ?? "(deleted group)");
}

export async function listPatchJobs() {
  const jobs = await prisma.patchJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { tasks: true },
  });

  return Promise.all(
    jobs.map(async (job) => ({
      id: job.id,
      updateIds: JSON.parse(job.updateIds) as string[],
      targetGroupNames: await resolveGroupNames(job.targetGroupIds),
      createdAt: job.createdAt.toISOString(),
      scheduledAt: job.scheduledAt?.toISOString() ?? null,
      taskCounts: job.tasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {}),
    })),
  );
}

export async function getPatchJob(jobId: string) {
  const job = await prisma.patchJob.findUnique({
    where: { id: jobId },
    include: { tasks: { include: { agent: true } } },
  });
  if (!job) return null;

  return {
    id: job.id,
    updateIds: JSON.parse(job.updateIds) as string[],
    targetGroupNames: await resolveGroupNames(job.targetGroupIds),
    createdAt: job.createdAt.toISOString(),
    scheduledAt: job.scheduledAt?.toISOString() ?? null,
    tasks: job.tasks.map((t) => ({
      id: t.id,
      agentId: t.agentId,
      hostname: t.agent.hostname,
      status: t.status,
      rebootRequired: t.rebootRequired,
      results: t.results ? (JSON.parse(t.results) as unknown[]) : [],
      message: t.message,
      dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
  };
}

// WUA OperationResultCode: 2=Succeeded, 3=SucceededWithErrors — both count as "installed" for
// compliance purposes even though 3 is worth surfacing to an admin via the stored per-update results.
const WUA_SUCCESS_CODES = [2, 3];

export async function recordPatchTaskResult(
  taskId: string,
  agentId: string,
  payload: PatchInstallResultPayload,
): Promise<void> {
  const task = await prisma.patchTask.findUnique({ where: { id: taskId } });
  if (!task || task.agentId !== agentId) {
    throw new PatchTaskNotOwnedError("Patch task not found for this agent");
  }

  await prisma.patchTask.update({
    where: { id: taskId },
    data: {
      status: payload.status,
      rebootRequired: payload.rebootRequired,
      results: JSON.stringify(payload.results),
      message: payload.message ?? undefined,
      completedAt: new Date(payload.completedAt),
    },
  });

  // Responsiveness nicety — reflect successful installs immediately rather than waiting
  // for the next multi-hour scan cycle to notice they're no longer missing.
  const successfulUpdateIds = payload.results
    .filter((r) => WUA_SUCCESS_CODES.includes(r.resultCode))
    .map((r) => r.updateId);

  if (successfulUpdateIds.length > 0) {
    const definitions = await prisma.patchDefinition.findMany({
      where: { updateId: { in: successfulUpdateIds } },
    });
    await prisma.patchFinding.updateMany({
      where: { agentId, patchDefinitionId: { in: definitions.map((d) => d.id) } },
      data: { status: "INSTALLED", installedAt: new Date() },
    });
  }
}

// One grouped query for every agent at once (same "compute fleet-wide in one pass, not
// N+1 per-agent queries" convention already used for zeroTrustNonCompliantCount/
// openVulnerabilityCount in the agents list route) - pass agentId to scope it to just one
// agent instead for the single-agent detail route. No denormalized field on Agent itself;
// PatchFinding.installedAt (set whenever a scan stops seeing an update as missing, or a
// direct install task succeeds) is already the real source of truth per (agent, patch).
export async function getLastPatchInstalledAtByAgent(agentId?: string): Promise<Map<string, Date>> {
  const rows = await prisma.patchFinding.groupBy({
    by: ["agentId"],
    where: { installedAt: { not: null }, ...(agentId ? { agentId } : {}) },
    _max: { installedAt: true },
  });
  return new Map(rows.filter((r) => r._max.installedAt).map((r) => [r.agentId, r._max.installedAt as Date]));
}

// Single-agent only (detail view) - the most recently-surfaced update this agent is still
// missing, ranked by PatchDefinition.firstSeenAt (see the comment on getFleetPatchSummary
// re: that being a "first detected", not a true vendor release date).
export async function getLatestMissingPatchByAgent(agentId: string): Promise<LatestMissingPatchView | null> {
  const finding = await prisma.patchFinding.findFirst({
    where: { agentId, status: "MISSING" },
    include: { patchDefinition: true },
    orderBy: { patchDefinition: { firstSeenAt: "desc" } },
  });
  if (!finding) return null;

  const def = finding.patchDefinition;
  return {
    title: def.title,
    severity: def.severity,
    normalizedSeverity: normalizeSeverity(def.severity),
    kbArticleIds: JSON.parse(def.kbArticleIds) as string[],
    firstSeenAt: def.firstSeenAt.toISOString(),
  };
}
