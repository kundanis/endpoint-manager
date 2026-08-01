import type { DeploymentStatusPayload } from "@em/shared";
import { prisma } from "../db";

export class DeploymentTaskNotOwnedError extends Error {}

interface CreateDeploymentJobParams {
  packageId: string;
  agentIds: string[]; // already resolved (groups expanded, deduped) by the caller
  groupIds: string[]; // kept for display/audit only — task fan-out uses agentIds
  createdByAdminId: string;
}

export async function createDeploymentJob(params: CreateDeploymentJobParams): Promise<{ jobId: string }> {
  const job = await prisma.deploymentJob.create({
    data: {
      packageId: params.packageId,
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

export async function listDeploymentJobs() {
  const jobs = await prisma.deploymentJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { tasks: true, package: true },
  });

  return Promise.all(
    jobs.map(async (job) => ({
      id: job.id,
      packageId: job.packageId,
      packageName: job.package.name,
      packageVersion: job.package.version,
      targetGroupNames: await resolveGroupNames(job.targetGroupIds),
      createdAt: job.createdAt.toISOString(),
      taskCounts: job.tasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {}),
    })),
  );
}

export async function getDeploymentJob(jobId: string) {
  const job = await prisma.deploymentJob.findUnique({
    where: { id: jobId },
    include: { tasks: { include: { agent: true } }, package: true },
  });
  if (!job) return null;

  return {
    id: job.id,
    packageId: job.packageId,
    packageName: job.package.name,
    packageVersion: job.package.version,
    targetGroupNames: await resolveGroupNames(job.targetGroupIds),
    createdAt: job.createdAt.toISOString(),
    tasks: job.tasks.map((t) => ({
      id: t.id,
      agentId: t.agentId,
      hostname: t.agent.hostname,
      status: t.status,
      exitCode: t.exitCode,
      message: t.message,
      dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
  };
}

export async function recordDeploymentStatus(
  taskId: string,
  agentId: string,
  payload: DeploymentStatusPayload,
): Promise<void> {
  const task = await prisma.deploymentTask.findUnique({ where: { id: taskId } });
  if (!task || task.agentId !== agentId) {
    throw new DeploymentTaskNotOwnedError("Deployment task not found for this agent");
  }

  const isTerminal = payload.status === "SUCCESS" || payload.status === "FAILED";
  await prisma.deploymentTask.update({
    where: { id: taskId },
    data: {
      status: payload.status,
      exitCode: payload.exitCode ?? undefined,
      message: payload.message ?? undefined,
      completedAt: isTerminal ? new Date() : undefined,
    },
  });
}
