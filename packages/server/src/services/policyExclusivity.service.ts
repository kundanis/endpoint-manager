import { prisma } from "../db";
import { effectiveMembershipsOf, groupTree, membersOfGroups, withAncestors, withDescendants } from "./groupTree.service";

// One policy per endpoint in each allow/block module: an endpoint may be covered - directly or
// through any of its groups - by at most one policy of Application control, Web blocking,
// Command blocking, IP blocking, USB control, Screenshot blocking, PII blocking, DLP content,
// Threat protection or AI Guard. Two policies of one of these could disagree about the same thing
// (one allows ChatGPT, the other blocks it), so a second one is refused at assignment time, and
// so is adding an endpoint to a group that would bring it a second one.
//
// Modules where several policies are meant to add up (Zero Trust, security benchmarks, data
// discovery, data movement, screen capture) are not limited. Assignments made before this rule
// existed are left as they are; the endpoint's Applied Policies card flags them.

export type ExclusiveModule =
  | "APP_CONTROL"
  | "WEB_BLOCK"
  | "COMMAND_BLOCK"
  | "IP_BLOCK"
  | "USB_CONTROL"
  | "SCREENSHOT_BLOCK"
  | "PII_BLOCK"
  | "DLP"
  | "THREAT_PROTECTION"
  | "AI_GUARD";

const MODULES: Record<ExclusiveModule, { label: string; assignment: string; policy: string }> = {
  APP_CONTROL: { label: "Application control", assignment: "appControlPolicyAssignment", policy: "appControlPolicy" },
  WEB_BLOCK: { label: "Web blocking", assignment: "webBlockPolicyAssignment", policy: "webBlockPolicy" },
  COMMAND_BLOCK: { label: "Command blocking", assignment: "commandBlockPolicyAssignment", policy: "commandBlockPolicy" },
  IP_BLOCK: { label: "IP blocking", assignment: "ipBlockPolicyAssignment", policy: "ipBlockPolicy" },
  USB_CONTROL: { label: "USB control", assignment: "usbControlPolicyAssignment", policy: "usbControlPolicy" },
  SCREENSHOT_BLOCK: { label: "Screenshot blocking", assignment: "screenshotBlockPolicyAssignment", policy: "screenshotBlockPolicy" },
  PII_BLOCK: { label: "PII blocking", assignment: "piiBlockPolicyAssignment", policy: "piiBlockPolicy" },
  DLP: { label: "DLP content", assignment: "dlpPolicyAssignment", policy: "dlpPolicy" },
  THREAT_PROTECTION: { label: "Threat protection", assignment: "threatProtectionPolicyAssignment", policy: "threatProtectionPolicy" },
  AI_GUARD: { label: "AI Guard", assignment: "aiGuardPolicyAssignment", policy: "aiGuardPolicy" },
};

export class PolicyConflictError extends Error {}

type AssignmentTable = { findMany(args: object): Promise<{ policyId: string; agentId: string | null; groupId: string | null }[]> };
type PolicyTable = { findMany(args: object): Promise<{ id: string; name: string }[]> };
const assignmentTables = prisma as unknown as Record<string, AssignmentTable>;
const policyTables = prisma as unknown as Record<string, PolicyTable>;

const MAX_LISTED = 5;

function fail(lines: string[], tail: string): never {
  const shown = lines.slice(0, MAX_LISTED);
  const more = lines.length > MAX_LISTED ? ` (and ${lines.length - MAX_LISTED} more)` : "";
  throw new PolicyConflictError(`${shown.join("; ")}${more}. ${tail}`);
}

// Every assignment of a module, plus policy names and group membership, for the checks below.
async function load(module: ExclusiveModule) {
  const def = MODULES[module];
  const rows = await assignmentTables[def.assignment].findMany({ select: { policyId: true, agentId: true, groupId: true } });
  const policies = await policyTables[def.policy].findMany({ where: { id: { in: [...new Set(rows.map((r) => r.policyId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(policies.map((p) => [p.id, p.name]));
  return { def, rows, nameOf: (id: string) => `"${nameOf.get(id) ?? "a deleted policy"}"` };
}

async function membershipsOf(agentIds: string[]) {
  if (agentIds.length === 0) return new Map<string, string[]>();
  const rows = await effectiveMembershipsOf(agentIds);
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.agentId, [...(out.get(r.agentId) ?? []), r.groupId]);
  return out;
}

async function hostnames(agentIds: string[]) {
  const agents = agentIds.length ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, hostname: true } }) : [];
  return new Map(agents.map((a) => [a.id, a.hostname]));
}

async function groupNames(groupIds: string[]) {
  const groups = groupIds.length ? await prisma.assetGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } }) : [];
  return new Map(groups.map((g) => [g.id, g.name]));
}

// Before assigning `policyId` to these endpoints and groups: none of them (nor any member of the
// groups) may already be covered by another policy of the same module.
export async function assertAssignable(module: ExclusiveModule, policyId: string, agentIds: string[], groupIds: string[]): Promise<void> {
  if (agentIds.length === 0 && groupIds.length === 0) return;
  const { def, rows, nameOf } = await load(module);
  const others = rows.filter((r) => r.policyId !== policyId);
  if (others.length === 0) return;

  const conflicts: string[] = [];
  const gName = await groupNames(groupIds);
  // A group can't hold two policies of the module, even before it has members - nor get one while
  // a group above it or below it has another (the members below would have both).
  for (const groupId of groupIds) {
    const held = others.find((r) => r.groupId === groupId);
    if (held) {
      conflicts.push(`group "${gName.get(groupId) ?? groupId}" already has ${def.label} policy ${nameOf(held.policyId)}`);
      continue;
    }
    const above = await withAncestors([groupId]);
    const below = await withDescendants([groupId]);
    const related = others.find((r) => r.groupId !== null && (above.has(r.groupId) || below.has(r.groupId)));
    if (related) {
      const where = above.has(related.groupId!) ? "a group above it" : "a group below it";
      const name = (await groupNames([related.groupId!])).get(related.groupId!) ?? related.groupId;
      conflicts.push(`group "${gName.get(groupId) ?? groupId}" is under the same tree as group "${name}" (${where}), which already has ${def.label} policy ${nameOf(related.policyId)}`);
    }
  }

  // Every endpoint the assignment reaches: the endpoints themselves and the groups' members.
  const members = groupIds.length
    ? await membersOfGroups(groupIds)
    : [];
  const reached = [...new Set([...agentIds, ...members.map((m) => m.agentId)])];
  const groupsOf = await membershipsOf(reached);
  const host = await hostnames(reached);
  for (const agentId of reached) {
    const mine = new Set(groupsOf.get(agentId) ?? []);
    const held = others.find((r) => r.agentId === agentId || (r.groupId !== null && mine.has(r.groupId)));
    if (held) conflicts.push(`${host.get(agentId) ?? agentId} already has ${def.label} policy ${nameOf(held.policyId)}`);
  }

  if (conflicts.length > 0) fail(conflicts, `An endpoint can have only one ${def.label} policy - remove the other assignment first.`);
}

// Before an endpoint's groups change from `currentGroupIds` to `groupIds`: in no module may its
// direct policies and its groups' policies add up to more than one policy. A conflict the
// endpoint already had (from before this rule) doesn't block a change that doesn't add to it -
// otherwise it couldn't even leave a group to resolve it.
async function assertGroupsAllowed(agentId: string, currentGroupIds: string[], groupIds: string[], hostname: string, gName: Map<string, string>) {
  const conflicts: string[] = [];
  const groups = new Set(groupIds);
  const before = new Set(currentGroupIds);
  for (const module of Object.keys(MODULES) as ExclusiveModule[]) {
    const { def, rows, nameOf } = await load(module);
    const covering = rows.filter((r) => r.agentId === agentId || (r.groupId !== null && groups.has(r.groupId)));
    const distinct = [...new Set(covering.map((r) => r.policyId))];
    const had = new Set(rows.filter((r) => r.agentId === agentId || (r.groupId !== null && before.has(r.groupId))).map((r) => r.policyId));
    if (distinct.length > 1 && distinct.some((id) => !had.has(id))) {
      const via = (policyId: string) => {
        const r = covering.find((c) => c.policyId === policyId)!;
        return r.agentId ? "assigned directly" : `through group "${gName.get(r.groupId!) ?? r.groupId}"`;
      };
      conflicts.push(`${hostname} would have two ${def.label} policies: ${distinct.map((id) => `${nameOf(id)} (${via(id)})`).join(" and ")}`);
    }
  }
  if (conflicts.length > 0) fail(conflicts, "Remove one of the assignments first.");
}

// Adding endpoints to a group.
export async function assertCanJoinGroup(groupId: string, agentIds: string[]): Promise<void> {
  if (agentIds.length === 0) return;
  const groupsOf = await membershipsOf(agentIds);
  const host = await hostnames(agentIds);
  const allGroupIds = [...new Set([groupId, ...[...groupsOf.values()].flat()])];
  const gName = await groupNames(allGroupIds);
  // Joining a sub group also brings the policies of every group above it.
  const joining = [...(await withAncestors([groupId]))];
  const gNameAll = await groupNames([...new Set([...allGroupIds, ...joining])]);
  for (const agentId of agentIds) {
    const current = groupsOf.get(agentId) ?? [];
    if (current.includes(groupId)) continue;
    await assertGroupsAllowed(agentId, current, [...new Set([...current, ...joining])], host.get(agentId) ?? agentId, gNameAll.size ? gNameAll : gName);
  }
}

// Moving a group (with its sub groups and endpoints) under another group, or to the top: the
// endpoints below it lose the policies of the groups it leaves and get those of the groups above
// its new place - in no module may that add up to two policies.
export async function assertCanMoveGroup(groupId: string, newParentId: string | null): Promise<void> {
  const { parentOf } = await groupTree();
  const simulated = new Map(parentOf);
  simulated.set(groupId, newParentId);
  const ancestorsIn = (tree: Map<string, string | null>, ids: string[]) => {
    const out = new Set<string>();
    for (const id of ids) {
      let at: string | null | undefined = id;
      for (let depth = 0; at && !out.has(at) && depth < 100; depth++) {
        out.add(at);
        at = tree.get(at);
      }
    }
    return out;
  };
  const subtree = await withDescendants([groupId]);
  const direct = await prisma.agentGroupMembership.findMany({ where: { groupId: { in: [...subtree] } }, select: { agentId: true } });
  const agentIds = [...new Set(direct.map((d) => d.agentId))];
  const allDirect = agentIds.length ? await prisma.agentGroupMembership.findMany({ where: { agentId: { in: agentIds } }, select: { agentId: true, groupId: true } }) : [];
  const directOf = new Map<string, string[]>();
  for (const m of allDirect) directOf.set(m.agentId, [...(directOf.get(m.agentId) ?? []), m.groupId]);
  const host = await hostnames(agentIds);
  const gName = await groupNames([...simulated.keys()]);
  for (const agentId of agentIds) {
    const groups = directOf.get(agentId) ?? [];
    const before = [...ancestorsIn(parentOf, groups)];
    const after = [...ancestorsIn(simulated, groups)];
    await assertGroupsAllowed(agentId, before, after, host.get(agentId) ?? agentId, gName);
  }
  // Groups without endpoints yet: a policy on the subtree and another on the new groups above.
  if (newParentId) {
    const newAbove = ancestorsIn(simulated, [newParentId]);
    const conflicts: string[] = [];
    for (const module of Object.keys(MODULES) as ExclusiveModule[]) {
      const { def, rows, nameOf } = await load(module);
      const onSubtree = rows.filter((r) => r.groupId !== null && subtree.has(r.groupId));
      const onAbove = rows.filter((r) => r.groupId !== null && newAbove.has(r.groupId));
      const clash = onSubtree.find((a) => onAbove.some((b) => b.policyId !== a.policyId));
      if (clash) {
        const other = onAbove.find((b) => b.policyId !== clash.policyId)!;
        conflicts.push(`group "${gName.get(clash.groupId!) ?? clash.groupId}" has ${def.label} policy ${nameOf(clash.policyId)} and group "${gName.get(other.groupId!) ?? other.groupId}" above its new place has ${nameOf(other.policyId)}`);
      }
    }
    if (conflicts.length > 0) fail(conflicts, "Remove one of the assignments first.");
  }
}

// Replacing an endpoint's whole group list.
export async function assertCanSetGroups(agentId: string, groupIds: string[]): Promise<void> {
  const host = await hostnames([agentId]);
  const current = (await membershipsOf([agentId])).get(agentId) ?? [];
  // The new groups and every group above them.
  const next = [...(await withAncestors(groupIds))];
  await assertGroupsAllowed(agentId, current, next, host.get(agentId) ?? agentId, await groupNames([...new Set([...next, ...current])]));
}
