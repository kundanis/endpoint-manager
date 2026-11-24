import axios from "axios";
import type {
  LicenseChangeRequestWire,
  LicenseTerms,
  PendingLicenseChangesRequest,
  PendingLicenseChangesResponse,
  RespondToLicenseChangeRequest,
  RespondToLicenseChangeResponse,
} from "@license/shared";
import { prisma } from "../db";
import { logger } from "../logger";
import { buildLicenseServerClient } from "../licenseServerClient";
import { decryptField } from "../utils/fieldEncryption";
import { emitInvalidate } from "../events/bus";
import { getConfiguredServerUrl } from "./licenseServerConfig.service";
import { verifyLicenseServerSecret } from "./licenseActivation.service";
import { featureChanges } from "@license/shared";
import { storedFeatures } from "./licenseActivation.service";

// Licence change requests received from the License Server (see @license/shared
// changeRequest.schema.ts). Nothing here ever polls: requests arrive as pushes, or when a super
// admin presses "Check for licence requests". The licence itself changes only when a super admin
// accepts (the new terms are then fetched from the License Server, never taken from the push),
// or when a reduction reaches its deadline.

const SINGLETON_ID = "singleton";
const AUTO_APPLY_CHECK_MS = 15 * 60 * 1000;

export class NoLicenseError extends Error {}
export class ChangeRequestNotFoundError extends Error {}
export class ChangeRequestNotOpenError extends Error {}
export class LicenseServerError extends Error {}

type NoticeRow = Awaited<ReturnType<typeof prisma.licenseChangeNotice.findFirstOrThrow>>;

export interface LicenseChangeNoticeView {
  id: string;
  kind: "ADDITION" | "REDUCTION" | "REVOKE";
  status: string;
  message: string | null;
  current: LicenseTerms | null;
  proposed: LicenseTerms | null;
  requestedAt: string;
  autoApplyAt: string | null;
  receivedAt: string;
  respondedAt: string | null;
  respondedByEmail: string | null;
  responseReason: string | null;
  appliedAt: string | null;
  // Can a super admin still accept / reject it?
  canAccept: boolean;
  canReject: boolean;
}

function isOpen(row: Pick<NoticeRow, "status" | "kind" | "appliedAt">): boolean {
  if (row.appliedAt) return false;
  return row.status === "PENDING" || (row.status === "REJECTED" && row.kind === "REDUCTION");
}

async function toView(rows: NoticeRow[]): Promise<LicenseChangeNoticeView[]> {
  const adminIds = [...new Set(rows.map((r) => r.respondedByAdminId).filter((x): x is string => !!x))];
  const admins = adminIds.length ? await prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true } }) : [];
  const emailById = new Map(admins.map((a) => [a.id, a.email]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as LicenseChangeNoticeView["kind"],
    status: r.status,
    message: r.message,
    current: r.currentTerms ? (JSON.parse(r.currentTerms) as LicenseTerms) : null,
    proposed: r.proposedTerms ? (JSON.parse(r.proposedTerms) as LicenseTerms) : null,
    requestedAt: r.requestedAt.toISOString(),
    autoApplyAt: r.autoApplyAt?.toISOString() ?? null,
    receivedAt: r.receivedAt.toISOString(),
    respondedAt: r.respondedAt?.toISOString() ?? null,
    respondedByEmail: r.respondedByAdminId ? (emailById.get(r.respondedByAdminId) ?? null) : null,
    responseReason: r.responseReason,
    appliedAt: r.appliedAt?.toISOString() ?? null,
    canAccept: r.kind !== "REVOKE" && isOpen(r),
    canReject: r.kind !== "REVOKE" && !r.appliedAt && r.status === "PENDING",
  }));
}

export async function listLicenseChangeNotices(): Promise<LicenseChangeNoticeView[]> {
  const rows = await prisma.licenseChangeNotice.findMany({ orderBy: { receivedAt: "desc" }, take: 100 });
  return toView(rows);
}

export async function countOpenLicenseChangeNotices(): Promise<{ total: number; latestAt: Date | null; newSince: (since: Date) => number }> {
  const rows = await prisma.licenseChangeNotice.findMany({
    where: { kind: { in: ["ADDITION", "REDUCTION"] }, status: { in: ["PENDING", "REJECTED"] }, appliedAt: null },
    select: { status: true, kind: true, appliedAt: true, receivedAt: true },
  });
  const open = rows.filter(isOpen);
  const latestAt = open.reduce<Date | null>((m, r) => (!m || r.receivedAt > m ? r.receivedAt : m), null);
  return { total: open.length, latestAt, newSince: (since) => open.filter((r) => r.receivedAt > since).length };
}

// --- Applying terms ----------------------------------------------------------------------------

async function applyTerms(terms: LicenseTerms) {
  await prisma.licenseActivation.update({
    where: { id: SINGLETON_ID },
    data: {
      maxAgents: terms.maxAgents,
      validityType: terms.validityType,
      validUntil: terms.validUntil ? new Date(terms.validUntil) : null,
      modules: JSON.stringify(terms.modules),
      features: storedFeatures(terms.modules, terms.features),
    },
  });
}

async function currentTerms(): Promise<LicenseTerms | null> {
  const a = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  if (!a || a.status === "REVOKED") return null;
  return {
    maxAgents: a.maxAgents,
    validityType: a.validityType as LicenseTerms["validityType"],
    validUntil: a.validUntil ? a.validUntil.toISOString() : null,
    modules: JSON.parse(a.modules),
    features: a.features ? (JSON.parse(a.features) as string[]) : null,
  };
}

// A reduction applied from the pushed copy (at its deadline) must really only take things away
// compared with the licence in force here - so a forged or tampered push could never grant
// anything this way.
export function onlyReduces(current: LicenseTerms, proposed: LicenseTerms): boolean {
  const cur = current.validUntil ? Date.parse(current.validUntil) : Infinity;
  const next = proposed.validUntil ? Date.parse(proposed.validUntil) : Infinity;
  // Features too: nothing the current licence lacks may appear.
  const { added } = featureChanges(current, proposed);
  return proposed.modules.every((m) => current.modules.includes(m)) && added.length === 0 && proposed.maxAgents <= current.maxAgents && next <= cur;
}

async function applyReductionLocally(row: NoticeRow, status: "AUTO_APPLIED"): Promise<boolean> {
  const current = await currentTerms();
  if (!current || !row.proposedTerms) return false;
  const proposed = JSON.parse(row.proposedTerms) as LicenseTerms;
  if (!onlyReduces(current, proposed)) {
    logger.warn({ noticeId: row.id }, "Licence reduction not applied: it would add something compared with the current licence");
    return false;
  }
  await applyTerms(proposed);
  await prisma.licenseChangeNotice.update({ where: { id: row.id }, data: { status, appliedAt: new Date() } });
  logger.info({ noticeId: row.id }, "Licence reduction applied at its deadline");
  return true;
}

// --- Receiving --------------------------------------------------------------------------------

// Records a request (or a later state of one) from the License Server. Never applies an addition.
async function upsertFromWire(req: LicenseChangeRequestWire): Promise<void> {
  const existing = await prisma.licenseChangeNotice.findUnique({ where: { remoteId: req.id } });
  if (!existing) {
    if (req.status === "CANCELLED") return; // withdrawn before it ever reached us
    const created = await prisma.licenseChangeNotice.create({
      data: {
        remoteId: req.id,
        kind: req.kind,
        status: req.status === "AUTO_APPLIED" ? "PENDING" : req.status, // applied below after checks
        message: req.message,
        currentTerms: JSON.stringify(req.current),
        proposedTerms: JSON.stringify(req.proposed),
        requestedAt: new Date(req.createdAt),
        autoApplyAt: req.autoApplyAt ? new Date(req.autoApplyAt) : null,
      },
    });
    if (req.status === "AUTO_APPLIED" && req.kind === "REDUCTION") await applyReductionLocally(created, "AUTO_APPLIED");
    return;
  }
  if (existing.appliedAt) return; // already in force here - nothing to update
  if (req.status === "CANCELLED") {
    await prisma.licenseChangeNotice.update({ where: { id: existing.id }, data: { status: "CANCELLED" } });
  } else if (req.status === "AUTO_APPLIED" && existing.kind === "REDUCTION") {
    await applyReductionLocally(existing, "AUTO_APPLIED");
  }
}

export async function receiveLicenseChangeNotice(deploymentId: string, secret: string, req: LicenseChangeRequestWire): Promise<boolean> {
  if (!(await verifyLicenseServerSecret(deploymentId, secret))) return false;
  await upsertFromWire(req);
  emitInvalidate(["licenseChangeNotices", "notifications"]);
  return true;
}

// --- Talking to the License Server (binding proof) ------------------------------------------

async function bindingProof() {
  const a = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  if (!a) throw new NoLicenseError();
  return {
    keyString: decryptField(a.keyStringEncrypted),
    deploymentId: a.deploymentId,
    bindingToken: decryptField(a.bindingTokenEncrypted),
  };
}

async function callLicenseServer<T>(path: string, body: unknown): Promise<T> {
  const client = buildLicenseServerClient(await getConfiguredServerUrl());
  try {
    return (await client.post<T>(path, body)).data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      throw new LicenseServerError(err.response.data?.error ?? `The License Server refused it (HTTP ${err.response.status})`);
    }
    throw new LicenseServerError("The License Server can't be reached right now - try again later");
  }
}

export async function checkForLicenseChanges(): Promise<number> {
  const proof: PendingLicenseChangesRequest = await bindingProof();
  const result = await callLicenseServer<PendingLicenseChangesResponse>("/api/change-requests/pending", proof);
  for (const r of result.requests) await upsertFromWire(r);
  emitInvalidate(["licenseChangeNotices", "notifications"]);
  return (await countOpenLicenseChangeNotices()).total;
}

export async function respondToLicenseChange(id: string, decision: "ACCEPT" | "REJECT", adminId: string, reason?: string) {
  const row = await prisma.licenseChangeNotice.findUnique({ where: { id } });
  if (!row || row.kind === "REVOKE") throw new ChangeRequestNotFoundError();
  const allowed = decision === "ACCEPT" ? isOpen(row) : !row.appliedAt && row.status === "PENDING";
  if (!allowed) throw new ChangeRequestNotOpenError();

  const body: RespondToLicenseChangeRequest = { ...(await bindingProof()), requestId: row.remoteId, decision, reason: reason?.trim() || undefined };
  const result = await callLicenseServer<RespondToLicenseChangeResponse>("/api/change-requests/respond", body);

  if (decision === "ACCEPT") {
    // The terms come from the License Server's answer, not from the pushed request.
    await applyTerms(result.terms);
    await prisma.licenseChangeNotice.update({
      where: { id },
      data: { status: "ACCEPTED", respondedAt: new Date(), respondedByAdminId: adminId, appliedAt: new Date(), responseReason: null },
    });
  } else {
    await prisma.licenseChangeNotice.update({
      where: { id },
      data: { status: "REJECTED", respondedAt: new Date(), respondedByAdminId: adminId, responseReason: reason?.trim() || null },
    });
  }
  emitInvalidate(["licenseChangeNotices", "notifications", "licenseStatus"]);
  return (await toView([await prisma.licenseChangeNotice.findUniqueOrThrow({ where: { id } })]))[0];
}

// Reductions apply at their deadline on this server's own clock - the License Server does the
// same on its side, so neither has to reach the other.
export function scheduleLicenseReductionAutoApply() {
  async function tick() {
    try {
      const due = await prisma.licenseChangeNotice.findMany({
        where: { kind: "REDUCTION", status: { in: ["PENDING", "REJECTED"] }, appliedAt: null, autoApplyAt: { lte: new Date() } },
      });
      for (const row of due) await applyReductionLocally(row, "AUTO_APPLIED");
      if (due.length > 0) emitInvalidate(["licenseChangeNotices", "notifications", "licenseStatus"]);
    } catch (err) {
      logger.error({ err }, "Licence reduction check failed");
    }
  }
  void tick();
  setInterval(tick, AUTO_APPLY_CHECK_MS);
}
