import type {
  AllowlistWire,
  AppControlRuleType,
  AppControlRuleWire,
  AssignedAppControlResponse,
  AppControlScanResultPayload,
  MicrosoftSignedOption,
  VersionMatch,
} from "@em/shared";
import { catalogApp, isAdvancedAppControlRuleType } from "@em/shared";
import { createHash } from "node:crypto";
import type { AppControlPolicy, AppControlRule } from "@prisma/client";
import { microsoftProductsOf } from "./appControlPolicy.service";
import { config } from "../config";
import { prisma } from "../db";
import { isPolicyExcepted } from "./policyAccessException.service";
import { isAgentPaused } from "./pause.service";
import { aiGuardAppControlRules } from "./aiGuard.service";
import { effectiveMemberships } from "./groupTree.service";
import { isFeatureLicensed } from "./licenseActivation.service";

// The policies this agent enforces: assigned directly or via a group, enabled, not excepted for
// it, and none while the agent is paused.
async function activePolicyIdsForAgent(agentId: string): Promise<{ policyIds: string[]; groupIds: string[] }> {
  const memberships = await effectiveMemberships(agentId);
  const groupIds = memberships.map((m) => m.groupId);
  if (await isAgentPaused(agentId)) return { policyIds: [], groupIds };

  const assignments = await prisma.appControlPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const candidatePolicyIds = [...new Set(assignments.map((a) => a.policyId))];
  const excepted = await Promise.all(candidatePolicyIds.map((id) => isPolicyExcepted("APP_CONTROL", id, agentId)));
  const notExcepted = candidatePolicyIds.filter((_, i) => !excepted[i]);
  if (notExcepted.length === 0) return { policyIds: [], groupIds };

  const enabled = await prisma.appControlPolicy.findMany({ where: { id: { in: notExcepted }, enabled: true }, select: { id: true } });
  return { policyIds: enabled.map((p) => p.id), groupIds };
}

// What GET /api/agent/app-control/assigned returns. DLL and Allow rules travel separately, and only
// while advanced application control is on: older agents read every entry of .rules as a block.
export async function resolveAssignedAppControlForAgent(agentId: string): Promise<AssignedAppControlResponse> {
  const { policyIds } = await activePolicyIdsForAgent(agentId);
  // Application control policies are licensed on their own (EPM_APP); AI Guard's blocked AI
  // programs below aren't part of it.
  const licensed = await isFeatureLicensed("EPM_APP");
  const policies =
    licensed && policyIds.length > 0 ? await prisma.appControlPolicy.findMany({ where: { id: { in: policyIds } }, include: { rules: true } }) : [];
  const all = blockRules(policies.filter((p) => p.mode !== "ALLOWLIST"));
  // AI Guard's blocked AI desktop programs (aiGuard.service.ts) - nothing while paused.
  const taken = new Set(all.map((r) => `${r.ruleType}:${r.value.toLowerCase()}`));
  const aiRules = (await aiGuardAppControlRules(agentId)).filter((r) => !taken.has(`${r.ruleType}:${r.value.toLowerCase()}`));
  const rules = [...all.filter((r) => !isAdvancedAppControlRuleType(r.ruleType)), ...aiRules];
  if (!config.advancedAppControl) return { rules };
  // Allowlisting is licensed on its own (EPM_ALLOWLIST): without it, allowlist policies apply nothing.
  const allowlist = (await isFeatureLicensed("EPM_ALLOWLIST")) ? combineAllowlists(policies.filter((p) => p.mode === "ALLOWLIST")) : undefined;
  return { rules, advanced: { rules: all.filter((r) => isAdvancedAppControlRuleType(r.ruleType)), ...(allowlist ? { allowlist } : {}) } };
}

// Block policies' rules for this agent (allowlist policies' rules travel in the allowlist).
export async function resolveAssignedRulesForAgent(agentId: string): Promise<AppControlRuleWire[]> {
  const { policyIds } = await activePolicyIdsForAgent(agentId);
  if (policyIds.length === 0) return [];
  const policies = await prisma.appControlPolicy.findMany({ where: { id: { in: policyIds }, mode: { not: "ALLOWLIST" } }, include: { rules: true } });
  return blockRules(policies);
}

const ruleWire = (r: AppControlRule): AppControlRuleWire => ({
  ruleId: r.id,
  ruleType: r.ruleType as AppControlRuleType,
  value: r.value,
  ...(r.ruleType === "ALLOW_PUBLISHER" || r.ruleType === "ALLOW_HASH"
    ? {
        productName: r.productName,
        fileName: r.fileName,
        versionMatch: r.versionMatch as VersionMatch | null,
        version: r.version,
        fileSize: r.fileSize === null ? null : Number(r.fileSize),
      }
    : {}),
});

// Flat, deduped by (ruleType, value) across every policy this agent enforces — two policies
// both blocking "utorrent.exe" still produce one rule on the endpoint.
function blockRules(policies: (AppControlPolicy & { rules: AppControlRule[] })[]): AppControlRuleWire[] {
  const seen = new Set<string>();
  const rules: AppControlRuleWire[] = [];
  for (const p of policies) {
    for (const r of p.rules) {
      const key = `${r.ruleType}:${r.value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push(ruleWire(r));
    }
  }
  return rules;
}

// AppLocker rule ids must be GUIDs: one per catalog entry part, the same on every sync.
function stableGuid(text: string): string {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// A common application (ALLOW_CATALOG) as the folder and publisher rules it stands for.
export function expandCatalogRule(key: string): AppControlRuleWire[] {
  const app = catalogApp(key);
  if (!app) return [];
  return [
    ...app.paths.map((p) => ({ ruleId: stableGuid(`catalog:${key}:path:${p.toLowerCase()}`), ruleType: "ALLOW_PATH" as const, value: p })),
    ...(app.publishers ?? []).map((p) => ({
      ruleId: stableGuid(`catalog:${key}:pub:${p.publisher}:${p.product}`.toLowerCase()),
      ruleType: "ALLOW_PUBLISHER" as const,
      value: p.publisher,
      productName: p.product,
      fileName: null,
      versionMatch: "ANY" as const,
      version: null,
      fileSize: null,
    })),
  ];
}

// Every allowlist policy on the agent, as one: allows add up. Allowlists always block what they
// don't allow. undefined when none applies.
export function combineAllowlists(policies: (AppControlPolicy & { rules: AppControlRule[] })[]): AllowlistWire | undefined {
  if (policies.length === 0) return undefined;
  const signed = policies.map((p) => p.microsoftSigned as MicrosoftSignedOption);
  const microsoftSigned: MicrosoftSignedOption = signed.includes("ALL") ? "ALL" : signed.includes("SELECTED") ? "SELECTED" : "OFF";
  const products = new Map<string, string>();
  for (const p of policies) {
    if (p.microsoftSigned !== "SELECTED") continue;
    for (const name of microsoftProductsOf(p)) products.set(name.toLowerCase(), name);
  }
  const seen = new Set<string>();
  const rules: AppControlRuleWire[] = [];
  const add = (w: AppControlRuleWire) => {
    const key = [w.ruleType, w.value, w.productName, w.fileName, w.versionMatch, w.version].map((x) => (x ?? "").toLowerCase()).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    rules.push(w);
  };
  for (const p of policies) {
    for (const r of p.rules) {
      if (r.ruleType === "ALLOW_CATALOG") expandCatalogRule(r.value).forEach(add);
      else add(ruleWire(r));
    }
  }
  return {
    enforce: true,
    allowProgramFiles: policies.some((p) => p.allowProgramFiles),
    exemptAdministrators: policies.some((p) => p.exemptAdministrators),
    microsoftSigned,
    microsoftProducts: microsoftSigned === "SELECTED" ? [...products.values()] : [],
    rules,
  };
}

// Windows logs one attempt to start a program more than once (the launch itself, and again for a
// program that asks for administrator rights), within milliseconds of each other. The same
// program, path, outcome and rule within REPEAT_WINDOW_MS - in this report or already stored -
// counts as one attempt.
const REPEAT_WINDOW_MS = 10_000;
type ScanEvent = AppControlScanResultPayload["events"][number];

export async function withoutRepeats(agentId: string, events: ScanEvent[]): Promise<ScanEvent[]> {
  if (events.length === 0) return events;
  const keyOf = (path: string | null | undefined, outcome: string | null | undefined, ruleId: string | null | undefined) =>
    `${(outcome ?? "BLOCKED").toUpperCase()}|${(path ?? "").toLowerCase()}|${(ruleId ?? "").toLowerCase()}`;
  const seen = new Map<string, number[]>();
  const add = (key: string, at: number) => seen.set(key, [...(seen.get(key) ?? []), at]);
  const near = (key: string, at: number) => (seen.get(key) ?? []).some((t) => Math.abs(t - at) < REPEAT_WINDOW_MS);

  const times = events.map((e) => new Date(e.occurredAt).getTime()).filter((t) => Number.isFinite(t));
  if (times.length > 0) {
    const stored = await prisma.appControlEvent.findMany({
      where: {
        agentId,
        occurredAt: { gte: new Date(Math.min(...times) - REPEAT_WINDOW_MS), lte: new Date(Math.max(...times) + REPEAT_WINDOW_MS) },
      },
      select: { matchedPath: true, outcome: true, ruleId: true, occurredAt: true },
    });
    for (const s of stored) add(keyOf(s.matchedPath, s.outcome, s.ruleId), s.occurredAt.getTime());
  }

  const out: ScanEvent[] = [];
  for (const e of [...events].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())) {
    const at = new Date(e.occurredAt).getTime();
    // Stored allowlist events have no rule id, whatever the agent sent.
    const key = keyOf(e.matchedPath, e.outcome, e.allowlist ? null : e.ruleId);
    if (Number.isFinite(at) && near(key, at)) continue;
    add(key, at);
    out.push(e);
  }
  return out;
}

// Every sync stamps the endpoint's assignment rows (Sync status tab; the agent says APPLIED,
// stored as SUCCESS like the other blocking modules), then stores any blocked programs (Activity).
export async function recordScanResult(agentId: string, payload: AppControlScanResultPayload): Promise<void> {
  const { policyIds, groupIds } = await activePolicyIdsForAgent(agentId);
  if (policyIds.length > 0) {
    await prisma.appControlPolicyAssignment.updateMany({
      where: { policyId: { in: policyIds }, OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: payload.status === "APPLIED" ? "SUCCESS" : "FAILED",
        lastSyncError: payload.errorMessage?.slice(0, 1000) ?? null,
      },
    });
  }
  const events = await withoutRepeats(agentId, payload.events);
  if (events.length === 0) return;

  // Resolve each event's ruleId to its CURRENT policyId at ingestion time (the agent
  // doesn't carry policyId itself) — if the rule's since been deleted, policyId is left
  // null rather than failing the batch.
  const ruleIds = [...new Set(events.map((e) => e.ruleId).filter((id): id is string => Boolean(id)))];
  const rules =
    ruleIds.length > 0
      ? await prisma.appControlRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, policyId: true } })
      : [];
  const policyIdByRuleId = new Map(rules.map((r) => [r.id, r.policyId]));

  // Allowlist events name no rule: they belong to the agent's allowlist policy - an enforcing one
  // for a block, an auditing one for an audit record.
  const allowlists = events.some((e) => e.allowlist)
    ? await prisma.appControlPolicy.findMany({
        where: { id: { in: policyIds }, mode: "ALLOWLIST" },
        select: { id: true, allowlistEnforcement: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const allowlistPolicyFor = (outcome: string) =>
    (allowlists.find((p) => p.allowlistEnforcement === (outcome === "AUDIT" ? "AUDIT" : "ENFORCE")) ?? allowlists[0])?.id ?? null;

  await prisma.appControlEvent.createMany({
    data: events.map((e) => {
      const outcome = e.outcome ?? "BLOCKED";
      return {
        agentId,
        policyId: e.allowlist ? allowlistPolicyFor(outcome) : e.ruleId ? (policyIdByRuleId.get(e.ruleId) ?? null) : null,
        ruleId: e.allowlist ? null : e.ruleId,
        matchedPath: e.matchedPath,
        processName: e.processName,
        occurredAt: new Date(e.occurredAt),
        outcome,
        publisher: e.publisher?.toUpperCase() ?? null,
        productName: e.productName ?? null,
        fileVersion: e.fileVersion ?? null,
        fileHash: e.fileHash?.replace(/^0x/i, "").toUpperCase() ?? null,
        fileSize: typeof e.fileSize === "number" ? BigInt(Math.trunc(e.fileSize)) : null,
        userName: e.userName ?? null,
      };
    }),
  });
}
