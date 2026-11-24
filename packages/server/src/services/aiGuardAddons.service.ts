import {
  MAIL_GUARD_CHROME_STORE_ID,
  MAIL_GUARD_DEV_EXTENSION_ID,
  MAIL_GUARD_EDGE_STORE_ID,
  PII_PATTERN_CATALOG,
  aiComponentKey,
  isAiComponent,
  processNameOf,
  type AiComponentKind,
  type AiComponentReportItem,
  type AiGuardAgentAssignment,
} from "@em/shared";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { activeAiPoliciesForAgent, blockedAiAppsForAgent, listAiApps } from "./aiGuard.service";
import { promptRulesFor } from "./aiGuardPrompt.service";
import { membersOfGroups } from "./groupTree.service";
import { isFeatureLicensed } from "./licenseActivation.service";

// AI Guard phase 3 - AI add-ons (browser extensions, code-editor extensions, npm command-line AI
// tools) and the tray app's clipboard check for AI desktop apps.
//
// The agent reports everything it finds; only items isAiComponent() recognises are kept. A policy
// allows or blocks an add-on with an "addon:<kind>:<host>:<id>" key in appActions (default Allowed).
// Blocking uses each program's own mechanism: Chrome/Edge's extension blocklist, VS Code's
// AllowedExtensions policy. Cursor, Windsurf, VSCodium and command-line tools are reported only.

const OWN_EXTENSION_IDS = [MAIL_GUARD_DEV_EXTENSION_ID, MAIL_GUARD_CHROME_STORE_ID, MAIL_GUARD_EDGE_STORE_ID].filter(Boolean);
const MAX_ITEMS = 3000;

export const ENFORCEABLE: Record<string, boolean> = { chrome: true, edge: true, vscode: true };

// Scan now: endpoints asked to look for add-ons again, picked up at their next AI Guard sync (within
// 5 minutes). Held in memory only - after a server restart the regular scans carry on.
const scanRequests = new Map<string, string>();

export async function requestScan(params: { agentId?: string; groupId?: string }): Promise<number> {
  const where = params.agentId
    ? { id: params.agentId }
    : params.groupId
      ? { osPlatform: "win32", id: { in: (await membersOfGroups([params.groupId])).map((m) => m.agentId) } }
      : { osPlatform: "win32" };
  const agents = await prisma.agent.findMany({ where, select: { id: true } });
  const id = randomUUID();
  for (const a of agents) scanRequests.set(a.id, id);
  return agents.length;
}

// Replaces this endpoint's AI add-ons with what the agent just found. Per-endpoint blocks are kept:
// found add-ons keep their Blocked setting, and blocked ones that weren't found stay listed (a
// browser may have removed a blocked extension - dropping the block would let it come back).
export async function recordComponents(agentId: string, items: AiComponentReportItem[]): Promise<number> {
  const seen = new Set<string>();
  const ai = items.slice(0, MAX_ITEMS).filter((i) => {
    const key = `${i.kind}|${i.host}|${i.identifier.toLowerCase()}|${(i.userName ?? "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return isAiComponent(i.kind, i.identifier, i.name, OWN_EXTENSION_IDS);
  });
  scanRequests.delete(agentId);
  const keyOf = (r: { kind: string; host: string; identifier: string }) => aiComponentKey(r.kind as AiComponentKind, r.host, r.identifier);
  const blockedRows = await prisma.agentAiComponent.findMany({ where: { agentId, blocked: true } });
  const blockedKeys = new Set(blockedRows.map(keyOf));
  const foundKeys = new Set(ai.map(keyOf));
  const gone = new Map<string, (typeof blockedRows)[number]>();
  for (const r of blockedRows) if (!foundKeys.has(keyOf(r)) && !gone.has(keyOf(r))) gone.set(keyOf(r), r);
  await prisma.$transaction([
    prisma.agentAiComponent.deleteMany({ where: { agentId } }),
    prisma.agentAiComponent.createMany({
      data: [
        ...ai.map((i) => ({
          agentId,
          kind: i.kind,
          host: i.host,
          identifier: i.identifier.slice(0, 200),
          name: (i.name || i.identifier).slice(0, 300),
          version: i.version?.slice(0, 100) ?? null,
          userName: i.userName?.slice(0, 300) ?? null,
          blocked: blockedKeys.has(keyOf(i)),
        })),
        ...[...gone.values()].map((r) => ({
          agentId,
          kind: r.kind,
          host: r.host,
          identifier: r.identifier,
          name: r.name,
          version: r.version,
          userName: r.userName,
          lastSeenAt: r.lastSeenAt,
          blocked: true,
        })),
      ],
    }),
  ]);
  return ai.length;
}

function blockedKeysOf(appActions: string): Set<string> {
  try {
    const v = JSON.parse(appActions) as Record<string, string>;
    return new Set(Object.entries(v).filter(([k, a]) => k.startsWith("addon:") && a === "BLOCK").map(([k]) => k));
  } catch {
    return new Set();
  }
}

async function policyBlockedKeysFor(agentId: string): Promise<Set<string>> {
  const policies = await activeAiPoliciesForAgent(agentId);
  const out = new Set<string>();
  for (const p of policies) for (const k of blockedKeysOf(p.appActions)) out.add(k);
  return out;
}

async function endpointBlockedKeysFor(agentId: string): Promise<Set<string>> {
  const rows = await prisma.agentAiComponent.findMany({ where: { agentId, blocked: true }, select: { kind: true, host: true, identifier: true } });
  return new Set(rows.map((r) => aiComponentKey(r.kind as AiComponentKind, r.host, r.identifier)));
}

// Blocked on this endpoint: by its AI Guard policy, or for this endpoint only.
async function blockedAddonKeysFor(agentId: string): Promise<Set<string>> {
  const out = await policyBlockedKeysFor(agentId);
  for (const k of await endpointBlockedKeysFor(agentId)) out.add(k);
  return out;
}

export class AiComponentError extends Error {}

// Allows or blocks one add-on on one endpoint (AI Extensions page). A block the endpoint's policy
// sets can't be lifted here - change the policy instead.
export async function setEndpointBlock(agentId: string, key: string, blocked: boolean): Promise<void> {
  const rows = (await prisma.agentAiComponent.findMany({ where: { agentId } })).filter(
    (r) => aiComponentKey(r.kind as AiComponentKind, r.host, r.identifier) === key,
  );
  if (rows.length === 0) throw new AiComponentError("That add-on isn't on this endpoint.");
  if (!ENFORCEABLE[rows[0].host]) throw new AiComponentError("Only Chrome, Edge and VS Code extensions can be blocked.");
  await prisma.agentAiComponent.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { blocked } });
}

// Every AI add-on found across the fleet (or one group), one row per add-on.
export async function listComponents(params: { groupId?: string }) {
  const agentFilter = params.groupId
    ? (await membersOfGroups([params.groupId])).map((m) => m.agentId)
    : null;
  const rows = await prisma.agentAiComponent.findMany({
    where: agentFilter ? { agentId: { in: agentFilter } } : {},
    include: { agent: { select: { hostname: true } } },
    orderBy: { lastSeenAt: "desc" },
  });
  type Agg = {
    key: string;
    kind: string;
    host: string;
    identifier: string;
    name: string;
    versions: Set<string>;
    endpoints: Map<string, { hostname: string; blocked: boolean; reportedAt: Date }>;
    users: Set<string>;
    lastSeenAt: Date;
  };
  const byKey = new Map<string, Agg>();
  for (const r of rows) {
    const key = aiComponentKey(r.kind as AiComponentKind, r.host, r.identifier);
    const a = byKey.get(key) ?? { key, kind: r.kind, host: r.host, identifier: r.identifier, name: r.name, versions: new Set(), endpoints: new Map(), users: new Set(), lastSeenAt: r.lastSeenAt };
    if (r.version) a.versions.add(r.version);
    const prev = a.endpoints.get(r.agentId);
    a.endpoints.set(r.agentId, {
      hostname: r.agent.hostname,
      blocked: r.blocked || (prev?.blocked ?? false),
      reportedAt: prev && prev.reportedAt > r.lastSeenAt ? prev.reportedAt : r.lastSeenAt,
    });
    if (r.userName) a.users.add(r.userName);
    if (r.lastSeenAt > a.lastSeenAt) a.lastSeenAt = r.lastSeenAt;
    byKey.set(key, a);
  }
  // Where each one is blocked now, and which of those blocks come from the endpoint's policy.
  const blockedOn = new Map<string, number>();
  const policyBlocked = new Map<string, Set<string>>(); // agentId -> keys
  for (const agentId of new Set(rows.map((r) => r.agentId))) {
    policyBlocked.set(agentId, await policyBlockedKeysFor(agentId));
    for (const k of await blockedAddonKeysFor(agentId)) blockedOn.set(k, (blockedOn.get(k) ?? 0) + 1);
  }
  return [...byKey.values()]
    .map((a) => ({
      key: a.key,
      kind: a.kind,
      host: a.host,
      identifier: a.identifier,
      name: a.name,
      versions: [...a.versions].sort(),
      endpoints: [...a.endpoints.entries()]
        .map(([agentId, e]) => ({
          agentId,
          hostname: e.hostname,
          blocked: e.blocked,
          policyBlocked: policyBlocked.get(agentId)?.has(a.key) ?? false,
          reportedAt: e.reportedAt.toISOString(),
        }))
        .sort((x, y) => x.hostname.localeCompare(y.hostname)),
      users: [...a.users].sort(),
      lastSeenAt: a.lastSeenAt.toISOString(),
      enforceable: Boolean(ENFORCEABLE[a.host]),
      blockedOn: blockedOn.get(a.key) ?? 0,
    }))
    .sort((x, y) => y.endpoints.length - x.endpoints.length || x.name.localeCompare(y.name));
}

// What this endpoint's agent applies (GET /api/agent/ai-guard/assigned).
export async function agentAssignment(agentId: string): Promise<AiGuardAgentAssignment> {
  // Blocking AI add-ons is licensed on its own (AI_EXTENSIONS).
  const blocked = (await isFeatureLicensed("AI_EXTENSIONS")) ? await blockedAddonKeysFor(agentId) : new Set<string>();
  const blockedBrowserExtensions: AiGuardAgentAssignment["blockedBrowserExtensions"] = [];
  const blockedVscodeExtensions: string[] = [];
  for (const key of blocked) {
    const [, kind, host, ...rest] = key.split(":");
    const id = rest.join(":");
    if (kind === "BROWSER_EXTENSION" && (host === "chrome" || host === "edge") && /^[a-p]{32}$/.test(id) && !OWN_EXTENSION_IDS.includes(id)) {
      blockedBrowserExtensions.push({ browser: host, id });
    } else if (kind === "IDE_EXTENSION" && host === "vscode" && /^[a-z0-9-]+\.[a-z0-9.-]+$/.test(id)) {
      blockedVscodeExtensions.push(id);
    }
  }

  // Clipboard check for AI desktop apps: the same rules as prompt protection in the browser, for
  // the AI tools with desktop programs that aren't blocked outright here.
  // The desktop clipboard check is licensed on its own (AI_PROMPT_DESKTOP).
  const rules = (await isFeatureLicensed("AI_PROMPT_DESKTOP")) ? await promptRulesFor(agentId) : null;
  const off: AiGuardAgentAssignment["clipboard"] = { enabled: false, action: "WARN", patterns: [], keywordTypes: [], apps: [] };
  let clipboard = off;
  if (rules && (rules.patternKeys.length > 0 || rules.keywordTypes.length > 0)) {
    const blockedApps = new Set((await blockedAiAppsForAgent(agentId)).map((a) => a.key));
    const apps = (await listAiApps())
      .filter((a) => a.executables.length > 0 && !blockedApps.has(a.key))
      .map((a) => ({ name: a.name, processes: a.executables.map(processNameOf) }));
    const anyCase = ["PAN_INDIA", "GSTIN", "IFSC_CODE", "PASSPORT_INDIA", "IBAN"];
    clipboard = {
      enabled: apps.length > 0,
      action: rules.action,
      patterns: PII_PATTERN_CATALOG.filter((p) => rules.patternKeys.includes(p.key)).map((p) => ({
        label: p.label,
        pattern: p.pattern,
        anyCase: anyCase.includes(p.key),
        luhn: p.key === "CREDIT_CARD",
      })),
      keywordTypes: rules.keywordTypes,
      apps,
    };
  }
  return { blockedBrowserExtensions, blockedVscodeExtensions, scanRequest: scanRequests.get(agentId) ?? null, clipboard };
}

// The AI tool an AI desktop program belongs to, for clipboard events.
export async function aiAppForProcess(processName: string) {
  const name = processNameOf(processName);
  return (await listAiApps()).find((a) => a.executables.some((e) => processNameOf(e) === name)) ?? null;
}
