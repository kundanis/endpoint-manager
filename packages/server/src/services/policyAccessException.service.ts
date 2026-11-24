import type { CreatePolicyAccessExceptionRequest, PolicyAccessExceptionType } from "@em/shared";
import { prisma } from "../db";
import { membersOfGroups } from "./groupTree.service";
import { PERMANENT_PAUSE_MINUTES, PERMANENT_PAUSE_UNTIL } from "@em/shared";

export class AgentNotFoundError extends Error {}
export class GroupNotFoundError extends Error {}
export class GroupEmptyError extends Error {}
export class PolicyNotFoundError extends Error {}
export class RequestNotFoundError extends Error {}
export class RequestAlreadyResolvedError extends Error {}
export class SelfApprovalError extends Error {}

async function getPolicyName(policyType: PolicyAccessExceptionType, policyId: string): Promise<string | null> {
  switch (policyType) {
    case "APP_CONTROL":
      return (await prisma.appControlPolicy.findUnique({ where: { id: policyId }, select: { name: true } }))?.name ?? null;
    case "WEB_BLOCK":
      return (await prisma.webBlockPolicy.findUnique({ where: { id: policyId }, select: { name: true } }))?.name ?? null;
    case "COMMAND_BLOCK":
      return (await prisma.commandBlockPolicy.findUnique({ where: { id: policyId }, select: { name: true } }))?.name ?? null;
    case "IP_BLOCK":
      return (await prisma.ipBlockPolicy.findUnique({ where: { id: policyId }, select: { name: true } }))?.name ?? null;
    case "USB_CONTROL":
      return (await prisma.usbControlPolicy.findUnique({ where: { id: policyId }, select: { name: true } }))?.name ?? null;
    case "DLP":
      return (await prisma.dlpPolicy.findUnique({ where: { id: policyId }, select: { name: true } }))?.name ?? null;
    case "SCREENSHOT_BLOCK":
      return (await prisma.screenshotBlockPolicy.findUnique({ where: { id: policyId }, select: { name: true } }))?.name ?? null;
    case "AI_GUARD":
      return (await prisma.aiGuardPolicy.findUnique({ where: { id: policyId }, select: { name: true } }))?.name ?? null;
  }
}

// The single choke point every EPM/DLP "resolve assigned rules for this agent" function
// calls through before applying a policy — so a live, approved, unexpired exception loosens
// enforcement transparently, with no agent-side awareness of exceptions needed at all.
export async function isPolicyExcepted(policyType: PolicyAccessExceptionType, policyId: string, agentId: string): Promise<boolean> {
  const active = await prisma.policyAccessException.findFirst({
    where: { policyType, policyId, agentId, status: "APPROVED", expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return active !== null;
}

// One endpoint, or every endpoint in a group: a group request becomes one request per endpoint
// (exceptions are enforced per endpoint), each approved, rejected or ended on its own.
export async function createRequest(params: CreatePolicyAccessExceptionRequest, requestedByAdminId: string) {
  let agentIds: string[];
  if (params.groupId) {
    const group = await prisma.assetGroup.findUnique({ where: { id: params.groupId }, select: { id: true } });
    if (!group) throw new GroupNotFoundError();
    agentIds = (await membersOfGroups([params.groupId])).map((m) => m.agentId);
    if (agentIds.length === 0) throw new GroupEmptyError();
  } else {
    const agent = await prisma.agent.findUnique({ where: { id: params.agentId! }, select: { id: true } });
    if (!agent) throw new AgentNotFoundError();
    agentIds = [agent.id];
  }

  const policyName = await getPolicyName(params.policyType, params.policyId);
  if (!policyName) throw new PolicyNotFoundError();

  const requests = await prisma.$transaction(
    agentIds.map((agentId) =>
      prisma.policyAccessException.create({
        data: {
          policyType: params.policyType,
          policyId: params.policyId,
          agentId,
          reason: params.reason,
          durationMinutes: params.durationMinutes,
          requestedByAdminId,
        },
      }),
    ),
  );
  return { created: requests.length, requests: requests.map((r) => serialize(r, policyName)) };
}

export async function listRequests() {
  const requests = await prisma.policyAccessException.findMany({
    orderBy: { createdAt: "desc" },
    include: { agent: { select: { hostname: true } } },
  });

  return Promise.all(
    requests.map(async (r) => serialize(r, await getPolicyName(r.policyType as PolicyAccessExceptionType, r.policyId), r.agent.hostname),
    ),
  );
}

export async function approveRequest(id: string, approvedByAdminId: string, resolutionNote?: string | null) {
  const existing = await prisma.policyAccessException.findUnique({ where: { id } });
  if (!existing) throw new RequestNotFoundError();
  if (existing.status !== "PENDING") throw new RequestAlreadyResolvedError();
  // Four-eyes: an exception loosens security enforcement, so whoever asked for it can't also
  // grant it — unless this deployment has only one admin account, where nobody else could.
  // (Rejecting your own request is still allowed: that's just withdrawing it.)
  if (existing.requestedByAdminId === approvedByAdminId && (await prisma.adminUser.count()) > 1) {
    throw new SelfApprovalError();
  }

  const now = new Date();
  const request = await prisma.policyAccessException.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedByAdminId,
      resolvedAt: now,
      resolutionNote: resolutionNote ?? null,
      // A permanent pause (asked for from the endpoint) lasts until an administrator ends it.
      expiresAt: existing.durationMinutes === PERMANENT_PAUSE_MINUTES ? new Date(PERMANENT_PAUSE_UNTIL) : new Date(now.getTime() + existing.durationMinutes * 60 * 1000),
    },
  });
  return serialize(request, await getPolicyName(request.policyType as PolicyAccessExceptionType, request.policyId));
}

export async function rejectRequest(id: string, approvedByAdminId: string, resolutionNote?: string | null) {
  const existing = await prisma.policyAccessException.findUnique({ where: { id } });
  if (!existing) throw new RequestNotFoundError();
  if (existing.status !== "PENDING") throw new RequestAlreadyResolvedError();

  const request = await prisma.policyAccessException.update({
    where: { id },
    data: { status: "REJECTED", approvedByAdminId, resolvedAt: new Date(), resolutionNote: resolutionNote ?? null },
  });
  return serialize(request, await getPolicyName(request.policyType as PolicyAccessExceptionType, request.policyId));
}

export class RequestNotActiveError extends Error {}

// Ends an active exception before its time is up: the policy applies again at the endpoint's next
// sync (about 20 seconds). Any admin can end one - it only tightens security again.
export async function endRequest(id: string, resolutionNote?: string | null) {
  const existing = await prisma.policyAccessException.findUnique({ where: { id } });
  if (!existing) throw new RequestNotFoundError();
  if (existing.status !== "APPROVED" || !existing.expiresAt || existing.expiresAt.getTime() <= Date.now()) throw new RequestNotActiveError();

  const request = await prisma.policyAccessException.update({
    where: { id },
    data: {
      status: "ENDED",
      expiresAt: new Date(),
      resolutionNote: [existing.resolutionNote, resolutionNote ? `Ended early: ${resolutionNote}` : "Ended early"].filter(Boolean).join(" · ").slice(0, 1000),
    },
  });
  return serialize(request, await getPolicyName(request.policyType as PolicyAccessExceptionType, request.policyId));
}

function serialize(
  r: {
    id: string;
    policyType: string;
    policyId: string;
    agentId: string;
    reason: string;
    durationMinutes: number;
    status: string;
    requestedByAdminId: string;
    approvedByAdminId: string | null;
    resolvedAt: Date | null;
    resolutionNote: string | null;
    expiresAt: Date | null;
    createdAt: Date;
  },
  policyName: string | null,
  hostname?: string,
) {
  const isActive = r.status === "APPROVED" && !!r.expiresAt && r.expiresAt.getTime() > Date.now();
  return {
    id: r.id,
    policyType: r.policyType,
    policyId: r.policyId,
    policyName: policyName ?? "(deleted policy)",
    agentId: r.agentId,
    hostname: hostname ?? null,
    reason: r.reason,
    durationMinutes: r.durationMinutes,
    status: r.status,
    isActive,
    requestedByAdminId: r.requestedByAdminId,
    approvedByAdminId: r.approvedByAdminId,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolutionNote: r.resolutionNote,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
