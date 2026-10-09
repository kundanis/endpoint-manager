import type { CreatePolicyAccessExceptionRequest, PolicyAccessExceptionType } from "@em/shared";
import { prisma } from "../db";

export class AgentNotFoundError extends Error {}
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

export async function createRequest(params: CreatePolicyAccessExceptionRequest, requestedByAdminId: string) {
  const agent = await prisma.agent.findUnique({ where: { id: params.agentId }, select: { id: true } });
  if (!agent) throw new AgentNotFoundError();

  const policyName = await getPolicyName(params.policyType, params.policyId);
  if (!policyName) throw new PolicyNotFoundError();

  const request = await prisma.policyAccessException.create({
    data: {
      policyType: params.policyType,
      policyId: params.policyId,
      agentId: params.agentId,
      reason: params.reason,
      durationMinutes: params.durationMinutes,
      requestedByAdminId,
    },
  });
  return serialize(request, policyName);
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
      expiresAt: new Date(now.getTime() + existing.durationMinutes * 60 * 1000),
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
