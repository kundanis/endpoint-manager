import type {
  AssignScreenCapturePolicyRequest,
  CreateScreenCapturePolicyRequest,
  ScreenCaptureSource,
  UpdateScreenCapturePolicyRequest,
} from "@em/shared";
import { isIgnoredScreenshotOpener } from "@em/shared";
import { prisma } from "../db";
import { newAssignmentTargets } from "../utils/assignments";
import { resolveTargetAgentIds } from "./agentTargeting.service";

type PolicyRow = NonNullable<Awaited<ReturnType<typeof prisma.screenCapturePolicy.findUnique>>>;

export async function resolveAssignedAgentIdsForPolicy(policyId: string): Promise<string[]> {
  const assignments = await prisma.screenCapturePolicyAssignment.findMany({ where: { policyId } });
  const agentIds = assignments.filter((a) => a.agentId).map((a) => a.agentId!);
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  return resolveTargetAgentIds(agentIds, groupIds);
}

// The capture sources a policy counts. Captures from admin-added folders count for policies
// that have such folders.
export function policySources(p: Pick<PolicyRow, "monitorWindows" | "monitorSnippingTool" | "monitorGameBar" | "monitorThirdParty" | "extraPaths">): ScreenCaptureSource[] {
  const sources: ScreenCaptureSource[] = [];
  if (p.monitorWindows) sources.push("WINDOWS");
  if (p.monitorSnippingTool) sources.push("SNIPPING_TOOL");
  if (p.monitorGameBar) sources.push("GAME_BAR");
  if (p.monitorThirdParty) sources.push("THIRD_PARTY");
  if ((JSON.parse(p.extraPaths) as string[]).length > 0) sources.push("CUSTOM");
  return sources;
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDay(d);
}

interface OpenedBy {
  process: string;
  at: string;
}

// Programs that opened a screenshot, minus antivirus and the like recorded by older agents.
function openersOf(e: { openedBy: string }): OpenedBy[] {
  return (JSON.parse(e.openedBy) as OpenedBy[]).filter((o) => !isIgnoredScreenshotOpener(o.process));
}

type EventRow = Awaited<ReturnType<typeof prisma.screenCaptureEvent.findMany>>[number];

// Per user per day: how many screenshots, from which tools, how many were deleted soon after,
// and which programs opened them. A row over the policy's threshold is flagged.
export function buildDailyRows(events: EventRow[], policy: Pick<PolicyRow, "dailyThreshold" | "quickDeleteMinutes">) {
  const rows = new Map<
    string,
    { agentId: string; username: string; day: string; count: number; sources: Set<string>; quickDeleted: number; openedBy: Set<string>; lastCaptureAt: Date }
  >();
  for (const e of events) {
    const key = `${e.agentId}|${e.username.toLowerCase()}|${e.captureDay}`;
    let row = rows.get(key);
    if (!row) {
      row = { agentId: e.agentId, username: e.username, day: e.captureDay, count: 0, sources: new Set(), quickDeleted: 0, openedBy: new Set(), lastCaptureAt: e.capturedAt };
      rows.set(key, row);
    }
    row.count++;
    row.sources.add(e.source);
    if (isQuickDelete(e, policy.quickDeleteMinutes)) row.quickDeleted++;
    for (const o of openersOf(e)) row.openedBy.add(o.process);
    if (e.capturedAt > row.lastCaptureAt) row.lastCaptureAt = e.capturedAt;
  }
  return [...rows.values()]
    .map((r) => ({
      agentId: r.agentId,
      username: r.username,
      day: r.day,
      count: r.count,
      overThreshold: r.count > policy.dailyThreshold,
      sources: [...r.sources] as ScreenCaptureSource[],
      quickDeleted: r.quickDeleted,
      openedBy: [...r.openedBy].sort(),
      lastCaptureAt: r.lastCaptureAt.toISOString(),
    }))
    .sort((a, b) => b.day.localeCompare(a.day) || b.count - a.count);
}

function isQuickDelete(e: Pick<EventRow, "capturedAt" | "deletedAt">, minutes: number): boolean {
  return !!e.deletedAt && e.deletedAt.getTime() - e.capturedAt.getTime() <= minutes * 60_000;
}

async function policyEvents(policy: PolicyRow, fromDay: string, toDay?: string, agentIds?: string[]) {
  const ids = agentIds ?? (await resolveAssignedAgentIdsForPolicy(policy.id));
  if (ids.length === 0) return [];
  return prisma.screenCaptureEvent.findMany({
    where: {
      agentId: { in: ids },
      source: { in: policySources(policy) },
      captureDay: { gte: fromDay, ...(toDay ? { lte: toDay } : {}) },
    },
    orderBy: { capturedAt: "desc" },
  });
}

async function toView(p: PolicyRow) {
  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(p.id);
  // Users who went over the threshold on some day in the last 7 days.
  const flagged = buildDailyRows(await policyEvents(p, daysAgo(6), undefined, assignedAgentIds), p).filter((r) => r.overThreshold);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    dailyThreshold: p.dailyThreshold,
    quickDeleteMinutes: p.quickDeleteMinutes,
    monitorWindows: p.monitorWindows,
    monitorSnippingTool: p.monitorSnippingTool,
    monitorGameBar: p.monitorGameBar,
    monitorThirdParty: p.monitorThirdParty,
    extraPaths: JSON.parse(p.extraPaths) as string[],
    trackOpenedBy: p.trackOpenedBy,
    saveImages: p.saveImages,
    saveImagesAllEndpoints: p.saveImagesAllEndpoints,
    saveImagesAgentIds: JSON.parse(p.saveImagesAgentIds) as string[],
    imageRetentionDays: p.imageRetentionDays,
    enabled: p.enabled,
    assignedAgentCount: assignedAgentIds.length,
    flaggedUsers7d: new Set(flagged.map((r) => `${r.agentId}|${r.username.toLowerCase()}`)).size,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function createPolicy(params: CreateScreenCapturePolicyRequest, createdByAdminId: string) {
  const policy = await prisma.screenCapturePolicy.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      dailyThreshold: params.dailyThreshold,
      quickDeleteMinutes: params.quickDeleteMinutes,
      monitorWindows: params.monitorWindows,
      monitorSnippingTool: params.monitorSnippingTool,
      monitorGameBar: params.monitorGameBar,
      monitorThirdParty: params.monitorThirdParty,
      extraPaths: JSON.stringify(params.extraPaths),
      trackOpenedBy: params.trackOpenedBy,
      saveImages: params.saveImages,
      saveImagesAllEndpoints: params.saveImagesAllEndpoints,
      saveImagesAgentIds: JSON.stringify(params.saveImagesAgentIds),
      imageRetentionDays: params.imageRetentionDays,
      enabled: params.enabled,
      createdByAdminId,
    },
  });
  return getPolicy(policy.id);
}

export async function listPolicies() {
  const policies = await prisma.screenCapturePolicy.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(policies.map(toView));
}

export async function getPolicy(id: string) {
  const policy = await prisma.screenCapturePolicy.findUnique({ where: { id } });
  return policy ? toView(policy) : null;
}

export async function updatePolicy(id: string, params: UpdateScreenCapturePolicyRequest) {
  await prisma.screenCapturePolicy.update({
    where: { id },
    data: {
      name: params.name,
      description: params.description,
      dailyThreshold: params.dailyThreshold,
      quickDeleteMinutes: params.quickDeleteMinutes,
      monitorWindows: params.monitorWindows,
      monitorSnippingTool: params.monitorSnippingTool,
      monitorGameBar: params.monitorGameBar,
      monitorThirdParty: params.monitorThirdParty,
      extraPaths: params.extraPaths ? JSON.stringify(params.extraPaths) : undefined,
      trackOpenedBy: params.trackOpenedBy,
      saveImages: params.saveImages,
      saveImagesAllEndpoints: params.saveImagesAllEndpoints,
      saveImagesAgentIds: params.saveImagesAgentIds ? JSON.stringify(params.saveImagesAgentIds) : undefined,
      imageRetentionDays: params.imageRetentionDays,
      enabled: params.enabled,
    },
  });
  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  try {
    await prisma.screenCapturePolicy.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function assignPolicy(policyId: string, params: AssignScreenCapturePolicyRequest) {
  const existing = await prisma.screenCapturePolicyAssignment.findMany({ where: { policyId }, select: { agentId: true, groupId: true } });
  const fresh = newAssignmentTargets(existing, params.agentIds, params.groupIds);
  if (fresh.agentIds.length + fresh.groupIds.length > 0) {
    await prisma.screenCapturePolicyAssignment.createMany({
      data: [...fresh.agentIds.map((agentId) => ({ policyId, agentId })), ...fresh.groupIds.map((groupId) => ({ policyId, groupId }))],
    });
  }
  return getPolicy(policyId);
}

export async function listAssignments(policyId: string) {
  const assignments = await prisma.screenCapturePolicyAssignment.findMany({ where: { policyId }, include: { agent: true, group: true } });
  return assignments.map((a) => ({
    id: a.id,
    agentId: a.agentId,
    hostname: a.agent?.hostname ?? null,
    groupId: a.groupId,
    groupName: a.group?.name ?? null,
  }));
}

export async function unassign(policyId: string, assignmentId: string): Promise<boolean> {
  const result = await prisma.screenCapturePolicyAssignment.deleteMany({ where: { id: assignmentId, policyId } });
  return result.count > 0;
}

// The policy's report over the last `days` days (endpoint-local dates).
export async function getPolicyReport(policyId: string, days: number) {
  const policy = await prisma.screenCapturePolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;
  const events = await policyEvents(policy, daysAgo(days - 1));
  const rows = buildDailyRows(events, policy);
  const agentIds = [...new Set(rows.map((r) => r.agentId))];
  const hostnames = new Map(
    (agentIds.length > 0 ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, hostname: true } }) : []).map((a) => [a.id, a.hostname]),
  );
  return {
    dailyThreshold: policy.dailyThreshold,
    quickDeleteMinutes: policy.quickDeleteMinutes,
    totals: {
      captures: events.length,
      flaggedUserDays: rows.filter((r) => r.overThreshold).length,
      quickDeleted: events.filter((e) => isQuickDelete(e, policy.quickDeleteMinutes)).length,
      openedByOtherApps: events.filter((e) => openersOf(e).length > 0).length,
    },
    rows: rows.map((r) => ({ ...r, hostname: hostnames.get(r.agentId) ?? null })),
  };
}

// The individual screenshots behind one report row. Whether an image was saved is shown to
// super admins only (withImages); they alone can open it.
export async function getCaptures(policyId: string, agentId: string, username: string, day: string, withImages = false) {
  const policy = await prisma.screenCapturePolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;
  const events = await prisma.screenCaptureEvent.findMany({
    where: { agentId, username, captureDay: day, source: { in: policySources(policy) } },
    orderBy: { capturedAt: "asc" },
  });
  return events.map((e) => ({
    id: e.id,
    source: e.source as ScreenCaptureSource,
    filePath: e.filePath,
    fileSizeBytes: e.fileSizeBytes.toString(),
    capturedAt: e.capturedAt.toISOString(),
    deletedAt: e.deletedAt?.toISOString() ?? null,
    quickDeleted: isQuickDelete(e, policy.quickDeleteMinutes),
    openedBy: openersOf(e),
    ...(withImages ? { hasImage: !!e.imageFile, imageSizeBytes: e.imageSizeBytes?.toString() ?? null } : {}),
  }));
}
