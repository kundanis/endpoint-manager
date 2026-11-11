import type { AgentApplicablePolicy, AgentPauseRequestView, EndpointPauseRequest, PolicyAccessExceptionType } from "@em/shared";
import { ENDPOINT_USER_REQUESTER_PREFIX } from "@em/shared";
import { prisma } from "../db";

// Pause requests raised by the endpoint's own user from the Endpoint IQ tray app. They are
// ordinary access exception requests (PolicyAccessException, PENDING), so admins approve or
// reject them on the Access exceptions page and an approved one is applied by the same
// isPolicyExcepted check every policy module already makes.

interface PolicyTable {
  findMany(args: object): Promise<{ id: string; name: string }[]>;
}
interface AssignmentTable {
  findMany(args: object): Promise<{ policyId: string }[]>;
}

const PAUSABLE: { type: PolicyAccessExceptionType; area: "EPM" | "DLP"; label: string; policy: string; assignment: string }[] = [
  { type: "APP_CONTROL", area: "EPM", label: "Application control", policy: "appControlPolicy", assignment: "appControlPolicyAssignment" },
  { type: "WEB_BLOCK", area: "EPM", label: "Web blocking", policy: "webBlockPolicy", assignment: "webBlockPolicyAssignment" },
  { type: "COMMAND_BLOCK", area: "EPM", label: "Command blocking", policy: "commandBlockPolicy", assignment: "commandBlockPolicyAssignment" },
  { type: "IP_BLOCK", area: "EPM", label: "IP blocking", policy: "ipBlockPolicy", assignment: "ipBlockPolicyAssignment" },
  { type: "USB_CONTROL", area: "EPM", label: "USB device control", policy: "usbControlPolicy", assignment: "usbControlPolicyAssignment" },
  { type: "SCREENSHOT_BLOCK", area: "EPM", label: "Screenshot blocking", policy: "screenshotBlockPolicy", assignment: "screenshotBlockPolicyAssignment" },
  { type: "DLP", area: "DLP", label: "Content policy", policy: "dlpPolicy", assignment: "dlpPolicyAssignment" },
];

export class PolicyNotApplicableError extends Error {}

// Every enabled pausable policy assigned to this endpoint, directly or through one of its groups.
async function assignedPolicies(agentId: string) {
  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);
  const policyTables = prisma as unknown as Record<string, PolicyTable>;
  const assignmentTables = prisma as unknown as Record<string, AssignmentTable>;
  const where = { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] };

  const perType = await Promise.all(
    PAUSABLE.map(async (t) => {
      const rows = await assignmentTables[t.assignment].findMany({ where, select: { policyId: true } });
      const ids = [...new Set(rows.map((r) => r.policyId))];
      if (ids.length === 0) return [];
      const policies = await policyTables[t.policy].findMany({
        where: { id: { in: ids }, enabled: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      return policies.map((p) => ({ type: t.type, area: t.area, label: t.label, id: p.id, name: p.name }));
    }),
  );
  return perType.flat();
}

export async function listApplicablePolicies(agentId: string): Promise<AgentApplicablePolicy[]> {
  const policies = await assignedPolicies(agentId);
  const requests = await prisma.policyAccessException.findMany({
    where: {
      agentId,
      OR: [{ status: "PENDING" }, { status: "APPROVED", expiresAt: { gt: new Date() } }],
    },
    select: { id: true, policyType: true, policyId: true, status: true, expiresAt: true },
  });

  return policies.map((p) => {
    const mine = requests.filter((r) => r.policyType === p.type && r.policyId === p.id);
    const active = mine.find((r) => r.status === "APPROVED");
    const pending = mine.find((r) => r.status === "PENDING");
    return {
      policyType: p.type,
      policyId: p.id,
      name: p.name,
      area: p.area,
      typeLabel: p.label,
      pausedUntil: active?.expiresAt?.toISOString() ?? null,
      pendingRequestId: pending?.id ?? null,
    };
  });
}

// One request per chosen policy. A policy that already has a pending request or an active
// pause is skipped rather than asked for twice.
export async function createPauseRequests(agentId: string, payload: EndpointPauseRequest): Promise<{ created: number; skipped: number }> {
  const applicable = await listApplicablePolicies(agentId);
  let created = 0;
  let skipped = 0;
  for (const item of payload.items) {
    const policy = applicable.find((p) => p.policyType === item.policyType && p.policyId === item.policyId);
    if (!policy) throw new PolicyNotApplicableError(`That policy doesn't apply to this endpoint.`);
    if (policy.pendingRequestId || policy.pausedUntil) {
      skipped++;
      continue;
    }
    await prisma.policyAccessException.create({
      data: {
        policyType: item.policyType,
        policyId: item.policyId,
        agentId,
        reason: payload.reason,
        durationMinutes: payload.durationMinutes,
        requestedByAdminId: `${ENDPOINT_USER_REQUESTER_PREFIX}${payload.requestedBy}`,
      },
    });
    created++;
  }
  return { created, skipped };
}

// This endpoint's recent requests, whoever raised them (an admin's exceptions for it too).
export async function listPauseRequestsForAgent(agentId: string): Promise<AgentPauseRequestView[]> {
  const rows = await prisma.policyAccessException.findMany({
    where: { agentId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const db = prisma as unknown as Record<string, PolicyTable>;
  const names = new Map<string, string>();
  for (const t of PAUSABLE) {
    const ids = [...new Set(rows.filter((r) => r.policyType === t.type).map((r) => r.policyId))];
    if (ids.length === 0) continue;
    const policies = await db[t.policy].findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    for (const p of policies) names.set(`${t.type}:${p.id}`, p.name);
  }

  return rows.map((r) => ({
    id: r.id,
    policyType: r.policyType as PolicyAccessExceptionType,
    policyName: names.get(`${r.policyType}:${r.policyId}`) ?? "(deleted policy)",
    durationMinutes: r.durationMinutes,
    reason: r.reason,
    status: r.status as AgentPauseRequestView["status"],
    isActive: r.status === "APPROVED" && !!r.expiresAt && r.expiresAt.getTime() > Date.now(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    resolutionNote: r.resolutionNote,
    requestedBy: r.requestedByAdminId.startsWith(ENDPOINT_USER_REQUESTER_PREFIX)
      ? r.requestedByAdminId.slice(ENDPOINT_USER_REQUESTER_PREFIX.length)
      : null,
    createdAt: r.createdAt.toISOString(),
  }));
}
