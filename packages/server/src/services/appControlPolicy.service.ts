import type {
  AllowlistEnforcement,
  AppControlPolicyMode,
  AppControlRuleType,
  MicrosoftSignedOption,
  VersionMatch,
  AssignAppControlPolicyRequest,
  CreateAppControlPolicyRequest,
  CreateAppControlRuleRequest,
  UpdateAppControlPolicyRequest,
  UpdateAppControlRuleRequest,
} from "@em/shared";
import { ALLOWLIST_RULE_TYPES, DEFAULT_MICROSOFT_PRODUCTS, appControlRuleProblem, isAdvancedAppControlRuleType } from "@em/shared";
import type { AppControlPolicy, AppControlRule } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { newAssignmentTargets } from "../utils/assignments";
import { resolveTargetAgentIds } from "./agentTargeting.service";

async function resolveAssignedAgentIdsForPolicy(policyId: string): Promise<string[]> {
  const assignments = await prisma.appControlPolicyAssignment.findMany({ where: { policyId } });
  const agentIds = assignments.filter((a) => a.agentId).map((a) => a.agentId!);
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  return resolveTargetAgentIds(agentIds, groupIds);
}

export class PolicyModeError extends Error {}

// The Microsoft product list a policy uses: its own, or the preset while it hasn't edited it.
export function microsoftProductsOf(p: Pick<AppControlPolicy, "microsoftProducts">): string[] {
  if (!p.microsoftProducts) return [...DEFAULT_MICROSOFT_PRODUCTS];
  try {
    const list = JSON.parse(p.microsoftProducts) as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [...DEFAULT_MICROSOFT_PRODUCTS];
  } catch {
    return [...DEFAULT_MICROSOFT_PRODUCTS];
  }
}

const productsColumn = (list: string[] | null | undefined) =>
  list === undefined ? undefined : list === null ? null : JSON.stringify([...new Set(list.map((x) => x.trim()).filter(Boolean))]);

function allowlistSettingsView(p: AppControlPolicy) {
  return {
    mode: p.mode as AppControlPolicyMode,
    allowlistEnforcement: p.allowlistEnforcement as AllowlistEnforcement,
    allowProgramFiles: p.allowProgramFiles,
    exemptAdministrators: p.exemptAdministrators,
    microsoftSigned: p.microsoftSigned as MicrosoftSignedOption,
    microsoftProducts: microsoftProductsOf(p),
    microsoftProductsCustom: p.microsoftProducts !== null,
  };
}

export function ruleView(r: AppControlRule) {
  return {
    id: r.id,
    ruleType: r.ruleType as AppControlRuleType,
    value: r.value,
    label: r.label,
    productName: r.productName,
    fileName: r.fileName,
    versionMatch: r.versionMatch as VersionMatch | null,
    version: r.version,
    fileSize: r.fileSize === null ? null : Number(r.fileSize),
  };
}

export async function createPolicy(params: CreateAppControlPolicyRequest, createdByAdminId: string) {
  if (params.mode === "ALLOWLIST" && !config.advancedAppControl) {
    throw new PolicyModeError("Allowlist policies need advanced application control, which isn't switched on for this server.");
  }
  const policy = await prisma.appControlPolicy.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      enabled: params.enabled,
      createdByAdminId,
      mode: params.mode,
      // Allowlists block from the start: only Windows, the agent and what the admin allows run.
      allowlistEnforcement: "ENFORCE",
      allowProgramFiles: params.allowProgramFiles ?? false,
      exemptAdministrators: params.exemptAdministrators ?? true,
      microsoftSigned: params.microsoftSigned ?? "OFF",
      microsoftProducts: productsColumn(params.microsoftProducts) ?? null,
    },
  });
  return getPolicy(policy.id);
}

export async function listPolicies() {
  const policies = await prisma.appControlPolicy.findMany({
    orderBy: { createdAt: "asc" },
    include: { events: { select: { id: true } }, rules: { select: { id: true } } },
  });

  return Promise.all(
    policies.map(async (p) => {
      const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(p.id);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        enabled: p.enabled,
        ...allowlistSettingsView(p),
        ruleCount: p.rules.length,
        assignedAgentCount: assignedAgentIds.length,
        eventCount: p.events.length,
        createdAt: p.createdAt.toISOString(),
      };
    }),
  );
}

export async function getPolicy(id: string) {
  const policy = await prisma.appControlPolicy.findUnique({
    where: { id },
    include: { events: { select: { id: true } }, rules: { orderBy: { createdAt: "asc" } } },
  });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(id);
  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    enabled: policy.enabled,
    ...allowlistSettingsView(policy),
    ruleCount: policy.rules.length,
    assignedAgentCount: assignedAgentIds.length,
    eventCount: policy.events.length,
    createdAt: policy.createdAt.toISOString(),
    rules: policy.rules.map(ruleView),
  };
}

export async function updatePolicy(id: string, params: UpdateAppControlPolicyRequest) {
  await prisma.appControlPolicy.update({
    where: { id },
    data: {
      name: params.name,
      description: params.description,
      enabled: params.enabled,
      allowProgramFiles: params.allowProgramFiles,
      exemptAdministrators: params.exemptAdministrators,
      microsoftSigned: params.microsoftSigned,
      microsoftProducts: productsColumn(params.microsoftProducts),
    },
  });
  return getPolicy(id);
}

export async function deletePolicy(id: string): Promise<boolean> {
  try {
    await prisma.appControlPolicy.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export class UnsafeRuleError extends Error {}

// Refuses rules that would stop Windows itself (see @em/shared endpointSafety), and rules that don't
// belong in the policy: an allowlist holds only allow rules; publisher and hash allows only fit there.
async function assertSafe(policyId: string, ruleType: string, value: string) {
  const policy = await prisma.appControlPolicy.findUnique({ where: { id: policyId }, select: { mode: true } });
  if (!policy) throw new UnsafeRuleError("Policy not found");
  if (policy.mode === "ALLOWLIST") {
    if (!(ALLOWLIST_RULE_TYPES as readonly string[]).includes(ruleType)) {
      throw new UnsafeRuleError("An allowlist policy holds allow rules only (path, publisher or hash). To block a program, use a block policy.");
    }
  } else if (ruleType === "ALLOW_PUBLISHER" || ruleType === "ALLOW_HASH") {
    throw new UnsafeRuleError("Publisher and hash allow rules belong in an allowlist policy.");
  }
  if (isAdvancedAppControlRuleType(ruleType) && !config.advancedAppControl) {
    throw new UnsafeRuleError("DLL and Allow rules need advanced application control, which isn't switched on for this server.");
  }
  const problem = appControlRuleProblem(ruleType, value);
  if (problem) throw new UnsafeRuleError(problem);
}

const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;

// Publisher and hash allow rules: the signer in upper case (as Windows writes it), the hash as 64
// upper-case hex, a version when the rule names one.
function allowRuleFields(ruleType: string, value: string, params: Partial<CreateAppControlRuleRequest>) {
  if (ruleType === "ALLOW_HASH") {
    return {
      value: value.trim().replace(/^0x/i, "").toUpperCase(),
      productName: null,
      fileName: params.fileName?.trim() || null,
      versionMatch: null,
      version: null,
      fileSize: params.fileSize ?? null,
    };
  }
  if (ruleType === "ALLOW_PUBLISHER") {
    const versionMatch = params.versionMatch ?? "ANY";
    const version = params.version?.trim() || null;
    if (versionMatch !== "ANY" && (!version || !VERSION_PATTERN.test(version))) {
      throw new UnsafeRuleError("Enter the version as numbers separated by dots, for example 131.0.6778.86.");
    }
    return {
      value: value.trim().toUpperCase(),
      productName: params.productName?.trim() || null,
      fileName: params.fileName?.trim() || null,
      versionMatch,
      version: versionMatch === "ANY" ? null : version,
      fileSize: null,
    };
  }
  if (ruleType === "ALLOW_CATALOG") return { value: value.trim(), productName: null, fileName: null, versionMatch: null, version: null, fileSize: null };
  return { value, productName: null, fileName: null, versionMatch: null, version: null, fileSize: null };
}

export async function addRule(policyId: string, params: CreateAppControlRuleRequest) {
  await assertSafe(policyId, params.ruleType, params.value);
  const fields = allowRuleFields(params.ruleType, params.value, params);
  await prisma.appControlRule.create({
    data: { policyId, ruleType: params.ruleType, label: params.label ?? null, ...fields, fileSize: fields.fileSize === null ? null : BigInt(fields.fileSize) },
  });
  return getPolicy(policyId);
}

export async function updateRule(policyId: string, ruleId: string, params: UpdateAppControlRuleRequest) {
  const current = await prisma.appControlRule.findUnique({ where: { id: ruleId } });
  if (!current) return getPolicy(policyId);
  const ruleType = params.ruleType ?? current.ruleType;
  const value = params.value ?? current.value;
  if (params.value !== undefined || params.ruleType !== undefined) await assertSafe(policyId, ruleType, value);
  const merged: Partial<CreateAppControlRuleRequest> = {
    productName: params.productName !== undefined ? params.productName : current.productName,
    fileName: params.fileName !== undefined ? params.fileName : current.fileName,
    versionMatch: params.versionMatch !== undefined ? params.versionMatch : (current.versionMatch as VersionMatch | null),
    version: params.version !== undefined ? params.version : current.version,
    fileSize: params.fileSize !== undefined ? params.fileSize : current.fileSize === null ? null : Number(current.fileSize),
  };
  const fields = allowRuleFields(ruleType, value, merged);
  await prisma.appControlRule.update({
    where: { id: ruleId },
    data: { ruleType, label: params.label, ...fields, fileSize: fields.fileSize === null ? null : BigInt(fields.fileSize) },
  });
  return getPolicy(policyId);
}

export async function deleteRule(policyId: string, ruleId: string): Promise<boolean> {
  const result = await prisma.appControlRule.deleteMany({ where: { id: ruleId, policyId } });
  return result.count > 0;
}

export async function assignPolicy(policyId: string, params: AssignAppControlPolicyRequest) {
  // Only targets not already assigned - repeat assignments used to add duplicate rows.
  const existing = await prisma.appControlPolicyAssignment.findMany({ where: { policyId }, select: { agentId: true, groupId: true } });
  const fresh = newAssignmentTargets(existing, params.agentIds, params.groupIds);
  if (fresh.agentIds.length + fresh.groupIds.length > 0) {
    await prisma.appControlPolicyAssignment.createMany({
      data: [
        ...fresh.agentIds.map((agentId) => ({ policyId, agentId })),
        ...fresh.groupIds.map((groupId) => ({ policyId, groupId })),
      ],
    });
  }
  return getPolicy(policyId);
}

export async function listAssignments(policyId: string) {
  const assignments = await prisma.appControlPolicyAssignment.findMany({
    where: { policyId },
    include: { agent: true, group: true },
  });
  return assignments.map((a) => ({
    id: a.id,
    agentId: a.agentId,
    hostname: a.agent?.hostname ?? null,
    groupId: a.groupId,
    groupName: a.group?.name ?? null,
  }));
}

export async function unassign(policyId: string, assignmentId: string): Promise<boolean> {
  const result = await prisma.appControlPolicyAssignment.deleteMany({ where: { id: assignmentId, policyId } });
  return result.count > 0;
}

export async function getPolicyAgentBreakdown(policyId: string) {
  const policy = await prisma.appControlPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForPolicy(policyId);
  const agents =
    assignedAgentIds.length > 0
      ? await prisma.agent.findMany({ where: { id: { in: assignedAgentIds } }, include: { inventory: { select: { lastLoggedOnUser: true } } } })
      : [];
  // Each endpoint's own assignment row (a direct one wins over one via a group) holds its sync status.
  const assignments = await prisma.appControlPolicyAssignment.findMany({ where: { policyId }, include: { group: true } });
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  const memberships =
    groupIds.length > 0 && assignedAgentIds.length > 0
      ? await prisma.agentGroupMembership.findMany({ where: { groupId: { in: groupIds }, agentId: { in: assignedAgentIds } }, select: { agentId: true, groupId: true } })
      : [];
  const assignmentForAgent = (agentId: string) =>
    assignments.find((a) => a.agentId === agentId) ??
    assignments.find((a) => a.groupId && memberships.some((m) => m.agentId === agentId && m.groupId === a.groupId)) ??
    null;
  const events = await prisma.appControlEvent.findMany({ where: { policyId }, orderBy: { occurredAt: "desc" } });

  const eventsByAgent = new Map<string, typeof events>();
  for (const e of events) {
    const list = eventsByAgent.get(e.agentId) ?? [];
    list.push(e);
    eventsByAgent.set(e.agentId, list);
  }

  return {
    policyId,
    name: policy.name,
    agents: agents.map((a) => {
      const agentEvents = eventsByAgent.get(a.id) ?? [];
      const assignment = assignmentForAgent(a.id);
      return {
        agentId: a.id,
        hostname: a.hostname,
        groupName: assignment?.group?.name ?? null,
        lastLoggedOnUser: a.inventory?.lastLoggedOnUser ?? null,
        lastSyncedAt: assignment?.lastSyncedAt?.toISOString() ?? null,
        lastSyncStatus: assignment?.lastSyncStatus ?? null,
        lastSyncError: assignment?.lastSyncError ?? null,
        eventCount: agentEvents.length,
        lastEventAt: agentEvents[0]?.occurredAt.toISOString() ?? null,
      };
    }),
  };
}

export async function getEventsForAgent(agentId: string) {
  const events = await prisma.appControlEvent.findMany({
    where: { agentId },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });

  const ruleIds = [...new Set(events.map((e) => e.ruleId).filter((id): id is string => Boolean(id)))];
  const rules = ruleIds.length > 0 ? await prisma.appControlRule.findMany({ where: { id: { in: ruleIds } } }) : [];
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  return events.map((e) => {
    const rule = e.ruleId ? ruleById.get(e.ruleId) : undefined;
    return {
      id: e.id,
      // A rule can be deleted after it produced past events — describe it by its
      // last-known value rather than dropping the match from history.
      ruleLabel: e.ruleId ? rule?.label || rule?.value || "(deleted rule)" : null,
      matchedPath: e.matchedPath,
      processName: e.processName,
      occurredAt: e.occurredAt.toISOString(),
    };
  });
}

// Events tab: one endpoint's blocked programs under this policy, newest first, with the rule
// that matched (described by its last-known value if it has since been deleted).
export async function getPolicyEventsForAgent(policyId: string, agentId: string) {
  const events = await prisma.appControlEvent.findMany({ where: { policyId, agentId }, orderBy: { occurredAt: "desc" }, take: 500 });
  const ruleIds = [...new Set(events.map((e) => e.ruleId).filter((id): id is string => Boolean(id)))];
  const rules = ruleIds.length > 0 ? await prisma.appControlRule.findMany({ where: { id: { in: ruleIds } } }) : [];
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  return events.map((e) => {
    const rule = e.ruleId ? ruleById.get(e.ruleId) : undefined;
    return {
      id: e.id,
      occurredAt: e.occurredAt.toISOString(),
      ruleType: rule?.ruleType ?? null,
      ruleValue: rule?.value ?? null,
      ruleLabel: rule?.label ?? null,
      ruleDeleted: Boolean(e.ruleId) && !rule,
      matchedPath: e.matchedPath,
      processName: e.processName,
    };
  });
}

// Signers Windows has recorded on endpoints (allowlist events), for picking a publisher.
export async function searchSeenSigners(q: string) {
  const rows = await prisma.appControlEvent.groupBy({
    by: ["publisher", "productName"],
    where: { publisher: q.trim() ? { contains: q.trim() } : { not: null } },
    _count: { _all: true },
    orderBy: { _count: { publisher: "desc" } },
    take: 50,
  });
  return rows
    .filter((r) => r.publisher)
    .map((r) => ({ publisher: r.publisher!, productName: r.productName, occurrences: r._count._all }));
}
