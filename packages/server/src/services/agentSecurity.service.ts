import bcrypt from "bcryptjs";
import type { AgentSecurityStatus } from "@em/shared";
import { prisma } from "../db";

const SINGLETON_ID = "singleton";

async function getSettings() {
  return prisma.agentSecuritySettings.findUnique({ where: { id: SINGLETON_ID } });
}

export async function getStatus(): Promise<AgentSecurityStatus> {
  const settings = await getSettings();
  return {
    uninstallProtectionEnabled: !!settings?.uninstallPasswordHash,
    updatedAt: settings?.updatedAt.toISOString() ?? null,
  };
}

export async function setUninstallPassword(password: string): Promise<AgentSecurityStatus> {
  const uninstallPasswordHash = await bcrypt.hash(password, 10);
  const settings = await prisma.agentSecuritySettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, uninstallPasswordHash },
    update: { uninstallPasswordHash },
  });
  return { uninstallProtectionEnabled: true, updatedAt: settings.updatedAt.toISOString() };
}

export async function clearUninstallPassword(): Promise<AgentSecurityStatus> {
  const settings = await prisma.agentSecuritySettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, uninstallPasswordHash: null },
    update: { uninstallPasswordHash: null },
  });
  return { uninstallProtectionEnabled: false, updatedAt: settings.updatedAt.toISOString() };
}

// No password configured at all => nothing to check against => allow (protection is
// opt-in, off until an admin sets one - same "off by default" convention as
// LICENSE_ENFORCEMENT_ENABLED). Once set, only a correct password passes.
export async function verifyUninstallPassword(password: string): Promise<boolean> {
  const settings = await getSettings();
  if (!settings?.uninstallPasswordHash) return true;
  return bcrypt.compare(password, settings.uninstallPasswordHash);
}
