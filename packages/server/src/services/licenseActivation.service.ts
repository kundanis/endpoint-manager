import crypto from "node:crypto";
import axios from "axios";
import type {
  ActivateRequest,
  ActivateResponse,
  LicenseModule,
  RegisterCallbackRequest,
  RegisterCallbackResponse,
  UnlockRequestRequest,
} from "@license/shared";
import { prisma } from "../db";
import { config } from "../config";
import { buildLicenseServerClient } from "../licenseServerClient";
import { decryptField, encryptField } from "../utils/fieldEncryption";
import { getAgentConnectionSettings } from "./agentConnection.service";
import { LicenseServerUnreachableError, getConfiguredServerUrl } from "./licenseServerConfig.service";
import { isFeatureLicensed as featureLicensed, normalizeFeatures } from "@license/shared";

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
  // Features within the modules; null = everything in them.
  features?: string[] | null;
  validUntil?: Date | null;
  status?: string;
  activatedAt?: Date;
  // Where the License Server sends a revoke notice to, and when that was last registered.
  callbackUrls?: string[];
  callbackRegisteredAt?: Date | null;
  callbackRegistrationError?: string | null;
  currentAgentCount?: number;
  totalAgentsUninstalled?: number;
}

function parseModules(raw: string): LicenseModule[] {
  return JSON.parse(raw);
}

// null = everything in the licensed modules.
function parseFeatures(raw: string | null): string[] | null {
  return raw ? (JSON.parse(raw) as string[]) : null;
}

// The JSON stored for the licence's features: null when they include everything in its modules.
export function storedFeatures(modules: readonly string[], features: readonly string[] | null | undefined): string | null {
  const list = normalizeFeatures(modules, features ?? null);
  return list === null ? null : JSON.stringify(list);
}

// The single source of truth for "is there a currently-valid license right now" — used
// by both assertCanEnroll (agent cap) and isModuleLicensed (module access) so the two
// enforcement paths can never disagree about what counts as licensed. Returns null for
// anything that should be treated as unlicensed: no activation, revoked (by a revoke
// notice from the License Server), or past validUntil. Whether the License Server is
// reachable never matters once a key is activated - this deployment doesn't check back.
async function getEffectiveLicense() {
  const existing = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  if (!existing) return null;
  if (existing.status === "REVOKED") return null;
  if (existing.validUntil && existing.validUntil.getTime() < Date.now()) return null;
  return existing;
}

export async function getStatus(): Promise<LicenseStatus> {
  const existing = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  if (!existing) return { activated: false, enforcementEnabled: config.licenseEnforcementEnabled };

  // Paused agents still count against the seat cap - pausing only holds back new work
  // and releases active policy enforcement (see pause.service.ts), it doesn't relinquish
  // the seat. Only a real uninstall (confirmAgentUninstalled / the admin's manual delete)
  // frees a seat, since that's the only event that actually removes management of the
  // endpoint. Both places this deployment counts agents must stay identical - see the
  // "single source of truth" note on getEffectiveLicense above.
  const currentAgentCount = await prisma.agent.count();
  return {
    activated: true,
    enforcementEnabled: config.licenseEnforcementEnabled,
    deploymentId: existing.deploymentId,
    entityName: existing.entityName,
    maxAgents: existing.maxAgents,
    validityType: existing.validityType,
    modules: parseModules(existing.modules),
    features: parseFeatures(existing.features),
    validUntil: existing.validUntil,
    status: existing.status,
    activatedAt: existing.activatedAt,
    callbackUrls: existing.callbackUrls ? JSON.parse(existing.callbackUrls) : [],
    callbackRegisteredAt: existing.callbackRegisteredAt,
    callbackRegistrationError: existing.callbackRegistrationError,
    currentAgentCount,
    totalAgentsUninstalled: existing.totalAgentsUninstalled,
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
    features: storedFeatures(data.modules, data.features),
    validUntil: data.validUntil ? new Date(data.validUntil) : null,
    keyStringEncrypted: encryptField(keyString),
    bindingTokenEncrypted: encryptField(data.bindingToken),
    status: "ACTIVATED",
    activatedAt: now,
    lastRevalidatedAt: null,
    lastRevalidationError: null,
    // A new key means a new revocation secret - register again for this one.
    callbackUrls: null,
    revocationSecretHash: null,
    callbackRegisteredAt: null,
    callbackRegistrationError: null,
  };

  await prisma.licenseActivation.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...record },
    update: record,
  });

  // Best effort - the license is already active; scheduleLicenseCallbackRegistration
  // keeps retrying if the License Server can't be reached right now.
  await registerCallback().catch(() => {});

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

// Addresses the License Server should try when it sends a revoke notice. It usually runs in
// the cloud, so the internet-facing addresses come first; the LAN address still works when
// it sits on the same network. Same settings agents use (Agent connection settings).
async function getCallbackUrls(): Promise<string[]> {
  const settings = await getAgentConnectionSettings();
  const ordered = [settings.webUrl, settings.publicUrl, settings.localUrl ?? settings.detectedLocalUrl];
  return Array.from(new Set(ordered.filter((u): u is string => !!u)));
}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

// Tells the License Server where to send a revoke notice. Runs after activation and from
// index.ts's hourly loop, but only does anything when not yet registered or the addresses
// changed. Never touches the license itself on failure - an unreachable License Server
// just means a revoke notice can't find us yet, the license stays valid.
export async function registerCallback(): Promise<void> {
  const existing = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  if (!existing || existing.status === "REVOKED") return;

  const callbackUrls = await getCallbackUrls();
  if (existing.revocationSecretHash && existing.callbackUrls === JSON.stringify(callbackUrls)) return;

  async function recordError(message: string) {
    await prisma.licenseActivation.update({
      where: { id: SINGLETON_ID },
      data: { callbackRegistrationError: message },
    });
  }

  if (callbackUrls.length === 0) {
    return recordError("No server address to register - set one in Agent connection settings");
  }

  let serverUrl: string;
  try {
    serverUrl = await getConfiguredServerUrl();
  } catch {
    return recordError("License Server is not configured");
  }
  const client = buildLicenseServerClient(serverUrl);

  let data: RegisterCallbackResponse;
  try {
    const body: RegisterCallbackRequest = {
      keyString: decryptField(existing.keyStringEncrypted),
      deploymentId: existing.deploymentId,
      bindingToken: decryptField(existing.bindingTokenEncrypted),
      callbackUrls,
    };
    const response = await client.post<RegisterCallbackResponse>("/api/register-callback", body);
    data = response.data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      return recordError(err.response.data?.error ?? `License Server refused the registration (HTTP ${err.response.status})`);
    }
    return recordError("License Server unreachable");
  }

  await prisma.licenseActivation.update({
    where: { id: SINGLETON_ID },
    data: {
      callbackUrls: JSON.stringify(callbackUrls),
      revocationSecretHash: hashSecret(data.revocationSecret),
      callbackRegisteredAt: new Date(),
      callbackRegistrationError: null,
      // Revoked before we'd registered anywhere to be told - this response is the notice.
      ...(data.status === "REVOKED" ? { status: "REVOKED" } : {}),
    },
  });
}

// A revoke notice pushed by the License Server (routes/licenseCallback.routes.ts). Only
// accepted for this deployment and with the secret it handed us at registration.
export async function applyRevokeNotice(deploymentId: string, revocationSecret: string): Promise<boolean> {
  if (!(await verifyLicenseServerSecret(deploymentId, revocationSecret))) return false;
  const existing = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  if (existing?.status !== "REVOKED") {
    await prisma.licenseActivation.update({ where: { id: SINGLETON_ID }, data: { status: "REVOKED" } });
    // Shown under Licensing as an alert explaining what happened (licenseChange.service.ts).
    await prisma.licenseChangeNotice.create({
      data: { remoteId: `revoke:${crypto.randomUUID()}`, kind: "REVOKE", status: "APPLIED", requestedAt: new Date(), appliedAt: new Date() },
    });
  }
  return true;
}

// True when a push really comes from the License Server this deployment registered with:
// right deployment, and the secret it handed out at registration (only its hash is kept here).
export async function verifyLicenseServerSecret(deploymentId: string, secret: string): Promise<boolean> {
  const existing = await prisma.licenseActivation.findUnique({ where: { id: SINGLETON_ID } });
  if (!existing?.revocationSecretHash || existing.deploymentId !== deploymentId) return false;
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(existing.revocationSecretHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The only function the enrollment path actually calls. A no-op when enforcement is
// disabled (see config.licenseEnforcementEnabled) so the rest of this plumbing can be
// built and verified before it ever blocks a real enrollment.
export async function assertCanEnroll(): Promise<void> {
  if (!config.licenseEnforcementEnabled) return;

  const license = await getEffectiveLicense();
  if (!license) throw new NotLicensedError();

  // Paused agents still count against the seat cap - pausing only holds back new work
  // and releases active policy enforcement (see pause.service.ts), it doesn't relinquish
  // the seat. Only a real uninstall (confirmAgentUninstalled / the admin's manual delete)
  // frees a seat, since that's the only event that actually removes management of the
  // endpoint. Both places this deployment counts agents must stay identical - see the
  // "single source of truth" note on getEffectiveLicense above.
  const currentAgentCount = await prisma.agent.count();
  if (currentAgentCount >= license.maxAgents) throw new AgentCapExceededError();
}

// Called from both agent-deletion paths (the self-report uninstall confirmation and the
// admin's manual delete) - a no-op if this deployment has never activated a license at
// all, since there's nothing to track yet. Deliberately NOT gated behind
// config.licenseEnforcementEnabled: this is a historical record of usage, not an
// enforcement decision, so it should stay accurate even in an unenforced/trial setup.
export async function incrementTotalAgentsUninstalled(count = 1): Promise<void> {
  if (count <= 0) return;
  await prisma.licenseActivation.updateMany({
    where: { id: SINGLETON_ID },
    data: { totalAgentsUninstalled: { increment: count } },
  });
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

// Gate for a sub-module or feature (@license/shared features): its module must be licensed, and
// the feature with every sellable feature above it - unless the licence has no feature list
// (everything in its modules). Always true while licence enforcement is off.
export async function isFeatureLicensed(featureKey: string): Promise<boolean> {
  if (!config.licenseEnforcementEnabled) return true;
  const license = await getEffectiveLicense();
  if (!license) return false;
  return featureLicensed(featureKey, parseModules(license.modules), parseFeatures(license.features));
}
