import type { PatchDetectedUpdate, PatchScanResultPayload } from "@em/shared";
import { detectPackageManager, scanForUpgrades, type PackageManager } from "./packageManager";

// The package names the latest local scan found upgradable. A patch task may only touch these
// (see patchInstaller.ts), so the server can't make this agent run apt/dnf on anything else.
let lastScan: { manager: PackageManager; packageNames: Set<string> } | null = null;

export function lastScannedPackageNames(manager: PackageManager): Set<string> | null {
  return lastScan && lastScan.manager === manager ? lastScan.packageNames : null;
}

export function rememberScan(manager: PackageManager, packageNames: string[]): void {
  lastScan = { manager, packageNames: new Set(packageNames) };
}

// Mirrors the Windows agent's updateId (a stable string PatchDefinition.updateId can key
// on across scans) but built from (manager, package, target version) instead of a WUA GUID —
// see patch.service.ts's recordPatchScan, which treats updateId as an opaque unique string
// either way. Encodes the manager too so the SAME package name from apt vs. dnf (impossible
// on one endpoint, but this ID is also globally unique across the whole fleet in one shared
// PatchDefinition table) never collides.
export function buildUpdateId(manager: string, packageName: string, newVersion: string): string {
  return `linux:${manager}:${packageName}:${newVersion}`;
}

export async function scanForMissingPatches(): Promise<PatchScanResultPayload> {
  const scannedAt = new Date().toISOString();

  const manager = await detectPackageManager();
  if (!manager) {
    // No apt/dnf/yum found (e.g. Alpine's apk) — Core + Patch Management scope only covers
    // these two families for v1 (see the Linux-agent scoping decision); degrade to "nothing
    // missing" rather than erroring on every checkin cycle.
    return { scannedAt, updates: [] };
  }

  try {
    const scanned = await scanForUpgrades(manager);
    rememberScan(manager, scanned.map((u) => u.packageName));
    const updates: PatchDetectedUpdate[] = scanned.map((u) => ({
      updateId: buildUpdateId(manager, u.packageName, u.newVersion),
      revisionNumber: 1, // no revision concept for apt/dnf/yum updates, unlike WUA's KBs
      title: u.currentVersion ? `${u.packageName} ${u.currentVersion} → ${u.newVersion}` : `${u.packageName} → ${u.newVersion}`,
      severity: u.severity,
      kbArticleIds: [],
      categories: [manager, ...(u.source ? [u.source] : [])],
      sizeBytes: null,
      isDownloaded: false,
    }));
    return { scannedAt, updates };
  } catch (err) {
    console.error(`Package update scan failed (${manager})`, err);
    return { scannedAt, updates: [] };
  }
}
