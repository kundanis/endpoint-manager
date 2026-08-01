import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type { AxiosInstance } from "axios";
import type {
  AssignedDataMovementPolicyWire,
  DataMovementChannel,
  DataMovementFileEvent,
  DataMovementScanResultPayload,
} from "@em/shared";
import {
  DATA_MOVEMENT_LOOKBACK_BUFFER_MS,
  DATA_MOVEMENT_MAX_FILES_PER_SCAN,
  DATA_MOVEMENT_MAX_SCAN_DEPTH,
  DEFAULT_DATA_MOVEMENT_SCAN_INTERVAL_MS,
} from "@em/shared";

const execFileAsync = promisify(execFile);

function expandEnvVars(rawPath: string): string {
  return rawPath.replace(/%([^%]+)%/g, (match, name: string) => process.env[name] ?? match);
}

interface ScanRoot {
  root: string;
  channel: DataMovementChannel;
  channelDetail: Record<string, string | null>;
}

// Get-Volume/Get-Partition/Get-Disk (the modern Storage module) rather than raw WMI
// disk/partition joins — much simpler to correlate a drive letter back to its physical
// disk's serial number.
const REMOVABLE_DRIVES_PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Get-Volume | Where-Object { $_.DriveType -eq 'Removable' -and $_.DriveLetter } | ForEach-Object {
  $vol = $_
  $serial = $null
  try {
    $partition = Get-Partition -DriveLetter $vol.DriveLetter
    $disk = Get-Disk -Number $partition.DiskNumber
    $serial = $disk.SerialNumber
  } catch {}
  [PSCustomObject]@{
    DriveLetter  = "$($vol.DriveLetter):"
    VolumeLabel  = $vol.FileSystemLabel
    SerialNumber = $serial
  }
} | ConvertTo-Json -Compress
`;

interface RawRemovableDrive {
  DriveLetter?: string;
  VolumeLabel?: string;
  SerialNumber?: string;
}

async function getRemovableDrives(): Promise<ScanRoot[]> {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", REMOVABLE_DRIVES_PS_SCRIPT],
      { maxBuffer: 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    const parsed: RawRemovableDrive | RawRemovableDrive[] = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .filter((r) => r.DriveLetter)
      .map((r) => ({
        root: `${r.DriveLetter}\\`,
        channel: "USB" as const,
        channelDetail: {
          driveLetter: r.DriveLetter ?? null,
          volumeLabel: r.VolumeLabel || null,
          serialNumber: r.SerialNumber || null,
        },
      }));
  } catch (err) {
    console.error("Failed to enumerate removable drives", err);
    return [];
  }
}

// DriveType=4 is "Network Drive" in Win32_LogicalDisk — ProviderName is the UNC path a
// mapped drive letter points at (e.g. "\\\\fileserver\\shared").
const NETWORK_DRIVES_PS_SCRIPT = `
Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=4" |
  Select-Object DeviceID, ProviderName |
  ConvertTo-Json -Compress
`;

interface RawNetworkDrive {
  DeviceID?: string;
  ProviderName?: string;
}

async function getMappedNetworkDrives(): Promise<ScanRoot[]> {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", NETWORK_DRIVES_PS_SCRIPT],
      { maxBuffer: 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    const parsed: RawNetworkDrive | RawNetworkDrive[] = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .filter((r) => r.DeviceID)
      .map((r) => ({
        root: `${r.DeviceID}\\`,
        channel: "NETWORK_SHARE" as const,
        channelDetail: { uncPath: r.ProviderName || null },
      }));
  } catch (err) {
    console.error("Failed to enumerate mapped network drives", err);
    return [];
  }
}

// Business OneDrive folders are suffixed with the org name ("OneDrive - Acme Corp"),
// hence the prefix match rather than an exact name.
const CLOUD_FOLDER_PATTERNS: { test: (name: string) => boolean; provider: string }[] = [
  { test: (n) => n === "OneDrive" || n.startsWith("OneDrive - "), provider: "OneDrive" },
  { test: (n) => n === "Dropbox", provider: "Dropbox" },
  { test: (n) => n === "Google Drive" || n === "GoogleDrive", provider: "Google Drive" },
];

async function getCloudSyncFolders(extraPaths: string[]): Promise<ScanRoot[]> {
  const roots: ScanRoot[] = [];
  const home = process.env.USERPROFILE;

  if (home) {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fs.readdir(home, { withFileTypes: true });
    } catch {
      // no profile directory readable — fall through to extraPaths only
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = CLOUD_FOLDER_PATTERNS.find((p) => p.test(entry.name));
      if (match) roots.push({ root: path.join(home, entry.name), channel: "CLOUD_SYNC", channelDetail: { provider: match.provider } });
    }
  }

  for (const rawPath of extraPaths) {
    const expanded = expandEnvVars(rawPath);
    try {
      const stat = await fs.stat(expanded);
      if (stat.isDirectory()) roots.push({ root: expanded, channel: "CLOUD_SYNC", channelDetail: { provider: "Custom" } });
    } catch {
      // configured path doesn't exist on this endpoint — skip, don't fail the scan
    }
  }

  return roots;
}

interface FileStat {
  filePath: string;
  fileSizeBytes: number;
  fileModifiedAt: string;
}

// Same walk-with-caps shape as dataDiscoveryScanner.ts's collectFiles, but a plain
// fs.stat() per file (no content read) filtered to mtime >= sinceMs, since this module
// only cares about *when* a file landed somewhere, not what's in it.
async function collectRecentFiles(root: string, maxFiles: number, sinceMs: number): Promise<FileStat[]> {
  const results: FileStat[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (results.length >= maxFiles || depth > DATA_MOVEMENT_MAX_SCAN_DEPTH) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // inaccessible dir (permissions, disconnected share, junction loop) — skip
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat;
      try {
        stat = await fs.stat(full);
      } catch {
        continue; // locked/inaccessible file — skip
      }
      if (stat.mtimeMs >= sinceMs) {
        results.push({ filePath: full, fileSizeBytes: stat.size, fileModifiedAt: stat.mtime.toISOString() });
      }
    }
  }

  await walk(root, 0);
  return results;
}

// Same shape as dataDiscoveryScanner.ts (fetch assigned policies, scan locally, report
// results) but the "match" here is purely mtime-in-window, not a content scan — a
// heuristic proxy for "recently copied here," not a guarantee (a file merely edited in
// place on a monitored drive looks identical to one just copied onto it).
export async function runDataMovementScan(client: AxiosInstance): Promise<void> {
  if (process.platform !== "win32") return;

  const { data: assigned } = await client.get<AssignedDataMovementPolicyWire[]>("/api/agent/data-movement/assigned");
  if (assigned.length === 0) return;

  const sinceMs = Date.now() - DEFAULT_DATA_MOVEMENT_SCAN_INTERVAL_MS - DATA_MOVEMENT_LOOKBACK_BUFFER_MS;

  for (const policy of assigned) {
    try {
      const roots: ScanRoot[] = [];
      if (policy.monitorUsb) roots.push(...(await getRemovableDrives()));
      if (policy.monitorCloudSync) roots.push(...(await getCloudSyncFolders(policy.extraCloudSyncPaths)));
      if (policy.monitorNetworkShare) roots.push(...(await getMappedNetworkDrives()));

      const events: DataMovementFileEvent[] = [];
      let filesFound = 0;
      for (const scanRoot of roots) {
        if (filesFound >= DATA_MOVEMENT_MAX_FILES_PER_SCAN) break;
        const files = await collectRecentFiles(scanRoot.root, DATA_MOVEMENT_MAX_FILES_PER_SCAN - filesFound, sinceMs);
        filesFound += files.length;
        for (const f of files) {
          events.push({
            filePath: f.filePath,
            fileSizeBytes: f.fileSizeBytes,
            fileModifiedAt: f.fileModifiedAt,
            channel: scanRoot.channel,
            channelDetail: scanRoot.channelDetail,
          });
        }
      }

      const payload: DataMovementScanResultPayload = {
        scannedAt: new Date().toISOString(),
        policyId: policy.policyId,
        events,
      };
      await client.post("/api/agent/data-movement/scan-result", payload);
    } catch (err) {
      console.error(`Failed to scan/report data movement policy ${policy.policyId}`, err);
    }
  }
}
