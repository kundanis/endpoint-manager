import type { AdminModuleKey, SetModuleVisibilityRequest } from "@em/shared";
import { prisma } from "../db";

const SINGLETON_ID = "singleton";

function parseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getModuleVisibility(): Promise<{ hiddenModuleKeys: string[]; hiddenItemPaths: string[] }> {
  const row = await prisma.moduleVisibilitySettings.findUnique({ where: { id: SINGLETON_ID } });
  if (!row) return { hiddenModuleKeys: [], hiddenItemPaths: [] };
  return {
    hiddenModuleKeys: parseArray(row.hiddenModuleKeys),
    hiddenItemPaths: parseArray(row.hiddenItemPaths),
  };
}

export async function setModuleVisibility(params: SetModuleVisibilityRequest) {
  const data = {
    hiddenModuleKeys: JSON.stringify(params.hiddenModuleKeys),
    hiddenItemPaths: JSON.stringify(params.hiddenItemPaths),
  };
  await prisma.moduleVisibilitySettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  });
  return getModuleVisibility();
}

// Used by requireModuleVisible (middleware/requireModule.ts) on every module-gated
// request — a fresh read each time, same no-caching tradeoff already accepted by
// isModuleLicensed/adminAuthMiddleware elsewhere in this codebase, so a hide/unhide takes
// effect on an admin's very next request rather than needing a cache invalidation path.
export async function isModuleHidden(moduleKey: AdminModuleKey): Promise<boolean> {
  const { hiddenModuleKeys } = await getModuleVisibility();
  return hiddenModuleKeys.includes(moduleKey);
}
