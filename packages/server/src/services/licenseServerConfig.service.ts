import { prisma } from "../db";
import { config } from "../config";
import { buildLicenseServerClient } from "../licenseServerClient";

export class LicenseServerUnreachableError extends Error {}

const SINGLETON_ID = "singleton";

export interface LicenseServerConfigView {
  configured: boolean;
  serverUrl?: string;
  lastConnectionCheckAt?: Date | null;
  lastConnectionOk?: boolean | null;
}

export async function getLicenseServerConfig(): Promise<LicenseServerConfigView> {
  const existing = await prisma.licenseServerConfig.findUnique({ where: { id: SINGLETON_ID } });
  if (!existing) {
    // Falls back to the optional env seed only for local dev convenience — a real
    // deployment has nothing here until the admin configures it via the console.
    if (config.licenseServerUrlSeed) {
      return { configured: false, serverUrl: config.licenseServerUrlSeed };
    }
    return { configured: false };
  }
  return {
    configured: true,
    serverUrl: existing.serverUrl,
    lastConnectionCheckAt: existing.lastConnectionCheckAt,
    lastConnectionOk: existing.lastConnectionOk,
  };
}

// Returns the currently-configured base URL, throwing a clear error if none has ever
// been set — the only entry point activate()/revalidate()/requestUnlock() use, so they
// never silently fall back to a stale or wrong default.
export async function getConfiguredServerUrl(): Promise<string> {
  const existing = await prisma.licenseServerConfig.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing.serverUrl;
  if (config.licenseServerUrlSeed) return config.licenseServerUrlSeed;
  throw new LicenseServerUnreachableError("License Server is not configured yet");
}

// Tests connectivity against {url}/health before saving anything — "once connection with
// the License Server established" is enforced here, not left to the caller.
export async function setLicenseServerConfig(rawUrl: string): Promise<LicenseServerConfigView> {
  const serverUrl = rawUrl.trim().replace(/\/$/, "");

  const client = buildLicenseServerClient(serverUrl);
  try {
    await client.get("/health", { timeout: 5_000 });
  } catch {
    await prisma.licenseServerConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, serverUrl, lastConnectionCheckAt: new Date(), lastConnectionOk: false },
      update: { serverUrl, lastConnectionCheckAt: new Date(), lastConnectionOk: false },
    });
    throw new LicenseServerUnreachableError(`Could not reach a License Server at ${serverUrl}`);
  }

  const saved = await prisma.licenseServerConfig.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, serverUrl, lastConnectionCheckAt: new Date(), lastConnectionOk: true },
    update: { serverUrl, lastConnectionCheckAt: new Date(), lastConnectionOk: true },
  });

  return {
    configured: true,
    serverUrl: saved.serverUrl,
    lastConnectionCheckAt: saved.lastConnectionCheckAt,
    lastConnectionOk: saved.lastConnectionOk,
  };
}

export async function testLicenseServerConnection(): Promise<boolean> {
  const url = await getConfiguredServerUrl();
  const client = buildLicenseServerClient(url);
  try {
    await client.get("/health", { timeout: 5_000 });
    await prisma.licenseServerConfig.update({
      where: { id: SINGLETON_ID },
      data: { lastConnectionCheckAt: new Date(), lastConnectionOk: true },
    });
    return true;
  } catch {
    await prisma.licenseServerConfig.updateMany({
      where: { id: SINGLETON_ID },
      data: { lastConnectionCheckAt: new Date(), lastConnectionOk: false },
    });
    return false;
  }
}
