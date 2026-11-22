import type { PolicyAccessExceptionType } from "@em/shared";
import { prisma } from "../db";
import { isAgentPaused } from "./pause.service";

// Every policy assigned to one endpoint, directly or through one of its groups, for the
// endpoint's Overview. Each entry says how it reaches the endpoint, whether it's in force here
// (enabled, not paused, no approved access exception) and the last sync the agent reported.

export interface AppliedPolicy {
  module: string; // e.g. "Application control"
  navPath: string; // the sidebar item; the console hides modules the admin can't see
  link: string; // opens this policy
  policyId: string;
  name: string;
  enabled: boolean;
  detail: string | null; // e.g. "Allowlist", "Block only"
  direct: boolean; // assigned to this endpoint itself
  groups: { id: string; name: string }[]; // and/or through these groups
  excepted: boolean; // an approved access exception lifts it on this endpoint right now
  // This endpoint's own sync (direct assignments only: a group's row is shared by its members).
  syncStatus: string | null; // SUCCESS | FAILED | null
  lastSyncedAt: string | null;
  syncError: string | null;
}

interface AssignmentRow {
  policyId: string;
  agentId: string | null;
  groupId: string | null;
  lastSyncedAt?: Date | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  policy: { id: string; name: string; enabled?: boolean; mode?: string; enforcementMode?: string };
}

type Finder = (where: object) => Promise<AssignmentRow[]>;
const policySelect = { select: { id: true, name: true, enabled: true } };

interface ModuleDef {
  module: string;
  navPath: string;
  link: (policyId: string) => string;
  exceptionType?: PolicyAccessExceptionType;
  find: Finder;
  detail?: (p: AssignmentRow["policy"]) => string | null;
}

const withPolicy = (link: string) => (id: string) => `${link}?policy=${encodeURIComponent(id)}`;

const MODULES: ModuleDef[] = [
  {
    module: "Zero Trust",
    navPath: "/zero-trust",
    link: withPolicy("/zero-trust"),
    find: (where) => prisma.zeroTrustPolicyAssignment.findMany({ where, include: { policy: policySelect } }),
  },
  {
    module: "Security configuration",
    navPath: "/security-config",
    link: (id) => `/security-config?benchmark=${encodeURIComponent(id)}`,
    find: async (where) =>
      (
        await prisma.securityBenchmarkAssignment.findMany({ where, include: { benchmark: { select: { id: true, name: true } } } })
      ).map((a) => ({ policyId: a.benchmarkId, agentId: a.agentId, groupId: a.groupId, policy: a.benchmark })),
  },
  {
    module: "Data discovery",
    navPath: "/data-discovery",
    link: withPolicy("/data-discovery"),
    find: (where) => prisma.dataDiscoveryPolicyAssignment.findMany({ where, include: { policy: policySelect } }),
  },
  {
    module: "DLP content",
    navPath: "/dlp",
    link: withPolicy("/dlp/content-policies"),
    exceptionType: "DLP",
    find: (where) =>
      prisma.dlpPolicyAssignment.findMany({ where, include: { policy: { select: { id: true, name: true, enabled: true, enforcementMode: true } } } }),
    detail: (p) => (p.enforcementMode === "BLOCK" ? "Blocks" : p.enforcementMode ? "Alert only" : null),
  },
  {
    module: "PII data blocking",
    navPath: "/dlp",
    link: withPolicy("/dlp/pii-block"),
    find: (where) => prisma.piiBlockPolicyAssignment.findMany({ where, include: { policy: policySelect } }),
  },
  {
    module: "Data movement",
    navPath: "/data-movement",
    link: withPolicy("/data-movement/files"),
    find: (where) => prisma.dataMovementPolicyAssignment.findMany({ where, include: { policy: policySelect } }),
  },
  {
    module: "Screen capture",
    navPath: "/data-movement",
    link: withPolicy("/data-movement/screen-capture"),
    find: (where) => prisma.screenCapturePolicyAssignment.findMany({ where, include: { policy: policySelect } }),
  },
  {
    module: "Application control",
    navPath: "/epm",
    link: withPolicy("/epm/app-control"),
    exceptionType: "APP_CONTROL",
    find: (where) =>
      prisma.appControlPolicyAssignment.findMany({ where, include: { policy: { select: { id: true, name: true, enabled: true, mode: true } } } }),
    detail: (p) => (p.mode === "ALLOWLIST" ? "Allowlist" : "Block list"),
  },
  {
    module: "Web blocking",
    navPath: "/epm",
    link: withPolicy("/epm/web-block"),
    exceptionType: "WEB_BLOCK",
    find: (where) => prisma.webBlockPolicyAssignment.findMany({ where, include: { policy: policySelect } }),
  },
  {
    module: "Command blocking",
    navPath: "/epm",
    link: withPolicy("/epm/command-block"),
    exceptionType: "COMMAND_BLOCK",
    find: (where) =>
      prisma.commandBlockPolicyAssignment.findMany({
        where,
        include: { policy: { select: { id: true, name: true, enabled: true, enforcementMode: true } } },
      }),
    detail: (p) => (p.enforcementMode === "BLOCK" ? "Blocks" : p.enforcementMode ? "Alert only" : null),
  },
  {
    module: "IP blocking",
    navPath: "/epm",
    link: withPolicy("/epm/ip-block"),
    exceptionType: "IP_BLOCK",
    find: (where) => prisma.ipBlockPolicyAssignment.findMany({ where, include: { policy: policySelect } }),
  },
  {
    module: "USB control",
    navPath: "/epm",
    link: withPolicy("/epm/usb-control"),
    exceptionType: "USB_CONTROL",
    find: (where) => prisma.usbControlPolicyAssignment.findMany({ where, include: { policy: policySelect } }),
  },
  {
    module: "Screenshot blocking",
    navPath: "/epm",
    link: withPolicy("/epm/screenshot-block"),
    exceptionType: "SCREENSHOT_BLOCK",
    find: (where) => prisma.screenshotBlockPolicyAssignment.findMany({ where, include: { policy: policySelect } }),
  },
  {
    module: "Threat protection",
    navPath: "/threat-protection/policies",
    link: withPolicy("/threat-protection/policies"),
    find: (where) => prisma.threatProtectionPolicyAssignment.findMany({ where, include: { policy: policySelect } }),
  },
];

export async function getAppliedPolicies(agentId: string): Promise<{ paused: boolean; policies: AppliedPolicy[] }> {
  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, include: { group: { select: { id: true, name: true } } } });
  const groupName = new Map(memberships.map((m) => [m.groupId, m.group.name]));
  const groupIds = [...groupName.keys()];
  const where = { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] };

  const [paused, exceptions, perModule] = await Promise.all([
    isAgentPaused(agentId),
    prisma.policyAccessException.findMany({
      where: { agentId, status: "APPROVED", expiresAt: { gt: new Date() } },
      select: { policyType: true, policyId: true },
    }),
    Promise.all(MODULES.map((m) => m.find(where))),
  ]);
  const excepted = new Set(exceptions.map((e) => `${e.policyType}|${e.policyId}`));

  const out: AppliedPolicy[] = [];
  MODULES.forEach((m, i) => {
    const byPolicy = new Map<string, AssignmentRow[]>();
    for (const a of perModule[i]) byPolicy.set(a.policyId, [...(byPolicy.get(a.policyId) ?? []), a]);
    for (const [policyId, rows] of byPolicy) {
      const policy = rows[0].policy;
      const direct = rows.find((r) => r.agentId === agentId);
      const groups = rows
        .filter((r) => r.groupId && groupName.has(r.groupId))
        .map((r) => ({ id: r.groupId!, name: groupName.get(r.groupId!)! }));
      const synced = direct?.lastSyncedAt ? direct : null;
      out.push({
        module: m.module,
        navPath: m.navPath,
        link: m.link(policyId),
        policyId,
        name: policy.name,
        enabled: policy.enabled ?? true,
        detail: m.detail?.(policy) ?? null,
        direct: Boolean(direct),
        groups,
        excepted: m.exceptionType ? excepted.has(`${m.exceptionType}|${policyId}`) : false,
        syncStatus: synced?.lastSyncStatus ?? null,
        lastSyncedAt: synced?.lastSyncedAt?.toISOString() ?? null,
        syncError: synced?.lastSyncError ?? null,
      });
    }
  });
  return { paused, policies: out };
}
