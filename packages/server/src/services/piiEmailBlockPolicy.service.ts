import type {
  AssignPiiEmailBlockRequest,
  CreatePiiEmailBlockPolicyRequest,
  CreatePiiEmailBlockRuleRequest,
  MailGuardAgentSettings,
  PiiEmailBlockEventReport,
  PiiEmailBlockPolicyForUserResponse,
  PiiEmailBlockRuleType,
  PiiPatternKey,
  UpdatePiiEmailBlockPolicyRequest,
} from "@em/shared";
import { MAIL_GUARD_CHROME_STORE_ID, MAIL_GUARD_EDGE_STORE_ID } from "@em/shared";
import { prisma } from "../db";
import { browserGuardKeyFor, promptProtectionAppliesTo } from "./aiGuardPrompt.service";

export async function createPolicy(params: CreatePiiEmailBlockPolicyRequest, createdByAdminId: string) {
  const policy = await prisma.piiEmailBlockPolicy.create({
    data: { name: params.name, description: params.description ?? null, enabled: params.enabled, createdByAdminId },
  });
  return getPolicy(policy.id);
}

export async function listPolicies() {
  const policies = await prisma.piiEmailBlockPolicy.findMany({
    orderBy: { createdAt: "asc" },
    include: { rules: { select: { ruleType: true } }, assignments: { select: { id: true } } },
  });

  return policies.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    enabled: p.enabled,
    ruleCount: p.rules.filter((r) => r.ruleType === "PII_PATTERN").length,
    trustedDomainCount: p.rules.filter((r) => r.ruleType === "TRUSTED_DOMAIN").length,
    assignedEmailCount: p.assignments.length,
    createdAt: p.createdAt.toISOString(),
  }));
}

export async function getPolicy(id: string) {
  const policy = await prisma.piiEmailBlockPolicy.findUnique({
    where: { id },
    include: { rules: { orderBy: { createdAt: "asc" } }, assignments: { select: { id: true } } },
  });
  if (!policy) return null;

  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    enabled: policy.enabled,
    ruleCount: policy.rules.filter((r) => r.ruleType === "PII_PATTERN").length,
    trustedDomainCount: policy.rules.filter((r) => r.ruleType === "TRUSTED_DOMAIN").length,
    assignedEmailCount: policy.assignments.length,
    createdAt: policy.createdAt.toISOString(),
    rules: policy.rules.map((r) => ({
      id: r.id,
      ruleType: r.ruleType as PiiEmailBlockRuleType,
      value: r.value,
      label: r.label,
    })),
  };
}

export async function updatePolicy(id: string, params: UpdatePiiEmailBlockPolicyRequest) {
  await prisma.piiEmailBlockPolicy.update({
    where: { id },
    data: { name: params.name, description: params.description, enabled: params.enabled },
  });
  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  try {
    await prisma.piiEmailBlockPolicy.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

// Adding a category or domain the policy already has is a no-op.
export async function addRule(policyId: string, params: CreatePiiEmailBlockRuleRequest) {
  const existing = await prisma.piiEmailBlockRule.findFirst({ where: { policyId, ruleType: params.ruleType, value: params.value } });
  if (existing) return getPolicy(policyId);
  await prisma.piiEmailBlockRule.create({
    data: { policyId, ruleType: params.ruleType, value: params.value, label: params.label ?? null },
  });
  return getPolicy(policyId);
}

export async function deleteRule(policyId: string, ruleId: string): Promise<boolean> {
  const result = await prisma.piiEmailBlockRule.deleteMany({ where: { id: ruleId, policyId } });
  return result.count > 0;
}

// Upserts each address so re-assigning an already-assigned email is a harmless no-op
// (same idempotent-loop shape as assetGroup.service.ts's addGroupMembers) rather than a
// duplicate-row or unique-constraint error.
export async function assign(policyId: string, params: AssignPiiEmailBlockRequest): Promise<void> {
  const existing = await prisma.piiEmailBlockAssignment.findMany({
    where: { policyId, emailAddress: { in: params.emailAddresses } },
    select: { emailAddress: true },
  });
  const already = new Set(existing.map((e) => e.emailAddress));
  const toCreate = params.emailAddresses.filter((e) => !already.has(e));
  if (toCreate.length > 0) {
    await prisma.piiEmailBlockAssignment.createMany({
      data: toCreate.map((emailAddress) => ({ policyId, emailAddress })),
    });
  }
}

export async function listAssignments(policyId: string) {
  const assignments = await prisma.piiEmailBlockAssignment.findMany({
    where: { policyId },
    orderBy: { emailAddress: "asc" },
  });
  return assignments.map((a) => ({
    id: a.id,
    emailAddress: a.emailAddress,
    createdAt: a.createdAt.toISOString(),
  }));
}

export async function unassign(policyId: string, assignmentId: string): Promise<boolean> {
  const result = await prisma.piiEmailBlockAssignment.deleteMany({ where: { id: assignmentId, policyId } });
  return result.count > 0;
}

// Public, unauthenticated lookup called from inside the Outlook add-in's sandboxed JS
// runtime — Office.js hands the add-in the signed-in user's own email address directly, so
// this is trusted the same way the agent trusts its own hostname at enrollment time. Pattern
// keys are flat and deduped across every ENABLED policy assigned to that address; a disabled
// policy's rules never apply, matching every other policy module in this product.
//
// Trusted domains are the ones every one of those policies trusts (only policies that check at
// least one category count), so one policy's trusted domain can't switch off another policy's
// checks. With a single policy per mailbox, the usual case, that is simply its own list.
export async function getPolicyForEmail(emailAddress: string): Promise<PiiEmailBlockPolicyForUserResponse> {
  const normalized = emailAddress.trim().toLowerCase();
  const assignments = await prisma.piiEmailBlockAssignment.findMany({
    where: { emailAddress: normalized },
    select: { policyId: true },
  });
  const policyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (policyIds.length === 0) return { patternKeys: [], trustedDomains: [] };

  const policies = await prisma.piiEmailBlockPolicy.findMany({
    where: { id: { in: policyIds }, enabled: true },
    include: { rules: true },
  });

  const checking = policies
    .map((p) => ({
      keys: p.rules.filter((r) => r.ruleType === "PII_PATTERN").map((r) => r.value as PiiPatternKey),
      domains: p.rules.filter((r) => r.ruleType === "TRUSTED_DOMAIN").map((r) => r.value),
    }))
    .filter((p) => p.keys.length > 0);
  if (checking.length === 0) return { patternKeys: [], trustedDomains: [] };

  const patternKeys = [...new Set(checking.flatMap((p) => p.keys))];
  const trustedDomains = [...new Set(checking[0].domains)].filter((d) => checking.every((p) => p.domains.includes(d)));
  return { patternKeys, trustedDomains };
}

// Whether agents should install the Mail Guard browser extension: only while some enabled
// policy with at least one category has a mailbox assigned. The extension then checks per mailbox.
// What the agent applies for the Browser Guard extension: install it while email attachment blocking
// is in use, or while AI Guard prompt protection applies to this endpoint; and the endpoint id/key the
// extension uses for AI Guard (aiGuardPrompt.service.ts).
export async function mailGuardAgentSettings(agentId: string): Promise<MailGuardAgentSettings> {
  const active = await prisma.piiEmailBlockPolicy.count({
    where: { enabled: true, assignments: { some: {} }, rules: { some: { ruleType: "PII_PATTERN" } } },
  });
  const aiPrompt = await promptProtectionAppliesTo(agentId);
  return {
    install: active > 0 || aiPrompt,
    chromeExtensionId: MAIL_GUARD_CHROME_STORE_ID,
    edgeExtensionId: MAIL_GUARD_EDGE_STORE_ID,
    endpointId: agentId,
    endpointKey: browserGuardKeyFor(agentId),
  };
}

// Best-effort append from the add-in after every send it evaluated. Deliberately tolerant
// of an email with no matching policy/assignment (policyId left null) — the add-in reports
// every evaluated send, not just ones a currently-active policy covers (e.g. a policy could
// be unassigned/deleted between the add-in's last policy fetch and this report).
export async function recordEvent(payload: PiiEmailBlockEventReport): Promise<void> {
  const normalized = payload.senderEmail.trim().toLowerCase();
  const assignment = await prisma.piiEmailBlockAssignment.findFirst({
    where: { emailAddress: normalized },
    select: { policyId: true },
  });

  await prisma.piiEmailBlockEvent.create({
    data: {
      policyId: assignment?.policyId ?? null,
      senderEmail: normalized,
      attachmentName: payload.attachmentName,
      action: payload.action,
      matchedCategoryLabels: JSON.stringify(payload.matchedCategoryLabels),
    },
  });
}

export async function listEvents(policyId?: string) {
  const events = await prisma.piiEmailBlockEvent.findMany({
    where: policyId ? { policyId } : undefined,
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
  return events.map((e) => ({
    id: e.id,
    policyId: e.policyId,
    senderEmail: e.senderEmail,
    attachmentName: e.attachmentName,
    action: e.action,
    matchedCategoryLabels: JSON.parse(e.matchedCategoryLabels) as string[],
    occurredAt: e.occurredAt.toISOString(),
  }));
}
