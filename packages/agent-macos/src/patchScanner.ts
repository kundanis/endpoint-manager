import type { PatchDetectedUpdate, PatchScanResultPayload } from "@em/shared";
import { listSoftwareUpdates, severityOf } from "./softwareUpdate";

// A stable, fleet-unique id for PatchDefinition.updateId (an opaque string server-side - see
// patch.service.ts). Apple's label already embeds the version/build, so it identifies one
// specific update.
export function buildUpdateId(label: string): string {
  return `macos:softwareupdate:${label}`;
}

export function parseUpdateId(updateId: string): string | null {
  const prefix = "macos:softwareupdate:";
  return updateId.startsWith(prefix) ? updateId.slice(prefix.length) : null;
}

export async function scanForMissingPatches(): Promise<PatchScanResultPayload> {
  const scannedAt = new Date().toISOString();
  try {
    const updates = await listSoftwareUpdates();
    const detected: PatchDetectedUpdate[] = updates.map((u) => ({
      updateId: buildUpdateId(u.label),
      revisionNumber: 1,
      title: u.version && !u.title.includes(u.version) ? `${u.title} ${u.version}` : u.title,
      severity: severityOf(u),
      kbArticleIds: [],
      categories: ["softwareupdate", ...(u.recommended ? ["recommended"] : []), ...(u.restartRequired ? ["restart"] : [])],
      sizeBytes: u.sizeBytes !== null ? String(u.sizeBytes) : null,
      isDownloaded: false,
    }));
    return { scannedAt, updates: detected };
  } catch (err) {
    // Offline / catalog unreachable: report "nothing found" rather than failing every cycle.
    console.error("softwareupdate scan failed", err);
    return { scannedAt, updates: [] };
  }
}
