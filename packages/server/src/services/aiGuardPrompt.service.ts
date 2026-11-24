import crypto from "node:crypto";
import { BUILT_IN_DATA_TYPES, PII_PATTERN_CATALOG, hostMatchesDomain, normalizeDataTypeValue, type DataTypeKind } from "@em/shared";
import { prisma } from "../db";
import { config } from "../config";
import { emitInvalidate } from "../events/bus";
import { activeAiPoliciesForAgent, listAiApps } from "./aiGuard.service";
import { membersOfGroups } from "./groupTree.service";
import { isFeatureLicensed } from "./licenseActivation.service";

// AI Guard phase 2 - prompt protection. The Endpoint IQ Browser Guard extension checks what is
// pasted into, sent to or uploaded to an AI website against the policy's data types, and warns,
// blocks or masks it. The prompt never reaches this server: the extension reports the data
// type names and a masked sample only.
//
// The extension has no agent credentials. The agent writes this endpoint's id and a key derived
// from it into the extension's browser policy (HKLM, so only an administrator can change it); the
// key is an HMAC of the endpoint id with a secret derived from FIELD_ENCRYPTION_KEY, so nothing
// extra is stored. A local user can read that policy, so the key only ever lets someone fetch this
// endpoint's AI prompt settings and add prompt events for this endpoint - nothing else.

const KEY_LABEL = "endpoint-iq-browser-guard-v1";
const secret = Buffer.from(crypto.hkdfSync("sha256", config.fieldEncryptionKey, Buffer.alloc(0), KEY_LABEL, 32));

export function browserGuardKeyFor(agentId: string): string {
  return crypto.createHmac("sha256", secret).update(agentId).digest("base64url");
}

// The endpoint the request is for, or null when the id/key pair doesn't check out.
export async function verifyBrowserGuardEndpoint(endpointId: string | undefined, key: string | undefined): Promise<string | null> {
  if (!endpointId || !key || endpointId.length > 100 || key.length > 100) return null;
  const expected = Buffer.from(browserGuardKeyFor(endpointId));
  const given = Buffer.from(key);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const agent = await prisma.agent.findUnique({ where: { id: endpointId }, select: { id: true } });
  return agent?.id ?? null;
}

export type PromptAction = "WARN" | "BLOCK" | "REDACT";
const STRICTNESS: Record<PromptAction, number> = { WARN: 1, REDACT: 2, BLOCK: 3 };

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Data types that make sense for AI prompts: personal-data bundles and keywords (checked in pasted
// text, prompts and uploaded files) and file types (uploads of those types are stopped whatever
// they contain). Website and application data types don't apply to prompts.
const PROMPT_KINDS: DataTypeKind[] = ["PII_PATTERN", "KEYWORD", "FILE_EXTENSION"];
const KIND_GROUP: Record<string, string> = {
  PII_PATTERN: "Data Types: Personal Data",
  KEYWORD: "Data Types: Keywords",
  FILE_EXTENSION: "Data Types: File Types (Uploads)",
};

interface ResolvedType {
  id: string;
  name: string;
  kind: DataTypeKind;
  values: string[];
}

// Built-in catalogue + the admin's own data types, by id ("builtin:..." or the DataType row id).
async function promptDataTypes(ids?: string[]): Promise<ResolvedType[]> {
  const builtIn = BUILT_IN_DATA_TYPES.filter((t) => PROMPT_KINDS.includes(t.kind) && (!ids || ids.includes(t.id))).map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    values: t.values,
  }));
  const custom = await prisma.dataType.findMany({
    where: { kind: { in: PROMPT_KINDS }, ...(ids ? { id: { in: ids.filter((i) => !i.startsWith("builtin:")) } } : {}) },
    select: { id: true, name: true, kind: true, values: true },
    orderBy: { name: "asc" },
  });
  return [...builtIn, ...custom.map((c) => ({ id: c.id, name: c.name, kind: c.kind as DataTypeKind, values: parseList(c.values) }))];
}

// What the admin can choose: the data types above, then single personal-data patterns.
export async function promptDataTypeOptions() {
  const types = await promptDataTypes();
  return [
    ...PROMPT_KINDS.flatMap((kind) =>
      types
        .filter((t) => t.kind === kind)
        .map((t) => ({
          value: `type:${t.id}`,
          label: t.name,
          group: KIND_GROUP[kind],
          kind,
          count: t.values.length,
          preview: (kind === "PII_PATTERN" ? t.values.map((v) => PII_PATTERN_CATALOG.find((p) => p.key === v)?.label ?? v) : t.values).slice(0, 4).join(", "),
          builtIn: t.id.startsWith("builtin:"),
        })),
    ),
    ...PII_PATTERN_CATALOG.map((p) => ({ value: `pii:${p.key}`, label: p.label, group: "Single Personal Data Patterns", kind: "PII_PATTERN" as DataTypeKind })),
  ];
}

export interface ExtensionPolicy {
  enabled: boolean;
  appName: string | null;
  action: PromptAction;
  patternKeys: string[];
  keywordTypes: { label: string; values: string[] }[];
  // Uploads of these file types are stopped whatever they contain (".pst", ".sql", ...).
  fileTypes: { label: string; extensions: string[] }[];
  policyId: string | null;
}

const OFF: ExtensionPolicy = { enabled: false, appName: null, action: "WARN", patternKeys: [], keywordTypes: [], fileTypes: [], policyId: null };

// The prompt protection in force on this endpoint for this AI website. With several AI policies
// (only possible for assignments from before the one-policy rule) the data types add up and the
// strictest action wins.
// The prompt-protection rules in force on this endpoint (browser extension and the tray's
// clipboard check use the same ones), or null when none apply.
export async function promptRulesFor(agentId: string) {
  const policies = (await activeAiPoliciesForAgent(agentId)).filter((p) => p.promptProtection);
  if (policies.length === 0) return null;

  const selected = [...new Set(policies.flatMap((p) => parseList(p.promptDataTypes)))];
  const typeIds = selected.filter((v) => v.startsWith("type:")).map((v) => v.slice(5));
  const types = typeIds.length ? await promptDataTypes(typeIds) : [];
  const patternKeys = [
    ...new Set([
      ...selected.filter((v) => v.startsWith("pii:")).map((v) => v.slice(4)),
      ...types.filter((t) => t.kind === "PII_PATTERN").flatMap((t) => t.values),
    ]),
  ];
  const keywordTypes = types
    .filter((t) => t.kind === "KEYWORD")
    .map((t) => ({ label: t.name, values: t.values.filter((v) => v.trim().length >= 2) }))
    .filter((t) => t.values.length > 0);
  const fileTypes = types
    .filter((t) => t.kind === "FILE_EXTENSION")
    .map((t) => ({ label: t.name, extensions: [...new Set(t.values.map((v) => normalizeDataTypeValue("FILE_EXTENSION", v)))] }))
    .filter((t) => t.extensions.length > 0);
  if (patternKeys.length === 0 && keywordTypes.length === 0 && fileTypes.length === 0) return null;

  const action = policies.map((p) => p.promptAction as PromptAction).reduce((a, b) => (STRICTNESS[b] > STRICTNESS[a] ? b : a), "WARN" as PromptAction);
  return { action, patternKeys, keywordTypes, fileTypes, policyId: policies[0].id };
}

export async function extensionPolicyFor(agentId: string, host: string): Promise<ExtensionPolicy> {
  const app = (await listAiApps()).find((a) => a.domains.some((d) => hostMatchesDomain(host, d)));
  if (!app) return OFF;
  // Prompt protection in the browser is licensed on its own (AI_PROMPT_BROWSER).
  if (!(await isFeatureLicensed("AI_PROMPT_BROWSER"))) return OFF;
  const rules = await promptRulesFor(agentId);
  if (!rules) return OFF;
  return { enabled: true, appName: app.name, ...rules };
}

export interface PromptEventReport {
  host: string;
  channel: "PASTE" | "SEND" | "UPLOAD" | "CLIPBOARD";
  appKey?: string | null; // desktop apps (clipboard check): the AI tool, as the host is a program name
  action: "BLOCKED" | "REDACTED" | "WARNED_CANCELLED" | "WARNED_CONTINUED";
  dataTypes: string[];
  maskedSample?: string | null;
  fileName?: string | null;
  policyId?: string | null;
}

export async function recordPromptEvent(agentId: string, report: PromptEventReport): Promise<void> {
  const apps = await listAiApps();
  const app = report.appKey ? apps.find((a) => a.key === report.appKey) : apps.find((a) => a.domains.some((d) => hostMatchesDomain(report.host, d)));
  const inventory = await prisma.inventorySnapshot.findUnique({ where: { agentId }, select: { lastLoggedOnUser: true } }).catch(() => null);
  // Only a policy that really applies here is linked.
  const active = await activeAiPoliciesForAgent(agentId);
  const policyId = report.policyId && active.some((p) => p.id === report.policyId) ? report.policyId : (active[0]?.id ?? null);
  await prisma.aiGuardPromptEvent.create({
    data: {
      agentId,
      policyId,
      appKey: app?.key ?? null,
      host: report.host.toLowerCase().slice(0, 255),
      channel: report.channel,
      action: report.action,
      dataTypes: JSON.stringify(report.dataTypes.slice(0, 20).map((d) => d.slice(0, 100))),
      maskedSample: report.maskedSample?.slice(0, 500) ?? null,
      fileName: report.fileName?.slice(0, 300) ?? null,
      username: inventory?.lastLoggedOnUser ?? null,
    },
  });
  emitInvalidate(["aiGuardPromptEvents", "notifications"]);
}

export async function listPromptEvents(params: { days: number; groupId?: string }) {
  const days = Math.min(Math.max(Math.trunc(params.days) || 7, 1), 90);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const agentFilter = params.groupId
    ? (await membersOfGroups([params.groupId])).map((m) => m.agentId)
    : null;
  const rows = await prisma.aiGuardPromptEvent.findMany({
    where: { occurredAt: { gte: from }, ...(agentFilter ? { agentId: { in: agentFilter } } : {}) },
    orderBy: { occurredAt: "desc" },
    take: 500,
    include: { agent: { select: { hostname: true } }, policy: { select: { name: true } } },
  });
  const apps = new Map((await listAiApps()).map((a) => [a.key, a.name]));
  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurredAt.toISOString(),
    agentId: r.agentId,
    hostname: r.agent.hostname,
    username: r.username,
    appName: (r.appKey && apps.get(r.appKey)) || r.host,
    host: r.host,
    channel: r.channel,
    action: r.action,
    dataTypes: parseList(r.dataTypes),
    maskedSample: r.maskedSample,
    fileName: r.fileName,
    policyName: r.policy?.name ?? null,
  }));
}

// Does any AI policy with prompt protection apply to this endpoint? (The agent then installs the
// Browser Guard extension, as it does for email attachment blocking.)
export async function promptProtectionAppliesTo(agentId: string): Promise<boolean> {
  return (await activeAiPoliciesForAgent(agentId)).some((p) => p.promptProtection);
}
