import type { AgentUpdateStatusPayload } from "@em/shared";
import { prisma } from "../db";
import type { AgentPlatform } from "./agentBuild.service";
import { getLatestAgentBuild } from "./agentBuild.service";

export class AgentUpdateTaskNotOwnedError extends Error {}
export class NoAgentBuildStagedError extends Error {}
export class AllAgentsAlreadyUpdatingError extends Error {}

export interface LatestAgentUpdateTaskInfo {
  status: string;
  message: string | null;
  targetVersion: string;
  dispatchedAt: string | null;
  completedAt: string | null;
}

// Powers the live "Applying..." status shown on both the Endpoint detail page and the
// Agent Updates page's "Roll out to endpoints" table - a single batched query for however
// many agents are being rendered (the endpoint list is polled every 5s; a per-agent query
// there would mean N+1 queries every poll) rather than one lookup per agent. AgentUpdateTask
// has no createdAt of its own, so recency is taken from its parent job's createdAt instead -
// each task is created once, at job-creation time, and never re-created.
export async function getLatestAgentUpdateTaskByAgent(agentIds: string[]): Promise<Map<string, LatestAgentUpdateTaskInfo>> {
  if (agentIds.length === 0) return new Map();

  const tasks = await prisma.agentUpdateTask.findMany({
    where: { agentId: { in: agentIds } },
    include: { job: { select: { targetVersion: true, createdAt: true } } },
    orderBy: { job: { createdAt: "desc" } },
  });

  const byAgent = new Map<string, LatestAgentUpdateTaskInfo>();
  for (const t of tasks) {
    if (byAgent.has(t.agentId)) continue; // already kept the newest (sorted desc above)
    byAgent.set(t.agentId, {
      status: t.status,
      message: t.message,
      targetVersion: t.job.targetVersion,
      dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
    });
  }
  return byAgent;
}

interface CreateAgentUpdateJobParams {
  agentIds: string[]; // already resolved (groups expanded, deduped) by the caller
  groupIds: string[]; // kept for display/audit only — task fan-out uses agentIds
  createdByAdminId: string;
}

const KNOWN_PLATFORMS: AgentPlatform[] = ["win32", "linux"];

// Unlike createDeploymentJob/createPatchJob, there's no packageId/updateIds the caller
// picks - the target is always whatever build is currently staged on this server FOR THAT
// AGENT'S OWN PLATFORM. A selection can freely mix Windows and Linux endpoints (e.g. one
// group containing both) - rather than rejecting that or making the admin think about OS at
// all, the selection is split by Agent.osPlatform and one job is created per platform
// actually present, each carrying that platform's own build. One admin click, N
// platform-homogeneous jobs; the console just shows however many jobIds come back.
//
// Silently drops any agentId that already has a non-terminal task (PENDING/DISPATCHED/
// DOWNLOADING/APPLYING) rather than creating a second one - unlike patch tasks, there's no
// sane way for the agent to decide which of two simultaneously-pending update tasks to
// actually apply, so the fix is to never let that state exist rather than resolve it later.
// An agent stuck on a genuinely failed task can just be re-targeted once that task reaches
// FAILED. Throws only if EVERY selected agent ends up excluded (already updating, or its
// platform has no build staged) - a partial result is returned via skippedAgentIds/
// noBuildAgentIds instead of failing the whole dispatch.
export async function createAgentUpdateJob(
  params: CreateAgentUpdateJobParams,
): Promise<{ jobIds: string[]; skippedAgentIds: string[]; noBuildAgentIds: string[] }> {
  const inFlight = await prisma.agentUpdateTask.findMany({
    where: { agentId: { in: params.agentIds }, status: { in: ["PENDING", "DISPATCHED", "DOWNLOADING", "APPLYING"] } },
    select: { agentId: true },
  });
  const inFlightIds = new Set(inFlight.map((t) => t.agentId));
  const candidateAgentIds = params.agentIds.filter((id) => !inFlightIds.has(id));

  const candidates = await prisma.agent.findMany({
    where: { id: { in: candidateAgentIds } },
    select: { id: true, osPlatform: true },
  });

  const byPlatform = new Map<AgentPlatform, string[]>();
  const noBuildAgentIds: string[] = [];
  for (const agent of candidates) {
    const platform = KNOWN_PLATFORMS.includes(agent.osPlatform as AgentPlatform) ? (agent.osPlatform as AgentPlatform) : null;
    // An agent enrolled from a platform with no packaging pipeline at all (anything other
    // than win32/linux) can never have a build - same bucket as "build not staged yet" from
    // the caller's point of view.
    if (!platform) {
      noBuildAgentIds.push(agent.id);
      continue;
    }
    if (!byPlatform.has(platform)) byPlatform.set(platform, []);
    byPlatform.get(platform)!.push(agent.id);
  }

  const jobIds: string[] = [];
  for (const [platform, agentIds] of byPlatform) {
    const build = getLatestAgentBuild(platform);
    if (!build) {
      noBuildAgentIds.push(...agentIds);
      continue;
    }
    const job = await prisma.agentUpdateJob.create({
      data: {
        platform,
        targetVersion: build.version,
        sha256: build.sha256,
        createdByAdminId: params.createdByAdminId,
        targetGroupIds: JSON.stringify(params.groupIds),
        tasks: { create: agentIds.map((agentId) => ({ agentId })) },
      },
    });
    jobIds.push(job.id);
  }

  if (jobIds.length === 0) {
    // Nothing to dispatch. If there were no candidates at all, every requested agent was
    // already mid-update; otherwise there were candidates but none had a staged build for
    // their platform.
    if (candidateAgentIds.length === 0) throw new AllAgentsAlreadyUpdatingError();
    throw new NoAgentBuildStagedError();
  }

  return { jobIds, skippedAgentIds: [...inFlightIds], noBuildAgentIds };
}

async function resolveGroupNames(groupIdsJson: string): Promise<string[]> {
  const groupIds = JSON.parse(groupIdsJson) as string[];
  if (groupIds.length === 0) return [];
  const groups = await prisma.assetGroup.findMany({ where: { id: { in: groupIds } } });
  const byId = new Map(groups.map((g) => [g.id, g.name]));
  return groupIds.map((id) => byId.get(id) ?? "(deleted group)");
}

export async function listAgentUpdateJobs() {
  const jobs = await prisma.agentUpdateJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { tasks: { include: { agent: { include: { inventory: { select: { lastLoggedOnUser: true } } } } } } },
  });

  return Promise.all(
    jobs.map(async (job) => ({
      id: job.id,
      platform: job.platform,
      targetVersion: job.targetVersion,
      targetGroupNames: await resolveGroupNames(job.targetGroupIds),
      // Parallel arrays, one entry per task, same order - mirrors targetGroupNames' own
      // join-for-display idiom rather than a nested per-host object, since the list view's
      // whole point is a compact one-row-per-job summary (the full per-task breakdown with
      // status/message already exists in getAgentUpdateJob's job detail table below it).
      targetHostnames: job.tasks.map((t) => t.agent.hostname),
      targetIpAddresses: job.tasks.map((t) => t.agent.ipAddress ?? "—"),
      targetUsernames: job.tasks.map((t) => t.agent.inventory?.lastLoggedOnUser ?? "—"),
      createdAt: job.createdAt.toISOString(),
      taskCounts: job.tasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {}),
    })),
  );
}

export async function getAgentUpdateJob(jobId: string) {
  const job = await prisma.agentUpdateJob.findUnique({
    where: { id: jobId },
    include: { tasks: { include: { agent: { include: { inventory: { select: { lastLoggedOnUser: true } } } } } } },
  });
  if (!job) return null;

  return {
    id: job.id,
    platform: job.platform,
    targetVersion: job.targetVersion,
    targetGroupNames: await resolveGroupNames(job.targetGroupIds),
    createdAt: job.createdAt.toISOString(),
    tasks: job.tasks.map((t) => ({
      id: t.id,
      agentId: t.agentId,
      hostname: t.agent.hostname,
      ipAddress: t.agent.ipAddress,
      lastLoggedOnUser: t.agent.inventory?.lastLoggedOnUser ?? null,
      status: t.status,
      message: t.message,
      dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
  };
}

// Called both by the still-running original process (best-effort DOWNLOADING/APPLYING
// progress pings, sent right before it registers the detached helper task and tears
// itself down) and by the detached helper task itself for the real terminal SUCCESS/
// FAILED once the swap has actually happened - see buildSelfUpdateScript. Both use the
// same agent credentials (state.json survives the swap untouched), so there's no way to
// tell them apart server-side, and no need to: whichever call arrives last simply wins.
export async function recordAgentUpdateStatus(
  taskId: string,
  agentId: string,
  payload: AgentUpdateStatusPayload,
): Promise<void> {
  const task = await prisma.agentUpdateTask.findUnique({ where: { id: taskId }, include: { job: true } });
  if (!task || task.agentId !== agentId) {
    throw new AgentUpdateTaskNotOwnedError("Agent update task not found for this agent");
  }

  const isTerminal = payload.status === "SUCCESS" || payload.status === "FAILED";
  await prisma.agentUpdateTask.update({
    where: { id: taskId },
    data: {
      status: payload.status,
      message: payload.message ?? undefined,
      completedAt: isTerminal ? new Date() : undefined,
    },
  });

  // Belt-and-suspenders: checkin.service.ts's handleCheckin already self-corrects
  // Agent.agentVersion from whatever the endpoint reports on its very next checkin after
  // restarting, but writing the known-correct targetVersion here too means the console
  // reflects success immediately rather than waiting up to one more poll interval.
  if (payload.status === "SUCCESS") {
    await prisma.agent.update({ where: { id: agentId }, data: { agentVersion: task.job.targetVersion } });
  }
}

// A dispatched/downloading/applying task normally resolves within well under a minute
// (dispatch -> download -> ~20s helper-task handoff -> extract), so anything still
// non-terminal after STALE_AFTER_MS has almost certainly lost its completion report
// silently (see selfUpdater.ts's Report-Status try/catch, or processAgentUpdate hitting a
// bail-out guard whose own report call then failed) rather than genuinely still being in
// progress. Left alone, a task stuck like this blocks every future update attempt at this
// agent forever, since createAgentUpdateJob refuses to create a second in-flight task -
// same "periodic sweep over precise event-driven triggers" idiom already used by
// scheduleLicenseRevalidation/schedulePatchAutomation in index.ts.
const STALE_AFTER_MS = 15 * 60 * 1000;

export async function reconcileStaleAgentUpdateTasks(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const result = await prisma.agentUpdateTask.updateMany({
    where: {
      status: { in: ["DISPATCHED", "DOWNLOADING", "APPLYING"] },
      dispatchedAt: { lt: cutoff },
    },
    data: {
      status: "FAILED",
      message: "Timed out waiting for the agent to report completion — it may be offline, or the update silently failed on the endpoint. Check the endpoint directly, then retry.",
      completedAt: new Date(),
    },
  });
  return result.count;
}
