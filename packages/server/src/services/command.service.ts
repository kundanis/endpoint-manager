import type { CommandTaskResultPayload, Shell } from "@em/shared";
import { prisma } from "../db";
import { requestScan } from "./scanRequests";
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

// Endpoint -> History tab: commands sent to this endpoint from the console (Commands page,
// Software tab uninstall, benchmark fixes, deployments and security actions), newest first.
// Security actions (agent uninstall, quarantine, remote access: bypassesPause jobs) show what
// they were but not their script. Output is trimmed; the full result is on the Commands page.
const HISTORY_COMMANDS = 200;
const HISTORY_OUTPUT_CHARS = 4000;

function trimOutput(text: string | null | undefined): string | null {
  if (text === undefined) return null;
  if (!text) return text;
  return text.length > HISTORY_OUTPUT_CHARS ? `${text.slice(0, HISTORY_OUTPUT_CHARS)}\n… (trimmed)` : text;
}

function securityActionLabel(script: string): string {
  // Markers from the scripts agent.service / quarantine.service / remoteAccess.service build.
  if (script.includes("EndpointProUninstallHelper")) return "Agent uninstall";
  if (script.includes("Write-Output 'RELEASED'")) return "Quarantine release";
  if (script.includes("pre-quarantine-")) return "Quarantine";
  if (script.includes("REMOTE_ACCESS_DISABLED")) return "Remote access off";
  if (script.includes("fDenyTSConnections")) return "Remote access on";
  return "Security action";
}

export async function listAgentCommands(agentId: string, includeAdmin: boolean) {
  const tasks = await prisma.commandTask.findMany({
    where: { agentId },
    orderBy: { job: { createdAt: "desc" } },
    take: HISTORY_COMMANDS,
    include: { job: { select: { id: true, shell: true, script: true, createdAt: true, createdByAdminId: true, bypassesPause: true } } },
  });
  const adminIds = includeAdmin ? [...new Set(tasks.map((t) => t.job.createdByAdminId))] : [];
  const admins = adminIds.length ? await prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true } }) : [];
  const emailById = new Map(admins.map((a) => [a.id, a.email]));

  return tasks.map((t) => {
    let script: string | null = null;
    try {
      script = decryptField(t.job.script);
    } catch {
      script = null;
    }
    const security = t.job.bypassesPause;
    let stdout: string | null = null;
    let stderr: string | null = null;
    try {
      stdout = trimOutput(decryptFieldOrNull(t.stdout));
      stderr = trimOutput(decryptFieldOrNull(t.stderr));
    } catch {
      // unreadable output - shown as none
    }
    return {
      id: t.id,
      jobId: t.job.id,
      sentAt: t.job.createdAt.toISOString(),
      shell: t.job.shell,
      // Security actions: a label only, never the script.
      script: security ? null : script,
      label: security ? securityActionLabel(script ?? "") : null,
      status: t.status,
      exitCode: t.exitCode,
      stdout: security ? null : stdout,
      stderr: security ? null : stderr,
      dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      adminEmail: includeAdmin ? (emailById.get(t.job.createdByAdminId) ?? null) : null,
    };
  });
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

  // A successful benchmark fix: have the endpoint re-check its benchmarks right away (agent
  // 0.2.10+) instead of at the next scheduled scan, so the rule shows Pass promptly.
  // Any finished command may have installed or removed software (an Uninstall from the
  // Software tab is one): refresh the endpoint's software list now (agent 0.2.16+).
  requestScan("inventory", [agentId]);

  if (payload.status === "SUCCESS") {
    const isBenchmarkFix = await prisma.securityBenchmarkFinding.count({ where: { agentId, remediationJobId: task.jobId } });
    if (isBenchmarkFix > 0) requestScan("securityConfig", [agentId]);
  }
}
