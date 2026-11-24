import type { AdminModuleKey, SetModuleVisibilityRequest } from "@em/shared";
import { config } from "../config";
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

// Modules and items this deployment never shows, whatever the super admin's own settings:
//  - the Threat Protection edition shows only Endpoints (list, enrollment, agent updates),
//    Threat Protection, Licensing and Administrators;
//  - a full deployment with licence enforcement off shows Threat Protection only when
//    THREAT_PROTECTION=true (it's sold separately; with enforcement on, the licence decides),
//    and AI Guard only when AI_GUARD=true (same rule). The Threat Protection edition never has AI Guard.
export function fixedHidden(): { moduleKeys: AdminModuleKey[]; itemPaths: string[] } {
  if (config.productEdition === "threat-protection") {
    return {
      moduleKeys: ["NETWORK_MANAGER", "SOFTWARE_MANAGER", "SECURITY_MANAGER", "DATA_MANAGER", "USER_MANAGER", "AI_GUARD"],
      itemPaths: ["/commands", "/packages", "/asset-settings"],
    };
  }
  const moduleKeys: AdminModuleKey[] = [];
  if (!config.licenseEnforcementEnabled && !config.threatProtection) moduleKeys.push("THREAT_PROTECTION");
  if (!config.licenseEnforcementEnabled && !config.aiGuard) moduleKeys.push("AI_GUARD");
  return { moduleKeys, itemPaths: [] };
}

async function savedVisibility(): Promise<{ hiddenModuleKeys: string[]; hiddenItemPaths: string[] }> {
  const row = await prisma.moduleVisibilitySettings.findUnique({ where: { id: SINGLETON_ID } });
  if (!row) return { hiddenModuleKeys: [], hiddenItemPaths: [] };
  return { hiddenModuleKeys: parseArray(row.hiddenModuleKeys), hiddenItemPaths: parseArray(row.hiddenItemPaths) };
}

// What's hidden = the super admin's own choices plus fixedHidden(). fixed* lists the latter, so
// the Module visibility settings can leave them out (they can't be unhidden there).
export async function getModuleVisibility() {
  const saved = await savedVisibility();
  const fixed = fixedHidden();
  return {
    hiddenModuleKeys: [...new Set([...saved.hiddenModuleKeys, ...fixed.moduleKeys])],
    hiddenItemPaths: [...new Set([...saved.hiddenItemPaths, ...fixed.itemPaths])],
    fixedHiddenModuleKeys: fixed.moduleKeys as string[],
    fixedHiddenItemPaths: fixed.itemPaths,
    edition: config.productEdition,
  };
}

export async function setModuleVisibility(params: SetModuleVisibilityRequest) {
  // Only the admin's own choices are stored; the fixed ones are added on every read.
  const fixed = fixedHidden();
  const data = {
    hiddenModuleKeys: JSON.stringify(params.hiddenModuleKeys.filter((k) => !fixed.moduleKeys.includes(k))),
    hiddenItemPaths: JSON.stringify(params.hiddenItemPaths.filter((p) => !fixed.itemPaths.includes(p))),
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
