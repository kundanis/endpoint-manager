import { featureChanges, normalizeFeatures } from "@license/shared";
import { storedFeatures } from "./features.util";
import {
  LICENSE_CHANGE_NOTICE_PATH,
  REDUCTION_AUTO_APPLY_DAYS,
  type LicenseChangeKind,
  type LicenseChangeNotice,
  type LicenseChangeRequestWire,
  type LicenseModule,
  type LicenseTerms,
  type ValidityType,
} from "@license/shared";
import { prisma } from "../db";
import { logger } from "../logger";
import { findBoundKey } from "./activation.service";

// Licence change requests (see @license/shared changeRequest.schema.ts). The vendor proposes
// new terms for an activated key; the request is pushed to the bound deployment, whose admin
// accepts or rejects it. The key's terms change only on acceptance or - for a reduction - at
// autoApplyAt. Deployments never poll: delivery is a push, retried until it lands, plus a
// one-off "check for requests" the customer's admin can trigger.

export class ChangeRequestKeyNotActiveError extends Error {}
export class ChangeRequestNoChangeError extends Error {}
export class ChangeRequestNotFoundError extends Error {}
export class ChangeRequestClosedError extends Error {}

const RETRY_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;
// How far back the deployment's "check for requests" looks.
const PENDING_LOOKBACK_DAYS = 90;

type KeyRow = { maxAgents: number; validityType: string; validUntil: Date | null; modules: string; features: string | null };
type RequestRow = {
  id: string;
  kind: string;
  status: string;
  message: string | null;
  currentTerms: string;
  proposedTerms: string;
  createdAt: Date;
  autoApplyAt: Date | null;
};

export function termsOfKey(key: KeyRow): LicenseTerms {
  return {
    maxAgents: key.maxAgents,
    validityType: key.validityType as ValidityType,
    validUntil: key.validUntil ? key.validUntil.toISOString() : null,
    modules: JSON.parse(key.modules) as LicenseModule[],
    features: key.features ? (JSON.parse(key.features) as string[]) : null,
  };
}

export function toWire(row: RequestRow): LicenseChangeRequestWire {
  return {
    id: row.id,
    kind: row.kind as LicenseChangeKind,
    status: row.status as LicenseChangeRequestWire["status"],
    message: row.message,
    current: JSON.parse(row.currentTerms) as LicenseTerms,
    proposed: JSON.parse(row.proposedTerms) as LicenseTerms,
    createdAt: row.createdAt.toISOString(),
    autoApplyAt: row.autoApplyAt ? row.autoApplyAt.toISOString() : null,
  };
}

// REDUCTION when anything is taken away (a module, endpoints, time) - even if something is
// added at the same time; ADDITION when there are only gains; null when nothing changes.
export function classifyChange(current: LicenseTerms, proposed: LicenseTerms): LicenseChangeKind | null {
  // Modules and the features within them (a module added or removed counts through its features).
  const { added, removed } = featureChanges(current, proposed);
  const removedModule = current.modules.some((m) => !proposed.modules.includes(m)) || removed.length > 0;
  const addedModule = proposed.modules.some((m) => !current.modules.includes(m)) || added.length > 0;
  const cur = current.validUntil ? Date.parse(current.validUntil) : Infinity;
  const next = proposed.validUntil ? Date.parse(proposed.validUntil) : Infinity;
  const reduced = removedModule || proposed.maxAgents < current.maxAgents || next < cur;
  const gained = addedModule || proposed.maxAgents > current.maxAgents || next > cur;
  if (reduced) return "REDUCTION";
  if (gained) return "ADDITION";
  return null;
}

async function applyTermsToKey(licenseKeyId: string, terms: LicenseTerms) {
  await prisma.licenseKey.update({
    where: { id: licenseKeyId },
    data: {
      maxAgents: terms.maxAgents,
      validityType: terms.validityType,
      validUntil: terms.validUntil ? new Date(terms.validUntil) : null,
      modules: JSON.stringify(terms.modules),
      features: storedFeatures(terms.modules, terms.features ?? null),
    },
  });
}

export interface CreateChangeRequestInput {
  modules: LicenseModule[];
  features?: string[] | null; // null/absent = everything in the modules
  maxAgents: number;
  validUntil: string | null; // null = perpetual
  message?: string;
}

export async function createChangeRequest(licenseKeyId: string, input: CreateChangeRequestInput, adminId: string) {
  const key = await prisma.licenseKey.findUnique({ where: { id: licenseKeyId } });
  if (!key) throw new ChangeRequestNotFoundError();
  if (key.status !== "ACTIVATED" || !key.boundDeploymentId) throw new ChangeRequestKeyNotActiveError();

  const current = termsOfKey(key);
  const proposed: LicenseTerms = {
    maxAgents: input.maxAgents,
    // The key's term label only says "perpetual" or not; the end date is what counts.
    validityType: input.validUntil === null ? "PERPETUAL" : current.validityType === "PERPETUAL" ? "ONE_YEAR" : current.validityType,
    validUntil: input.validUntil === null ? null : new Date(input.validUntil).toISOString(),
    modules: [...new Set(input.modules)],
    features: normalizeFeatures([...new Set(input.modules)], input.features ?? null),
  };
  const kind = classifyChange(current, proposed);
  if (!kind) throw new ChangeRequestNoChangeError();

  // One open request per key: a new one replaces whatever was still waiting.
  const replaced = await prisma.licenseChangeRequest.findMany({
    where: { licenseKeyId, status: "PENDING" },
    select: { id: true },
  });
  if (replaced.length > 0) {
    await prisma.licenseChangeRequest.updateMany({
      where: { id: { in: replaced.map((r) => r.id) } },
      data: { status: "CANCELLED" },
    });
  }

  const created = await prisma.licenseChangeRequest.create({
    data: {
      licenseKeyId,
      kind,
      message: input.message?.trim() || null,
      currentTerms: JSON.stringify(current),
      proposedTerms: JSON.stringify(proposed),
      autoApplyAt: kind === "REDUCTION" ? new Date(Date.now() + REDUCTION_AUTO_APPLY_DAYS * DAY_MS) : null,
      createdByAdminId: adminId,
    },
  });

  for (const r of replaced) await deliverChangeNotice(r.id);
  await deliverChangeNotice(created.id);
  return getChangeRequest(created.id);
}

export async function getChangeRequest(id: string) {
  const row = await prisma.licenseChangeRequest.findUnique({ where: { id } });
  if (!row) throw new ChangeRequestNotFoundError();
  return toAdminRow(row);
}

function toAdminRow(row: Awaited<ReturnType<typeof prisma.licenseChangeRequest.findFirstOrThrow>>) {
  return {
    ...toWire(row),
    licenseKeyId: row.licenseKeyId,
    createdByAdminId: row.createdByAdminId,
    delivered: row.deliveredStatus === row.status,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    lastDeliveryError: row.lastDeliveryError,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    responseReason: row.responseReason,
    appliedAt: row.appliedAt?.toISOString() ?? null,
  };
}

export async function listChangeRequests(licenseKeyId: string) {
  const rows = await prisma.licenseChangeRequest.findMany({ where: { licenseKeyId }, orderBy: { createdAt: "desc" } });
  return rows.map(toAdminRow);
}

export async function cancelChangeRequest(id: string) {
  const result = await prisma.licenseChangeRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (result.count !== 1) throw new ChangeRequestClosedError();
  await deliverChangeNotice(id);
  return getChangeRequest(id);
}

// Revoking a key closes whatever was still waiting on it (the revoke notice tells the
// deployment; there's nothing left for it to accept).
export async function cancelOpenRequestsForKey(licenseKeyId: string) {
  await prisma.licenseChangeRequest.updateMany({
    where: { licenseKeyId, status: { in: ["PENDING", "REJECTED"] }, appliedAt: null },
    data: { status: "CANCELLED", deliveredStatus: "CANCELLED" },
  });
}

// Pushes the request's current state to the bound deployment. True when it landed (or there
// was nothing new to tell).
export async function deliverChangeNotice(id: string): Promise<boolean> {
  const row = await prisma.licenseChangeRequest.findUnique({ where: { id }, include: { licenseKey: true } });
  if (!row) return false;
  if (row.deliveredStatus === row.status) return true;
  const key = row.licenseKey;
  if (!key.boundDeploymentId || key.status !== "ACTIVATED") return false;
  if (!key.revocationSecret || !key.callbackUrls) {
    await prisma.licenseChangeRequest.update({
      where: { id },
      data: { lastDeliveryError: "The deployment hasn't registered a callback address yet - ask the customer to use Check for licence requests" },
    });
    return false;
  }

  const body: LicenseChangeNotice = { deploymentId: key.boundDeploymentId, revocationSecret: key.revocationSecret, request: toWire(row) };
  const errors: string[] = [];
  for (const baseUrl of JSON.parse(key.callbackUrls) as string[]) {
    try {
      const res = await fetch(`${baseUrl}${LICENSE_CHANGE_NOTICE_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        await prisma.licenseChangeRequest.update({
          where: { id },
          data: { deliveredStatus: row.status, deliveredAt: new Date(), lastDeliveryError: null },
        });
        logger.info({ changeRequestId: id, baseUrl, status: row.status }, "Licence change notice delivered");
        return true;
      }
      errors.push(`${baseUrl}: HTTP ${res.status}`);
    } catch (err) {
      errors.push(`${baseUrl}: ${(err as Error).message}`);
    }
  }
  await prisma.licenseChangeRequest.update({ where: { id }, data: { lastDeliveryError: errors.join("; ").slice(0, 1000) } });
  logger.warn({ changeRequestId: id, errors }, "Licence change notice not delivered, will retry");
  return false;
}

// Reductions whose deadline passed apply here, on the License Server's own clock - the
// deployment applies the same request at the same time on its own.
async function autoApplyDueReductions() {
  const due = await prisma.licenseChangeRequest.findMany({
    where: { kind: "REDUCTION", status: { in: ["PENDING", "REJECTED"] }, appliedAt: null, autoApplyAt: { lte: new Date() } },
    include: { licenseKey: true },
  });
  for (const row of due) {
    if (row.licenseKey.status !== "ACTIVATED") continue;
    await applyTermsToKey(row.licenseKeyId, JSON.parse(row.proposedTerms) as LicenseTerms);
    await prisma.licenseChangeRequest.update({ where: { id: row.id }, data: { status: "AUTO_APPLIED", appliedAt: new Date() } });
    logger.info({ changeRequestId: row.id }, "Licence reduction applied at its deadline");
    await deliverChangeNotice(row.id);
  }
}

export function scheduleChangeRequestWork() {
  async function tick() {
    try {
      await autoApplyDueReductions();
      const recent = await prisma.licenseChangeRequest.findMany({
        where: { createdAt: { gte: new Date(Date.now() - PENDING_LOOKBACK_DAYS * DAY_MS) }, licenseKey: { status: "ACTIVATED" } },
        select: { id: true, status: true, deliveredStatus: true },
      });
      for (const r of recent) if (r.deliveredStatus !== r.status) await deliverChangeNotice(r.id);
    } catch (err) {
      logger.error({ err }, "Licence change request tick failed");
    }
  }
  tick();
  setInterval(tick, RETRY_INTERVAL_MS);
}

// --- Called by the deployment (binding proof required) ----------------------------------------

export async function respondToChangeRequest(
  proof: { keyString: string; deploymentId: string; bindingToken: string },
  requestId: string,
  decision: "ACCEPT" | "REJECT",
  reason: string | undefined,
) {
  const key = await findBoundKey(proof.keyString, proof.deploymentId, proof.bindingToken);
  const row = await prisma.licenseChangeRequest.findUnique({ where: { id: requestId } });
  if (!row || row.licenseKeyId !== key.id) throw new ChangeRequestNotFoundError();
  if (key.status !== "ACTIVATED") throw new ChangeRequestClosedError();

  if (decision === "ACCEPT") {
    // Accepting twice (e.g. the first reply was lost) just returns the result again.
    if (row.status !== "ACCEPTED" && row.status !== "AUTO_APPLIED") {
      // A rejected reduction can still be accepted before its deadline.
      const open = row.status === "PENDING" || (row.status === "REJECTED" && row.kind === "REDUCTION");
      if (!open) throw new ChangeRequestClosedError();
      await applyTermsToKey(key.id, JSON.parse(row.proposedTerms) as LicenseTerms);
      await prisma.licenseChangeRequest.update({
        where: { id: row.id },
        data: { status: "ACCEPTED", respondedAt: new Date(), appliedAt: new Date(), responseReason: null, deliveredStatus: "ACCEPTED" },
      });
    }
  } else {
    if (row.status !== "PENDING") throw new ChangeRequestClosedError();
    await prisma.licenseChangeRequest.update({
      where: { id: row.id },
      data: { status: "REJECTED", respondedAt: new Date(), responseReason: reason?.trim() || null, deliveredStatus: "REJECTED" },
    });
  }

  const updatedKey = await prisma.licenseKey.findUniqueOrThrow({ where: { id: key.id } });
  const updatedRow = await prisma.licenseChangeRequest.findUniqueOrThrow({ where: { id: row.id } });
  return { request: toWire(updatedRow), terms: termsOfKey(updatedKey) };
}

// The deployment's one-off "check for requests": every request of the last 90 days in its
// current state. Marks them delivered - the deployment now has them.
export async function pendingChangeRequestsFor(proof: { keyString: string; deploymentId: string; bindingToken: string }) {
  const key = await findBoundKey(proof.keyString, proof.deploymentId, proof.bindingToken);
  const rows = await prisma.licenseChangeRequest.findMany({
    where: { licenseKeyId: key.id, createdAt: { gte: new Date(Date.now() - PENDING_LOOKBACK_DAYS * DAY_MS) } },
    orderBy: { createdAt: "asc" },
  });
  for (const r of rows) {
    if (r.deliveredStatus !== r.status) {
      await prisma.licenseChangeRequest.update({
        where: { id: r.id },
        data: { deliveredStatus: r.status, deliveredAt: new Date(), lastDeliveryError: null },
      });
    }
  }
  return { requests: rows.map(toWire) };
}
