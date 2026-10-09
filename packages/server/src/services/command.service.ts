import type { CommandTaskResultPayload, Shell } from "@em/shared";
import { prisma } from "../db";
import { decryptField, decryptFieldOrNull, encryptField, encryptFieldOrNull } from "../utils/fieldEncryption";

export class CommandTaskNotOwnedError extends Error {}

interface CreateCommandJobParams {
  agentIds: string[]; // already resolved (groups expanded, deduped) by the caller
  groupIds: string[]; // kept for display/audit only — task fan-out uses agentIds
  shell: Shell;
  script: string;
  timeoutSec: number;
  createdByAdminId: string;
  // See CommandJob.bypassesPause in schema.prisma - only quarantine/remote-access/
  // uninstall dispatch should ever set this true.
  bypassesPause?: boolean;
}

export async function createCommandJob(params: CreateCommandJobParams): Promise<{ jobId: string }> {
  const job = await prisma.commandJob.create({
    data: {
      shell: params.shell,
      script: encryptField(params.script),
      timeoutSec: params.timeoutSec,
      createdByAdminId: params.createdByAdminId,
      targetGroupIds: JSON.stringify(params.groupIds),
      bypassesPause: params.bypassesPause ?? false,
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

// The console's "Recent jobs" list is a one-day window. Older jobs stay in the database and
// are still reachable by id; the cap only guards against an unusually busy day.
const RECENT_JOBS_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function listCommandJobs() {
  const jobs = await prisma.commandJob.findMany({
    where: { createdAt: { gte: new Date(Date.now() - RECENT_JOBS_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { tasks: true },
  });

  return Promise.all(
    jobs.map(async (job) => ({
      id: job.id,
      shell: job.shell,
      script: decryptField(job.script),
      timeoutSec: job.timeoutSec,
      targetGroupNames: await resolveGroupNames(job.targetGroupIds),
      createdAt: job.createdAt.toISOString(),
      taskCounts: job.tasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {}),
    })),
  );
}

export async function getCommandJob(jobId: string) {
  const job = await prisma.commandJob.findUnique({
    where: { id: jobId },
    include: { tasks: { include: { agent: true } } },
  });
  if (!job) return null;

  return {
    id: job.id,
    shell: job.shell,
    script: decryptField(job.script),
    timeoutSec: job.timeoutSec,
    targetGroupNames: await resolveGroupNames(job.targetGroupIds),
    createdAt: job.createdAt.toISOString(),
    tasks: job.tasks.map((t) => ({
      id: t.id,
      agentId: t.agentId,
      hostname: t.agent.hostname,
      status: t.status,
      exitCode: t.exitCode,
      stdout: decryptFieldOrNull(t.stdout),
      stderr: decryptFieldOrNull(t.stderr),
      dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
  };
}

export async function recordCommandResult(
  taskId: string,
  agentId: string,
  payload: CommandTaskResultPayload,
): Promise<void> {
  const task = await prisma.commandTask.findUnique({ where: { id: taskId } });
  if (!task || task.agentId !== agentId) {
    throw new CommandTaskNotOwnedError("Command task not found for this agent");
  }

  await prisma.commandTask.update({
    where: { id: taskId },
    data: {
      status: payload.status,
      exitCode: payload.exitCode,
      stdout: encryptFieldOrNull(payload.stdout),
      stderr: encryptFieldOrNull(payload.stderr),
      completedAt: new Date(payload.completedAt),
    },
  });
}
