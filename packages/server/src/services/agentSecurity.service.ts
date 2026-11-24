import bcrypt from "bcryptjs";
import type { AgentSecurityStatus } from "@em/shared";
import { prisma } from "../db";
import { decryptField, encryptField } from "../utils/fieldEncryption";

const SINGLETON_ID = "singleton";

async function getSettings() {
  return prisma.agentSecuritySettings.findUnique({ where: { id: SINGLETON_ID } });
}

export async function getStatus(): Promise<AgentSecurityStatus> {
  const settings = await getSettings();
  return statusOf(settings);
}

function statusOf(settings: Awaited<ReturnType<typeof getSettings>>): AgentSecurityStatus {
  return {
    uninstallProtectionEnabled: !!settings?.uninstallPasswordHash,
    updatedAt: settings?.updatedAt.toISOString() ?? null,
    remoteInstallUsername: settings?.remoteInstallUsername && settings.remoteInstallPasswordEncrypted ? settings.remoteInstallUsername : null,
  };
}

export class RemoteInstallAccountError extends Error {}

// Saves the remote install account. The password is kept encrypted and never returned; leaving
// it out keeps the saved password (only allowed when one is saved).
export async function setRemoteInstallAccount(username: string, password?: string): Promise<AgentSecurityStatus> {
  const current = await getSettings();
  if (!password && !current?.remoteInstallPasswordEncrypted) {
    throw new RemoteInstallAccountError("Enter the password for this account.");
  }
  const data = {
    remoteInstallUsername: username,
    ...(password ? { remoteInstallPasswordEncrypted: encryptField(password) } : {}),
  };
  const settings = await prisma.agentSecuritySettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  });
  return statusOf(settings);
}

export async function clearRemoteInstallAccount(): Promise<AgentSecurityStatus> {
  const settings = await prisma.agentSecuritySettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID },
    update: { remoteInstallUsername: null, remoteInstallPasswordEncrypted: null },
  });
  return statusOf(settings);
}

// For remoteInstall.service only: the saved account in plain text, or null when none is saved.
export async function getRemoteInstallCredential(): Promise<{ username: string; password: string } | null> {
  const settings = await getSettings();
  if (!settings?.remoteInstallUsername || !settings.remoteInstallPasswordEncrypted) return null;
  return { username: settings.remoteInstallUsername, password: decryptField(settings.remoteInstallPasswordEncrypted) };
}

export async function setUninstallPassword(password: string): Promise<AgentSecurityStatus> {
  const uninstallPasswordHash = await bcrypt.hash(password, 10);
  const settings = await prisma.agentSecuritySettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, uninstallPasswordHash },
    update: { uninstallPasswordHash },
  });
  return statusOf(settings);
}

export async function clearUninstallPassword(): Promise<AgentSecurityStatus> {
  const settings = await prisma.agentSecuritySettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, uninstallPasswordHash: null },
    update: { uninstallPasswordHash: null },
  });
  return statusOf(settings);
}

// No password configured at all => nothing to check against => allow (protection is
// opt-in, off until an admin sets one - same "off by default" convention as
// LICENSE_ENFORCEMENT_ENABLED). Once set, only a correct password passes.
// Whether tamper protection has an uninstall password (uninstalling from the PC needs one).
export async function hasUninstallPassword(): Promise<boolean> {
  return !!(await getSettings())?.uninstallPasswordHash;
}

export async function verifyUninstallPassword(password: string): Promise<boolean> {
  const settings = await getSettings();
  if (!settings?.uninstallPasswordHash) return true;
  return bcrypt.compare(password, settings.uninstallPasswordHash);
}
