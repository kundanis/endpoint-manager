import crypto from "node:crypto";
import axios from "axios";
import type {
  ActivateRequest,
  ActivateResponse,
  LicenseModule,
  RevalidateRequest,
  RevalidateResponse,
  UnlockRequestRequest,
} from "@license/shared";
import { prisma } from "../db";
import { config } from "../config";
import { buildLicenseServerClient } from "../licenseServerClient";
import { decryptField, encryptField } from "../utils/fieldEncryption";
import { LicenseServerUnreachableError, getConfiguredServerUrl } from "./licenseServerConfig.service";

export { LicenseServerUnreachableError };
export class NotLicensedError extends Error {}
export class AgentCapExceededError extends Error {}
export class NoActivationError extends Error {}
export class ActivationDeniedError extends Error {}
export class UnlockRequestFailedError extends Error {}

const SINGLETON_ID = "singleton";

export interface LicenseStatus {
  activated: boolean;
  // Whether LICENSE_ENFORCEMENT_ENABLED is actually on — the console needs this to know
  // whether to render module locks at all (nothing is locked while it's off).
  enforcementEnabled: boolean;
  deploymentId?: string;
  entityName?: string;
  maxAgents?: number;
  validityType?: string;
  modules?: LicenseModule[];
  validUntil?: Date | null;
  status?: string;
  activatedAt?: Date;
  lastRevalidatedAt?: Date | null;
  lastRevalidationError?: string | null;
  currentAgentCount?: number;
}

function parseModules(raw: string): LicenseModule[] {
  return JSON.parse(raw);
}

// The single source of truth for "is there a currently-valid license right now" — used
// by both assertCanEnroll (agent cap) and isModuleLicensed (module access) so the two
// enforcement paths can never disagree about what counts as licensed. Returns null for
// anything that should be treated as unlicensed: no activation, explicitly revoked,
// past validUntil, or an unreachable-License-Server outage that has outlasted the
// offline grace window.
async function getEffectiveLicense() {
  const existing = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  if (!existing) return null;
  if (existing.status === "REVOKED") return null;
  if (existing.validUntil && existing.validUntil.getTime() < Date.now()) return null;

  if (existing.lastRevalidationError) {
    const lastKnownGoodAt = existing.lastRevalidatedAt ?? existing.activatedAt;
    const graceDeadline = lastKnownGoodAt.getTime() + config.licenseOfflineGraceDays * 24 * 60 * 60 * 1000;
    if (Date.now() > graceDeadline) return null;
  }

  return existing;
}

export async function getStatus(): Promise<LicenseStatus> {
  const existing = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  if (!existing) return { activated: false, enforcementEnabled: config.licenseEnforcementEnabled };

  const currentAgentCount = await prisma.agent.count();
  return {
    activated: true,
    enforcementEnabled: config.licenseEnforcementEnabled,
    deploymentId: existing.deploymentId,
    entityName: existing.entityName,
    maxAgents: existing.maxAgents,
    validityType: existing.validityType,
    modules: parseModules(existing.modules),
    validUntil: existing.validUntil,
    status: existing.status,
    activatedAt: existing.activatedAt,
    lastRevalidatedAt: existing.lastRevalidatedAt,
    lastRevalidationError: existing.lastRevalidationError,
    currentAgentCount,
  };
}

export async function activate(keyString: string): Promise<LicenseStatus> {
  const serverUrl = await getConfiguredServerUrl();
  const client = buildLicenseServerClient(serverUrl);

  const existing = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  // deploymentId identifies THIS install to the License Server, independent of which
  // license key it currently holds — generated once and kept stable across re-activations
  // (e.g. after an unlock-request round trip with a replacement key).
  const deploymentId = existing?.deploymentId ?? crypto.randomUUID();

  let data: ActivateResponse;
  try {
    const body: ActivateRequest = { keyString, deploymentId };
    const response = await client.post<ActivateResponse>("/api/activate", body);
    data = response.data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      throw new ActivationDeniedError(err.response.data?.error ?? "Activation failed");
    }
    throw new LicenseServerUnreachableError();
  }

  const now = new Date();
  const record = {
    deploymentId,
    entityName: data.entityName,
    maxAgents: data.maxAgents,
    validityType: data.validityType,
    modules: JSON.stringify(data.modules),
    validUntil: data.validUntil ? new Date(data.validUntil) : null,
    keyStringEncrypted: encryptField(keyString),
    bindingTokenEncrypted: encryptField(data.bindingToken),
    status: "ACTIVATED",
    activatedAt: now,
    lastRevalidatedAt: now,
    lastRevalidationError: null,
  };

  await prisma.licenseActivation.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...record },
    update: record,
  });

  return getStatus();
}

export async function requestUnlock(reason: string): Promise<void> {
  const serverUrl = await getConfiguredServerUrl();
  const client = buildLicenseServerClient(serverUrl);

  const existing = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  if (!existing) throw new NoActivationError();

  const keyString = decryptField(existing.keyStringEncrypted);
  try {
    const body: UnlockRequestRequest = { keyString, deploymentId: existing.deploymentId, reason };
    await client.post("/api/unlock-request", body);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      throw new UnlockRequestFailedError(err.response.data?.error ?? "Unlock request failed");
    }
    throw new LicenseServerUnreachableError();
  }
}

// Called periodically (see index.ts's revalidation loop), never inline on the enrollment
// path. Distinguishes an explicit REVOKED/EXPIRED response (fail closed immediately, status
// flips to REVOKED) from the License Server simply being unreachable (fail open — leaves
// status untouched and just records the error; getEffectiveLicense above is what actually
// enforces the offline grace window against lastRevalidatedAt).
export async function revalidate(): Promise<void> {
  const existing = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  if (!existing) return;

  let serverUrl: string;
  try {
    serverUrl = await getConfiguredServerUrl();
  } catch {
    // Not configured (or the config row's URL was cleared) is treated the same as
    // unreachable, not as an explicit denial — never flips status to REVOKED for this.
    await prisma.licenseActivation.update({
      where: { id: SINGLETON_ID },
      data: { lastRevalidationError: "License Server is not configured" },
    });
    return;
  }
  const client = buildLicenseServerClient(serverUrl);

  const keyString = decryptField(existing.keyStringEncrypted);
  const bindingToken = decryptField(existing.bindingTokenEncrypted);

  try {
    const body: RevalidateRequest = { keyString, deploymentId: existing.deploymentId, bindingToken };
    const response = await client.post<RevalidateResponse>("/api/revalidate", body);
    const data = response.data;

    await prisma.licenseActivation.update({
      where: { id: SINGLETON_ID },
      data: {
        status: data.status,
        maxAgents: data.maxAgents,
        validityType: data.validityType,
        modules: JSON.stringify(data.modules),
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        lastRevalidatedAt: new Date(),
        lastRevalidationError: null,
      },
    });
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      await prisma.licenseActivation.update({
        where: { id: SINGLETON_ID },
        data: {
          status: "REVOKED",
          lastRevalidationError: err.response.data?.error ?? "Revalidation denied by License Server",
        },
      });
      return;
    }

    await prisma.licenseActivation.update({
      where: { id: SINGLETON_ID },
      data: { lastRevalidationError: "License Server unreachable" },
    });
  }
}

// The only function the enrollment path actually calls. A no-op when enforcement is
// disabled (see config.licenseEnforcementEnabled) so the rest of this plumbing can be
// built and verified before it ever blocks a real enrollment.
export async function assertCanEnroll(): Promise<void> {
  if (!config.licenseEnforcementEnabled) return;

  const license = await getEffectiveLicense();
  if (!license) throw new NotLicensedError();

  const currentAgentCount = await prisma.agent.count();
  if (currentAgentCount >= license.maxAgents) throw new AgentCapExceededError();
}

// Gate for admin-console API access to a specific top-level module (see requireModule
// middleware) — completely independent of assertCanEnroll's agent-cap check, since a
// deployment can be fully licensed for enrollment but still not include every module.
export async function isModuleLicensed(moduleKey: LicenseModule): Promise<boolean> {
  if (!config.licenseEnforcementEnabled) return true;

  const license = await getEffectiveLicense();
  if (!license) return false;

  return parseModules(license.modules).includes(moduleKey);
}
