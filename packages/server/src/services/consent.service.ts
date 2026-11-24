import { z } from "zod";
import {
  CONSENT_MIN_AGENT_VERSION,
  DEFAULT_CONSENT_NOTICE,
  endpointConsentState,
  type AgentConsentWire,
  type ConsentDecision,
  type EndpointConsentState,
} from "@em/shared";
import { prisma } from "../db";

// Endpoint user consent (DPDP) - see @em/shared data/consent.ts for the rule.
//
// The notice is versioned: changing its text or grievance contact makes a new version, which every
// user is asked to answer again; switching consent on or off doesn't. Each Windows user's answer is
// kept per endpoint (EndpointUserConsent); the agent reports who is signed in with every check-in,
// and an endpoint's state comes from the answers of the users signed in to it most recently.

export class ConsentError extends Error {}


// Users reported within this window of an endpoint's latest report count as signed in together.
const SIGNED_IN_WINDOW_MS = 10 * 60 * 1000;
// lastActiveAt is refreshed at most this often (check-ins come every minute).
const TOUCH_EVERY_MS = 2 * 60 * 1000;

async function latestNotice() {
  return prisma.consentNotice.findFirst({ orderBy: { version: "desc" } });
}

export interface ConsentNoticeView {
  saved: boolean; // false: nothing saved yet - the built-in starting text is shown
  required: boolean;
  version: number;
  title: string;
  body: string;
  grievanceContact: string;
  updatedAt: string | null;
}

export async function getNotice(): Promise<ConsentNoticeView> {
  const n = await latestNotice();
  if (!n) return { saved: false, required: false, version: 0, ...DEFAULT_CONSENT_NOTICE, grievanceContact: "", updatedAt: null };
  return { saved: true, required: n.required, version: n.version, title: n.title, body: n.body, grievanceContact: n.grievanceContact, updatedAt: n.createdAt.toISOString() };
}

export const noticeInputSchema = z.object({
  required: z.boolean(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  grievanceContact: z.string().trim().max(500),
});

export async function saveNotice(input: z.infer<typeof noticeInputSchema>, adminId: string): Promise<ConsentNoticeView> {
  if (input.required && !input.grievanceContact) {
    throw new ConsentError("Add the grievance contact (name and email or phone of the person users contact about their data) before requiring consent.");
  }
  const current = await latestNotice();
  const sameText = current && current.title === input.title && current.body === input.body && current.grievanceContact === input.grievanceContact;
  if (current && sameText) {
    await prisma.consentNotice.update({ where: { id: current.id }, data: { required: input.required } });
  } else {
    await prisma.consentNotice.create({
      data: { version: (current?.version ?? 0) + 1, required: input.required, title: input.title, body: input.body, grievanceContact: input.grievanceContact, createdByAdminId: adminId },
    });
  }
  return getNotice();
}

// ---- Agent side ---------------------------------------------------------------------------------------

export async function agentConsent(agentId: string): Promise<AgentConsentWire> {
  const n = await latestNotice();
  const rows = await prisma.endpointUserConsent.findMany({ where: { agentId } });
  return {
    required: !!n?.required,
    version: n?.version ?? 0,
    title: n?.title ?? "",
    body: n?.body ?? "",
    grievanceContact: n?.grievanceContact ?? "",
    answers: rows.map((r) => ({ account: r.account, decision: r.decision as ConsentDecision, noticeVersion: r.noticeVersion })),
  };
}

export async function recordDecision(agentId: string, account: string, decision: "AGREED" | "DECLINED", version: number): Promise<void> {
  const n = await latestNotice();
  if (!n || n.version !== version) throw new ConsentError("The notice has changed. Close this window and open it again to read the current one.");
  const now = new Date();
  await prisma.endpointUserConsent.upsert({
    where: { agentId_account: { agentId, account } },
    create: { agentId, account, decision, noticeVersion: version, decidedAt: now, lastActiveAt: now },
    update: { decision, noticeVersion: version, decidedAt: now, lastActiveAt: now },
  });
}

// Check-in: who is signed in to the endpoint now.
export async function touchSignedInUsers(agentId: string, accounts: string[]): Promise<void> {
  if (accounts.length === 0) return;
  const unique = [...new Set(accounts.map((a) => a.trim()).filter(Boolean))].slice(0, 50);
  const existing = await prisma.endpointUserConsent.findMany({ where: { agentId, account: { in: unique } }, select: { account: true, lastActiveAt: true } });
  const now = Date.now();
  const stale = existing.filter((e) => now - e.lastActiveAt.getTime() > TOUCH_EVERY_MS).map((e) => e.account);
  const known = new Set(existing.map((e) => e.account.toLowerCase()));
  const fresh = unique.filter((a) => !known.has(a.toLowerCase()));
  if (stale.length > 0) await prisma.endpointUserConsent.updateMany({ where: { agentId, account: { in: stale } }, data: { lastActiveAt: new Date(now) } });
  for (const account of fresh) {
    await prisma.endpointUserConsent.create({ data: { agentId, account, lastActiveAt: new Date(now) } }).catch(() => {
      // created meanwhile by a decision - nothing to do
    });
  }
}

// ---- Console -------------------------------------------------------------------------------------------

function versionAtLeast(version: string | null, min: string): boolean {
  if (!version) return false;
  const a = version.split(".").map((x) => parseInt(x, 10) || 0);
  const b = min.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

export interface EndpointConsentView {
  // null: consent isn't asked on this endpoint (switched off, or not a Windows endpoint).
  state: EndpointConsentState | null;
  needsAgentUpdate: boolean; // Windows agent older than the consent form
  users: { account: string; decision: ConsentDecision; current: boolean }[]; // the users signed in most recently
}

export async function endpointConsentStates(agents: { id: string; osPlatform: string; agentVersion: string | null }[]): Promise<Map<string, EndpointConsentView>> {
  const out = new Map<string, EndpointConsentView>();
  const n = await latestNotice();
  if (!n?.required) {
    for (const a of agents) out.set(a.id, { state: null, needsAgentUpdate: false, users: [] });
    return out;
  }
  const windows = agents.filter((a) => a.osPlatform === "win32");
  const rows = windows.length
    ? await prisma.endpointUserConsent.findMany({ where: { agentId: { in: windows.map((a) => a.id) } }, orderBy: { lastActiveAt: "desc" } })
    : [];
  const byAgent = new Map<string, typeof rows>();
  for (const r of rows) byAgent.set(r.agentId, [...(byAgent.get(r.agentId) ?? []), r]);
  for (const a of agents) {
    if (a.osPlatform !== "win32") {
      out.set(a.id, { state: null, needsAgentUpdate: false, users: [] });
      continue;
    }
    const list = byAgent.get(a.id) ?? [];
    const newest = list[0]?.lastActiveAt.getTime() ?? 0;
    const current = list.filter((r) => newest - r.lastActiveAt.getTime() <= SIGNED_IN_WINDOW_MS);
    const answers = current.map((r) => ({ account: r.account, decision: r.decision as ConsentDecision, noticeVersion: r.noticeVersion }));
    out.set(a.id, {
      state: endpointConsentState(true, n.version, answers),
      needsAgentUpdate: !versionAtLeast(a.agentVersion, CONSENT_MIN_AGENT_VERSION),
      users: answers.map((x) => ({ account: x.account, decision: x.noticeVersion === n.version ? x.decision : "PENDING", current: true })),
    });
  }
  return out;
}

export interface EndpointConsentRecordView {
  account: string;
  decision: ConsentDecision; // for the notice in force (an answer to an older version is PENDING)
  answeredVersion: number | null;
  answeredDecision: ConsentDecision;
  decidedAt: string | null;
  lastActiveAt: string;
}

// Every user's answer on one endpoint (the endpoint's Overview).
export async function endpointConsentRecords(agentId: string): Promise<{ required: boolean; version: number; users: EndpointConsentRecordView[] }> {
  const n = await latestNotice();
  const rows = await prisma.endpointUserConsent.findMany({ where: { agentId }, orderBy: { lastActiveAt: "desc" } });
  return {
    required: !!n?.required,
    version: n?.version ?? 0,
    users: rows.map((r) => ({
      account: r.account,
      decision: n && r.noticeVersion === n.version ? (r.decision as ConsentDecision) : "PENDING",
      answeredVersion: r.noticeVersion,
      answeredDecision: r.decision as ConsentDecision,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      lastActiveAt: r.lastActiveAt.toISOString(),
    })),
  };
}
