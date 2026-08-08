import type { PatchInstallResultPayload, PatchScanResultPayload } from "@em/shared";
import { prisma } from "../db";

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

export async function getFleetPatchSummary() {
  const grouped = await prisma.patchFinding.groupBy({
    by: ["patchDefinitionId"],
    where: { status: "MISSING" },
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
        kbArticleIds: JSON.parse(def.kbArticleIds) as string[],
        categories: JSON.parse(def.categories) as string[],
        sizeBytes: def.sizeBytes?.toString() ?? null,
        missingAgentCount: g._count,
        lastSeenAt: def.lastSeenAt.toISOString(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.missingAgentCount - a.missingAgentCount);
}

interface CreatePatchJobParams {
  updateIds: string[];
  agentIds: string[]; // already resolved (groups expanded, deduped) by the caller
  groupIds: string[]; // kept for display/audit only — task fan-out uses agentIds
  createdByAdminId: string;
}

export async function createPatchJob(params: CreatePatchJobParams): Promise<{ jobId: string }> {
  const job = await prisma.patchJob.create({
    data: {
      updateIds: JSON.stringify(params.updateIds),
      createdByAdminId: params.createdByAdminId,
      targetGroupIds: JSON.stringify(params.groupIds),
      tasks: {
        create: params.agentIds.map((agentId) => ({ agentId })),
      },
    },
  });
  return { jobId: job.id };
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
