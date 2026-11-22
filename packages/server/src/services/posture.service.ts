import { getWindowsEolInfo } from "@em/shared";
import { prisma } from "../db";
import { logger } from "../logger";
import { effectiveLastCheckin } from "../presence/presence";
import { extractOsEditionLabel } from "./agentDerived.util";
import { isModuleLicensed } from "./licenseActivation.service";
import { excludeOverriddenFailures, getOverriddenKeysByAgent } from "./zeroTrustOverride.service";

// Security posture score (0-100) per endpoint and for the organisation (the endpoints' average),
// for the Dashboard's Organisation Security Posture graph. Each part is 0-100; parts an endpoint
// has no data for (not assessed, module not licensed) are left out and the rest re-weighted.
// An end-of-support Windows version caps the endpoint at 50.

export const POSTURE_WEIGHTS = {
  vulnerabilities: 25,
  patches: 20,
  zeroTrust: 20,
  securityConfig: 15,
  threats: 10,
  policyBlocks: 10,
} as const;
export type PosturePart = keyof typeof POSTURE_WEIGHTS;
export type PostureParts = Partial<Record<PosturePart, number>>;

const VULN_PENALTY: Record<string, number> = { CRITICAL: 25, HIGH: 10, MEDIUM: 3, LOW: 1 };
const PATCH_PENALTY = 5;
const BLOCK_PENALTY = 5;
const BLOCK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // endpoints silent longer than this are left out
const EOL_CAP = 50;

export interface EndpointPostureInput {
  vulnerabilities?: Partial<Record<string, number>>; // open findings by severity
  missingPatches?: number;
  zeroTrust?: { passed: number; total: number };
  securityConfig?: { passed: number; total: number };
  openThreats?: number;
  policyBlocks?: number; // blocks in the last 7 days
  osEndOfSupport?: boolean;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function scoreEndpoint(input: EndpointPostureInput): { score: number; parts: PostureParts; eolCapped: boolean } {
  const parts: PostureParts = {};
  if (input.vulnerabilities) {
    let penalty = 0;
    for (const [sev, n] of Object.entries(input.vulnerabilities)) penalty += (VULN_PENALTY[sev.toUpperCase()] ?? VULN_PENALTY.LOW) * (n ?? 0);
    parts.vulnerabilities = clamp(100 - penalty);
  }
  if (input.missingPatches !== undefined) parts.patches = clamp(100 - PATCH_PENALTY * input.missingPatches);
  if (input.zeroTrust && input.zeroTrust.total > 0) parts.zeroTrust = clamp((input.zeroTrust.passed / input.zeroTrust.total) * 100);
  if (input.securityConfig && input.securityConfig.total > 0)
    parts.securityConfig = clamp((input.securityConfig.passed / input.securityConfig.total) * 100);
  if (input.openThreats !== undefined) parts.threats = input.openThreats > 0 ? 0 : 100;
  if (input.policyBlocks !== undefined) parts.policyBlocks = clamp(100 - BLOCK_PENALTY * input.policyBlocks);

  let weighted = 0;
  let weights = 0;
  for (const [k, v] of Object.entries(parts) as [PosturePart, number][]) {
    weighted += v * POSTURE_WEIGHTS[k];
    weights += POSTURE_WEIGHTS[k];
  }
  let score = weights > 0 ? weighted / weights : 100;
  const eolCapped = Boolean(input.osEndOfSupport) && score > EOL_CAP;
  if (eolCapped) score = EOL_CAP;
  return { score: round1(score), parts: roundParts(parts), eolCapped };
}

// The organisation: the average endpoint score, and each part's average over the endpoints that have it.
export function scoreOrganisation(endpoints: { score: number; parts: PostureParts }[]): { score: number | null; parts: PostureParts } {
  if (endpoints.length === 0) return { score: null, parts: {} };
  const parts: PostureParts = {};
  for (const k of Object.keys(POSTURE_WEIGHTS) as PosturePart[]) {
    const vals = endpoints.map((e) => e.parts[k]).filter((v): v is number => v !== undefined);
    if (vals.length > 0) parts[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return { score: round1(endpoints.reduce((a, e) => a + e.score, 0) / endpoints.length), parts: roundParts(parts) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const roundParts = (p: PostureParts): PostureParts =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, round1(v as number)])) as PostureParts;

// ---- gathering the inputs

async function gatherInputs(now: Date): Promise<Map<string, EndpointPostureInput>> {
  const [security, data, threat] = await Promise.all([
    isModuleLicensed("SECURITY_MANAGER"),
    isModuleLicensed("DATA_MANAGER"),
    isModuleLicensed("THREAT_PROTECTION"),
  ]);

  const agents = await prisma.agent.findMany({
    where: { lifecycleStatus: "ACTIVE" },
    select: { id: true, osPlatform: true, osVersion: true, lastCheckinAt: true, inventory: { select: { osInfo: true } } },
  });
  const included = agents.filter((a) => {
    const seen = effectiveLastCheckin(a.id, a.lastCheckinAt);
    return seen && now.getTime() - seen.getTime() <= STALE_AFTER_MS;
  });
  const inputs = new Map<string, EndpointPostureInput>();
  for (const a of included) {
    const eol = a.osPlatform === "win32" ? getWindowsEolInfo(a.osVersion, extractOsEditionLabel(a.inventory?.osInfo)) : null;
    inputs.set(a.id, { osEndOfSupport: Boolean(eol?.isEol) });
  }
  const ids = [...inputs.keys()];
  if (ids.length === 0) return inputs;
  const inIds = { agentId: { in: ids } };

  if (security) {
    const [vulns, patchAssessed, patchMissing, ztRaw, config] = await Promise.all([
      prisma.vulnerabilityFinding.findMany({
        where: { ...inIds, status: "OPEN" },
        select: { agentId: true, vulnerabilityDefinition: { select: { cvssSeverity: true } } },
      }),
      prisma.patchFinding.groupBy({ by: ["agentId"], where: inIds, _count: { _all: true } }),
      prisma.patchFinding.groupBy({ by: ["agentId"], where: { ...inIds, status: "MISSING" }, _count: { _all: true } }),
      prisma.zeroTrustFinding.findMany({
        where: { ...inIds, status: { in: ["PASS", "FAIL"] }, condition: { enabled: true } },
        select: { agentId: true, status: true, condition: { select: { conditionKey: true } } },
      }),
      prisma.securityBenchmarkFinding.groupBy({ by: ["agentId", "status"], where: inIds, _count: { _all: true } }),
    ]);

    // Every endpoint that has reported its software is assessed for vulnerabilities.
    const withInventory = new Set(agents.filter((a) => a.inventory).map((a) => a.id));
    for (const id of ids) if (withInventory.has(id)) inputs.get(id)!.vulnerabilities = {};
    for (const v of vulns) {
      const bySev = inputs.get(v.agentId)!.vulnerabilities ?? (inputs.get(v.agentId)!.vulnerabilities = {});
      const sev = (v.vulnerabilityDefinition.cvssSeverity ?? "LOW").toUpperCase();
      bySev[sev] = (bySev[sev] ?? 0) + 1;
    }

    const missing = new Map(patchMissing.map((g) => [g.agentId, g._count._all]));
    for (const g of patchAssessed) inputs.get(g.agentId)!.missingPatches = missing.get(g.agentId) ?? 0;

    // Overridden Zero Trust failures count as passes, as on the Zero Trust page.
    const failures = ztRaw.filter((f) => f.status === "FAIL");
    const overridden = await getOverriddenKeysByAgent([...new Set(failures.map((f) => f.agentId))]);
    const realFailures = excludeOverriddenFailures(
      failures.map((f) => ({ agentId: f.agentId, status: f.status, conditionKey: f.condition.conditionKey })),
      overridden,
    );
    const failCount = new Map<string, number>();
    for (const f of realFailures) failCount.set(f.agentId, (failCount.get(f.agentId) ?? 0) + 1);
    const totalCount = new Map<string, number>();
    for (const f of ztRaw) totalCount.set(f.agentId, (totalCount.get(f.agentId) ?? 0) + 1);
    for (const [id, total] of totalCount) inputs.get(id)!.zeroTrust = { passed: total - (failCount.get(id) ?? 0), total };

    for (const g of config) {
      const input = inputs.get(g.agentId)!;
      const c = input.securityConfig ?? (input.securityConfig = { passed: 0, total: 0 });
      c.total += g._count._all;
      if (g.status === "PASS") c.passed += g._count._all;
    }
  }

  if (threat) {
    const open = await prisma.threatDetection.groupBy({
      by: ["agentId"],
      where: { ...inIds, status: { in: ["ACTIVE", "FAILED"] } },
      _count: { _all: true },
    });
    const openBy = new Map(open.map((g) => [g.agentId, g._count._all]));
    for (const a of included) if (a.osPlatform === "win32") inputs.get(a.id)!.openThreats = openBy.get(a.id) ?? 0;
  }

  if (data) {
    const since = new Date(now.getTime() - BLOCK_WINDOW_MS);
    const recent = { ...inIds, occurredAt: { gte: since } };
    const groups = await Promise.all([
      prisma.appControlEvent.groupBy({ by: ["agentId"], where: { ...recent, outcome: "BLOCKED" }, _count: { _all: true } }),
      prisma.commandBlockEvent.groupBy({ by: ["agentId"], where: { ...recent, action: "BLOCKED" }, _count: { _all: true } }),
      prisma.dlpEvent.groupBy({ by: ["agentId"], where: { ...recent, action: "BLOCKED" }, _count: { _all: true } }),
      prisma.usbControlEvent.groupBy({ by: ["agentId"], where: recent, _count: { _all: true } }),
      prisma.screenshotBlockEvent.groupBy({ by: ["agentId"], where: recent, _count: { _all: true } }),
    ]);
    for (const id of ids) inputs.get(id)!.policyBlocks = 0;
    for (const list of groups) for (const g of list) inputs.get(g.agentId)!.policyBlocks! += g._count._all;
  }
  return inputs;
}

export interface PostureNow {
  score: number | null;
  parts: PostureParts;
  endpointCount: number;
  eolCappedCount: number;
  computedAt: string;
}

export async function computePosture(now = new Date()): Promise<{ org: PostureNow; endpoints: Map<string, ReturnType<typeof scoreEndpoint>> }> {
  const inputs = await gatherInputs(now);
  const endpoints = new Map([...inputs].map(([id, input]) => [id, scoreEndpoint(input)]));
  const org = scoreOrganisation([...endpoints.values()]);
  return {
    org: {
      ...org,
      endpointCount: endpoints.size,
      eolCappedCount: [...endpoints.values()].filter((e) => e.eolCapped).length,
      computedAt: now.toISOString(),
    },
    endpoints,
  };
}

// ---- daily snapshots

// The server's local calendar day, as the DATE column stores it (midnight UTC of that day).
export function snapshotDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

let latest: PostureNow | null = null;

// Today's rows always hold today's latest score: replaced on every run.
export async function recordPostureSnapshot(now = new Date()): Promise<PostureNow> {
  const { org, endpoints } = await computePosture(now);
  const day = snapshotDay(now);
  const rows = [
    ...[...endpoints].map(([agentId, e]) => ({ day, agentId, score: e.score, parts: JSON.stringify({ ...e.parts, eolCapped: e.eolCapped }), endpointCount: null })),
    ...(org.score !== null
      ? [{ day, agentId: null, score: org.score, parts: JSON.stringify(org.parts), endpointCount: org.endpointCount }]
      : []),
  ];
  await prisma.$transaction([prisma.postureSnapshot.deleteMany({ where: { day } }), prisma.postureSnapshot.createMany({ data: rows })]);
  latest = org;
  return org;
}

const RECORD_EVERY_MS = 60 * 60 * 1000;

export function schedulePostureSnapshots(): void {
  const run = () =>
    recordPostureSnapshot().catch((err) => logger.error({ err }, "Recording the security posture snapshot failed"));
  // A minute after start (the fleet cache and presence are warm by then), then hourly.
  setTimeout(() => {
    void run();
    setInterval(() => void run(), RECORD_EVERY_MS).unref();
  }, 60_000).unref();
}

export const POSTURE_RANGES = { week: 7, month: 30, quarter: 91, half: 182, year: 365 } as const;
export type PostureRange = keyof typeof POSTURE_RANGES;

export async function getPostureHistory(range: PostureRange): Promise<{
  current: PostureNow | null;
  previous: number | null; // the score at the start of the range, for the change
  points: { day: string; score: number; endpointCount: number | null }[];
}> {
  const now = new Date();
  const from = snapshotDay(new Date(now.getTime() - (POSTURE_RANGES[range] - 1) * 24 * 60 * 60 * 1000));
  const rows = await prisma.postureSnapshot.findMany({
    where: { agentId: null, day: { gte: from } },
    orderBy: { day: "asc" },
    select: { day: true, score: true, endpointCount: true },
  });
  if (!latest || now.getTime() - new Date(latest.computedAt).getTime() > RECORD_EVERY_MS) {
    latest = await recordPostureSnapshot(now).catch(() => latest);
  }
  const points = rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), score: r.score, endpointCount: r.endpointCount }));
  // Today's point is the live score.
  const today = snapshotDay(now).toISOString().slice(0, 10);
  if (latest?.score != null) {
    const i = points.findIndex((p) => p.day === today);
    const live = { day: today, score: latest.score, endpointCount: latest.endpointCount };
    if (i >= 0) points[i] = live;
    else points.push(live);
  }
  return { current: latest, previous: points.length > 1 ? points[0].score : null, points };
}
