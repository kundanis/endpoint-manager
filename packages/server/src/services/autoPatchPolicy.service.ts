import type { CreateAutoPatchPolicyRequest, NormalizedSeverity, UpdateAutoPatchPolicyRequest } from "@em/shared";
import { meetsSeverityThreshold } from "@em/shared";
import { prisma } from "../db";
import { createPatchJob } from "./patch.service";
import { resolveTargetAgentIds } from "./agentTargeting.service";

export class AutoPatchPolicyNotFoundError extends Error {}

async function resolveGroupNames(groupIdsJson: string): Promise<string[]> {
  const groupIds = JSON.parse(groupIdsJson) as string[];
  if (groupIds.length === 0) return [];
  const groups = await prisma.assetGroup.findMany({ where: { id: { in: groupIds } } });
  const byId = new Map(groups.map((g) => [g.id, g.name]));
  return groupIds.map((id) => byId.get(id) ?? "(deleted group)");
}

function serializePolicy(p: {
  id: string;
  enabled: boolean;
  minSeverity: string;
  targetGroupIds: string;
  createdByAdminId: string;
  createdAt: Date;
  lastRunAt: Date | null;
}) {
  return {
    id: p.id,
    enabled: p.enabled,
    minSeverity: p.minSeverity as NormalizedSeverity,
    groupIds: JSON.parse(p.targetGroupIds) as string[],
    createdByAdminId: p.createdByAdminId,
    createdAt: p.createdAt.toISOString(),
    lastRunAt: p.lastRunAt?.toISOString() ?? null,
  };
}

export async function createAutoPatchPolicy(params: CreateAutoPatchPolicyRequest, createdByAdminId: string) {
  const policy = await prisma.autoPatchPolicy.create({
    data: {
      enabled: params.enabled,
      minSeverity: params.minSeverity,
      targetGroupIds: JSON.stringify(params.groupIds),
      createdByAdminId,
    },
  });
  return serializePolicy(policy);
}

export async function listAutoPatchPolicies() {
  const policies = await prisma.autoPatchPolicy.findMany({ orderBy: { createdAt: "desc" } });
  return Promise.all(
    policies.map(async (p) => ({ ...serializePolicy(p), groupNames: await resolveGroupNames(p.targetGroupIds) })),
  );
}

export async function updateAutoPatchPolicy(id: string, params: UpdateAutoPatchPolicyRequest) {
  const existing = await prisma.autoPatchPolicy.findUnique({ where: { id } });
  if (!existing) throw new AutoPatchPolicyNotFoundError();

  const policy = await prisma.autoPatchPolicy.update({
    where: { id },
    data: {
      enabled: params.enabled,
      minSeverity: params.minSeverity,
      targetGroupIds: params.groupIds ? JSON.stringify(params.groupIds) : undefined,
    },
  });
  return serializePolicy(policy);
}

export async function deleteAutoPatchPolicy(id: string): Promise<boolean> {
  try {
    await prisma.autoPatchPolicy.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

// Non-terminal statuses mean "already in flight" for a given (agent, update) pair - a
// policy must never pile up a second auto-dispatch on top of one that's still pending,
// scheduled, or dispatched. A prior FAILED attempt is deliberately NOT treated as in-flight,
// so the next sweep naturally retries it - a small, honest bonus this scope doesn't have to
// build a separate retry-tracking system to get.
const IN_FLIGHT_STATUSES = ["PENDING", "SCHEDULED", "DISPATCHED"];

// Evaluated on a periodic sweep (see index.ts), not triggered per-scan - matching this
// codebase's existing preference for polling over event-driven triggers. Creates at most
// one PatchJob per policy per sweep, covering every currently-qualifying (agent, update)
// pair that isn't already in flight - the same "every targeted agent gets the same update
// list, the agent-side installer skips what it doesn't need" semantics manual dispatch
// already relies on (see createPatchJob), so a policy covering agents with different
// missing patches is not a new failure mode.
export async function runAutoPatchPolicies(): Promise<void> {
  const policies = await prisma.autoPatchPolicy.findMany({ where: { enabled: true } });

  for (const policy of policies) {
    const groupIds = JSON.parse(policy.targetGroupIds) as string[];
    const targetAgentIds =
      groupIds.length === 0
        ? (await prisma.agent.findMany({ select: { id: true } })).map((a) => a.id)
        : await resolveTargetAgentIds([], groupIds);

    if (targetAgentIds.length === 0) {
      await prisma.autoPatchPolicy.update({ where: { id: policy.id }, data: { lastRunAt: new Date() } });
      continue;
    }

    const findings = await prisma.patchFinding.findMany({
      where: { agentId: { in: targetAgentIds }, status: "MISSING" },
      include: { patchDefinition: true },
    });
    const qualifying = findings.filter((f) =>
      meetsSeverityThreshold(f.patchDefinition.severity, policy.minSeverity as NormalizedSeverity),
    );

    if (qualifying.length === 0) {
      await prisma.autoPatchPolicy.update({ where: { id: policy.id }, data: { lastRunAt: new Date() } });
      continue;
    }

    const inFlightTasks = await prisma.patchTask.findMany({
      where: { agentId: { in: targetAgentIds }, status: { in: IN_FLIGHT_STATUSES } },
      include: { job: { select: { updateIds: true } } },
    });
    const inFlightKeys = new Set(
      inFlightTasks.flatMap((t) => (JSON.parse(t.job.updateIds) as string[]).map((updateId) => `${t.agentId}::${updateId}`)),
    );

    const pendingAgentIds = new Set<string>();
    const pendingUpdateIds = new Set<string>();
    for (const f of qualifying) {
      const key = `${f.agentId}::${f.patchDefinition.updateId}`;
      if (inFlightKeys.has(key)) continue;
      pendingAgentIds.add(f.agentId);
      pendingUpdateIds.add(f.patchDefinition.updateId);
    }

    if (pendingAgentIds.size > 0 && pendingUpdateIds.size > 0) {
      await createPatchJob({
        updateIds: [...pendingUpdateIds],
        agentIds: [...pendingAgentIds],
        groupIds,
        createdByAdminId: policy.createdByAdminId,
      });
    }

    await prisma.autoPatchPolicy.update({ where: { id: policy.id }, data: { lastRunAt: new Date() } });
  }
}
