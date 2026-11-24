import type {
  AssignScreenshotBlockPolicyRequest,
  AssignedScreenshotBlockWire,
  CreateScreenshotBlockPolicyRequest,
  ScreenshotBlockReport,
  UpdateScreenshotBlockPolicyRequest,
} from "@em/shared";
import { SCREENSHOT_TOOL_PROCESSES } from "@em/shared";
import { prisma } from "../db";
import { assertAssignable } from "./policyExclusivity.service";
import { newAssignmentTargets } from "../utils/assignments";
import { resolveTargetAgentIds } from "./agentTargeting.service";
import { isAgentPaused } from "./pause.service";
import { isPolicyExcepted } from "./policyAccessException.service";
import { effectiveMemberships, effectiveMembershipsOf } from "./groupTree.service";

// EPM -> Screenshot blocking: policies, assignment, what each endpoint enforces, and the blocked
// attempts endpoints report.

type PolicyRow = NonNullable<Awaited<ReturnType<typeof prisma.screenshotBlockPolicy.findUnique>>>;

async function groupIdsForAgent(agentId: string): Promise<string[]> {
  const memberships = await effectiveMemberships(agentId);
  return memberships.map((m) => m.groupId);
}

export async function resolveAssignedAgentIdsForPolicy(policyId: string): Promise<string[]> {
  const assignments = await prisma.screenshotBlockPolicyAssignment.findMany({ where: { policyId } });
  return resolveTargetAgentIds(
    assignments.filter((a) => a.agentId).map((a) => a.agentId!),
    assignments.filter((a) => a.groupId).map((a) => a.groupId!),
  );
}

async function toView(p: PolicyRow) {
  const agentIds = await resolveAssignedAgentIdsForPolicy(p.id);
  const since = new Date(Date.now() - 7 * 86_400_000);
  const blocked7d = agentIds.length > 0 ? await prisma.screenshotBlockEvent.count({ where: { agentId: { in: agentIds }, occurredAt: { gte: since } } }) : 0;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    blockKeys: p.blockKeys,
    blockTools: p.blockTools,
    blockClipboardImages: p.blockClipboardImages,
    extraTools: JSON.parse(p.extraTools) as string[],
    enabled: p.enabled,
    assignedAgentCount: agentIds.length,
    blocked7d,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function createPolicy(params: CreateScreenshotBlockPolicyRequest, createdByAdminId: string) {
  const policy = await prisma.screenshotBlockPolicy.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      blockKeys: params.blockKeys,
      blockTools: params.blockTools,
      blockClipboardImages: params.blockClipboardImages,
      extraTools: JSON.stringify(params.extraTools),
      enabled: params.enabled,
      createdByAdminId,
    },
  });
  return getPolicy(policy.id);
}

export async function listPolicies() {
  const policies = await prisma.screenshotBlockPolicy.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(policies.map(toView));
}

export async function getPolicy(id: string) {
  const policy = await prisma.screenshotBlockPolicy.findUnique({ where: { id } });
  return policy ? toView(policy) : null;
}

export async function updatePolicy(id: string, params: UpdateScreenshotBlockPolicyRequest) {
  await prisma.screenshotBlockPolicy.update({
    where: { id },
    data: {
      name: params.name,
      description: params.description,
      blockKeys: params.blockKeys,
      blockTools: params.blockTools,
      blockClipboardImages: params.blockClipboardImages,
      extraTools: params.extraTools ? JSON.stringify(params.extraTools) : undefined,
      enabled: params.enabled,
    },
  });
  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  try {
    await prisma.screenshotBlockPolicy.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function assignPolicy(policyId: string, params: AssignScreenshotBlockPolicyRequest) {
  const existing = await prisma.screenshotBlockPolicyAssignment.findMany({ where: { policyId }, select: { agentId: true, groupId: true } });
  const fresh = newAssignmentTargets(existing, params.agentIds, params.groupIds);
  // One SCREENSHOT_BLOCK policy per endpoint (policyExclusivity.service.ts).
  await assertAssignable("SCREENSHOT_BLOCK", policyId, fresh.agentIds, fresh.groupIds);
  if (fresh.agentIds.length + fresh.groupIds.length > 0) {
    await prisma.screenshotBlockPolicyAssignment.createMany({
      data: [...fresh.agentIds.map((agentId) => ({ policyId, agentId })), ...fresh.groupIds.map((groupId) => ({ policyId, groupId }))],
    });
  }
  return getPolicy(policyId);
}

export async function listAssignments(policyId: string) {
  const assignments = await prisma.screenshotBlockPolicyAssignment.findMany({ where: { policyId }, include: { agent: true, group: true } });
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
  const result = await prisma.screenshotBlockPolicyAssignment.deleteMany({ where: { id: assignmentId, policyId } });
  return result.count > 0;
}

// Per endpoint of the policy: last sync, and blocked attempts in the last `days` days.
export async function getPolicyActivity(policyId: string, days: number) {
  const policy = await prisma.screenshotBlockPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;
  const agentIds = await resolveAssignedAgentIdsForPolicy(policyId);
  if (agentIds.length === 0) return { agents: [] };
  const since = new Date(Date.now() - days * 86_400_000);
  const [agents, events, assignments, memberships] = await Promise.all([
    prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, hostname: true } }),
    prisma.screenshotBlockEvent.findMany({ where: { agentId: { in: agentIds }, occurredAt: { gte: since } }, select: { agentId: true, kind: true, occurredAt: true } }),
    prisma.screenshotBlockPolicyAssignment.findMany({ where: { policyId } }),
    effectiveMembershipsOf(agentIds),
  ]);
  const assignmentFor = (agentId: string) =>
    assignments.find((a) => a.agentId === agentId) ??
    assignments.find((a) => a.groupId && memberships.some((m) => m.agentId === agentId && m.groupId === a.groupId)) ??
    null;
  return {
    agents: agents
      .map((a) => {
        const mine = events.filter((e) => e.agentId === a.id);
        const assignment = assignmentFor(a.id);
        return {
          agentId: a.id,
          hostname: a.hostname,
          keyCount: mine.filter((e) => e.kind === "KEY").length,
          toolCount: mine.filter((e) => e.kind === "TOOL").length,
          clipboardCount: mine.filter((e) => e.kind === "CLIPBOARD").length,
          lastBlockedAt: mine.reduce<Date | null>((max, e) => (!max || e.occurredAt > max ? e.occurredAt : max), null)?.toISOString() ?? null,
          lastSyncedAt: assignment?.lastSyncedAt?.toISOString() ?? null,
          lastSyncStatus: assignment?.lastSyncStatus ?? null,
          lastSyncError: assignment?.lastSyncError ?? null,
        };
      })
      .sort((x, y) => (y.lastBlockedAt ?? "").localeCompare(x.lastBlockedAt ?? "") || x.hostname.localeCompare(y.hostname)),
  };
}

export async function getAgentEvents(agentId: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const events = await prisma.screenshotBlockEvent.findMany({ where: { agentId, occurredAt: { gte: since } }, orderBy: { occurredAt: "desc" }, take: 500 });
  return events.map((e) => ({ id: e.id, username: e.username, kind: e.kind, detail: e.detail, occurredAt: e.occurredAt.toISOString() }));
}

// ---- Agent side

export async function resolveAssignedForAgent(agentId: string): Promise<AssignedScreenshotBlockWire> {
  const none: AssignedScreenshotBlockWire = { policyIds: [], blockKeys: false, blockTools: false, blockClipboardImages: false, tools: [] };
  if (await isAgentPaused(agentId)) return none;
  const groupIds = await groupIdsForAgent(agentId);
  const assignments = await prisma.screenshotBlockPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const candidates = [...new Set(assignments.map((a) => a.policyId))];
  if (candidates.length === 0) return none;
  const excepted = await Promise.all(candidates.map((id) => isPolicyExcepted("SCREENSHOT_BLOCK", id, agentId)));
  const ids = candidates.filter((_, i) => !excepted[i]);
  if (ids.length === 0) return none;
  const policies = await prisma.screenshotBlockPolicy.findMany({ where: { id: { in: ids }, enabled: true } });
  if (policies.length === 0) return none;

  const blockTools = policies.some((p) => p.blockTools);
  const tools = new Set<string>();
  for (const p of policies) {
    if (p.blockTools) for (const t of SCREENSHOT_TOOL_PROCESSES) tools.add(t);
    for (const t of JSON.parse(p.extraTools) as string[]) tools.add(t.toLowerCase());
  }
  return {
    policyIds: policies.map((p) => p.id),
    blockKeys: policies.some((p) => p.blockKeys),
    blockTools,
    blockClipboardImages: policies.some((p) => p.blockClipboardImages),
    tools: [...tools].sort(),
  };
}

export async function recordReport(agentId: string, report: ScreenshotBlockReport): Promise<void> {
  if (report.events.length > 0) {
    await prisma.screenshotBlockEvent.createMany({
      data: report.events.map((e) => ({ agentId, username: e.username, kind: e.kind, detail: e.detail, occurredAt: new Date(e.occurredAt) })),
    });
  }
  if (report.policyIds.length === 0) return;
  const groupIds = await groupIdsForAgent(agentId);
  await prisma.screenshotBlockPolicyAssignment.updateMany({
    where: { policyId: { in: report.policyIds }, OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    data: { lastSyncedAt: new Date(), lastSyncStatus: report.status, lastSyncError: report.errorMessage },
  });
}
