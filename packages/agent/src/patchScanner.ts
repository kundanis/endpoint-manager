import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PatchDetectedUpdate, PatchScanResultPayload } from "@em/shared";
import { DEFAULT_PATCH_SCAN_TIMEOUT_MS } from "@em/shared";

const execFileAsync = promisify(execFile);

// Microsoft.Update.Session is the standard, publicly documented WUA COM automation
// surface — the same object model WSUS clients and every patch-management tool build on.
// Type='Software' excludes drivers; IsHidden=0 excludes updates an admin already dismissed.
// If this machine is domain-joined with a WSUS policy, Search() correctly reflects that
// configured update source rather than public Windows Update — expected, not a bug.
const SCAN_PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$session  = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$result   = $searcher.Search("IsInstalled=0 and Type='Software' and IsHidden=0")

$updates = @()
foreach ($u in $result.Updates) {
  $kbIds = @($u.KBArticleIDs | ForEach-Object { $_ })
  $cats  = @($u.Categories   | ForEach-Object { $_.Name })
  $updates += [PSCustomObject]@{
    UpdateId       = $u.Identity.UpdateID
    RevisionNumber = $u.Identity.RevisionNumber
    Title          = $u.Title
    Severity       = $u.MsrcSeverity
    KBArticleIDs   = $kbIds
    Categories     = $cats
    SizeBytes      = [int64]$u.MaxDownloadSize
    IsDownloaded   = [bool]$u.IsDownloaded
  }
}
@($updates) | ConvertTo-Json -Compress -Depth 5
`;

interface RawDetectedUpdate {
  UpdateId: string;
  RevisionNumber: number;
  Title: string;
  Severity: string | null;
  KBArticleIDs: string[] | string | null;
  Categories: string[] | string | null;
  SizeBytes: number;
  IsDownloaded: boolean;
}

// PowerShell collapses a single-element collection to a bare scalar when serialized —
// the same class of problem inventory.ts already guards against for installed software.
function toArray<T>(value: T[] | T | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export async function scanForMissingPatches(): Promise<PatchScanResultPayload> {
  const scannedAt = new Date().toISOString();

  if (process.platform !== "win32") {
    return { scannedAt, updates: [] };
  }

  try {
    // First-run WUA searches can genuinely take minutes while it syncs its local metadata
    // store — that's normal, not a hang, hence the generous timeout.
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCAN_PS_SCRIPT],
      { maxBuffer: 20 * 1024 * 1024, timeout: DEFAULT_PATCH_SCAN_TIMEOUT_MS },
    );

    const trimmed = stdout.trim();
    const parsed: RawDetectedUpdate | RawDetectedUpdate[] = trimmed ? JSON.parse(trimmed) : [];
    const rows = Array.isArray(parsed) ? parsed : [parsed];

    const updates: PatchDetectedUpdate[] = rows
      .filter((r): r is RawDetectedUpdate => Boolean(r?.UpdateId))
      .map((r) => ({
        updateId: r.UpdateId,
        revisionNumber: r.RevisionNumber,
        title: r.Title,
        severity: r.Severity ?? null,
        kbArticleIds: toArray(r.KBArticleIDs),
        categories: toArray(r.Categories),
        sizeBytes: r.SizeBytes ? String(r.SizeBytes) : null,
        isDownloaded: Boolean(r.IsDownloaded),
      }));

    return { scannedAt, updates };
  } catch (err) {
    console.error("Windows Update scan failed", err);
    return { scannedAt, updates: [] };
  }
}
