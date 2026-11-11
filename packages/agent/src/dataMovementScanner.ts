import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { AxiosInstance } from "axios";
import type {
  AssignedDataMovementPolicyWire,
  DataMovementChannel,
  DataMovementFileEvent,
  DataMovementOperation,
  DataMovementScanResultPayload,
} from "@em/shared";
import {
  DATA_MOVEMENT_LOOKBACK_BUFFER_MS,
  DATA_MOVEMENT_MAX_SCAN_DEPTH,
  DEFAULT_DATA_MOVEMENT_SCAN_INTERVAL_MS,
} from "@em/shared";
import { listUserProfiles, resolveTargetPath } from "./userPaths";

const execFileAsync = promisify(execFile);

// Data movement: files arriving on USB / removable drives, cloud-sync folders and mapped network
// drives. Each monitored location is watched live, so a file is reported seconds after it lands,
// with where it came from: a file with the same name and size on the endpoint's own disks (still
// there = copied, just gone = moved), and the user signed in at the time.
//
// "Arrived" is judged by the file's creation time (Windows sets it when a file is copied) or its
// change time (set when a file is moved or renamed in) - not its last-modified time, which a copy
// keeps from the original, so an old document copied today would otherwise go unnoticed.
//
// A periodic sweep (runDataMovementScan) catches anything the live watcher missed (agent
// restarted, drive plugged in between refreshes, watcher overflow). Only names and sizes are
// read; file content never is.

const REFRESH_MS = 60_000; // re-read the assignment, drives, mapped shares and signed-in user
const SETTLE_MS = 2_000; // let the copy finish before looking at the file
const REPORT_MS = 15_000;
const ARRIVED_WINDOW_MS = 10 * 60_000; // created / moved in within this long counts as arrived
const REPORTED_TTL_MS = 60 * 60_000;
const MAX_QUEUE = 2_000;
const MAX_PER_REQUEST = 500; // dataMovementScanResultPayloadSchema's cap
const MAX_INDEX_LOOKUPS = 200; // Windows Search queries per batch; the folder walk covers the rest
const SOURCE_WALK_MAX_ENTRIES = 80_000;
const SOURCE_WALK_MAX_MS = 10_000;
const SWEEP_MAX_ENTRIES = 50_000; // files looked at per sweep of a location

interface ScanRoot {
  root: string;
  channel: DataMovementChannel;
  channelDetail: Record<string, string | null>;
  // Owner of a per-user folder (OneDrive in C:\Users\amit) - null for drives and shares, where
  // the signed-in user is recorded instead.
  owner: string | null;
}

interface RootWithPolicies extends ScanRoot {
  policyIds: string[];
}

interface Arrival {
  filePath: string;
  size: number;
  modifiedAt: Date;
  root: RootWithPolicies;
}

let assigned: AssignedDataMovementPolicyWire[] = [];
let signedInUser: string | null = null;
const watchers = new Map<string, { root: RootWithPolicies; watcher: fs.FSWatcher }>();
const pendingChecks = new Map<string, NodeJS.Timeout>();
const reported = new Map<string, number>(); // path|size|mtime -> when reported
const arrivals: Arrival[] = [];
const queue = new Map<string, DataMovementFileEvent[]>(); // policyId -> events waiting to be sent
let processing = false;

async function powershell(script: string, env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  return stdout;
}

function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function stripDomain(user: string | null | undefined): string | null {
  if (!user) return null;
  const name = user.includes("\\") ? user.slice(user.lastIndexOf("\\") + 1) : user;
  return name || null;
}

// ---- Where to watch -------------------------------------------------------------------------

// Removable drives with their disk serial; mapped network drives of every signed-in user (the
// agent runs as SYSTEM, which has no drive mappings of its own - they live in each user's
// registry hive); and the user at the console.
const ENVIRONMENT_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$drives = @(Get-Volume | Where-Object { $_.DriveType -eq 'Removable' -and $_.DriveLetter } | ForEach-Object {
  $vol = $_
  $serial = $null
  try { $serial = (Get-Disk -Number (Get-Partition -DriveLetter $vol.DriveLetter).DiskNumber).SerialNumber } catch {}
  [PSCustomObject]@{ DriveLetter = "$($vol.DriveLetter):"; VolumeLabel = $vol.FileSystemLabel; SerialNumber = $serial }
})
$shares = @(Get-ChildItem 'Registry::HKEY_USERS' | Where-Object { $_.PSChildName -match '^S-1-5-21-[0-9-]+$' } | ForEach-Object {
  Get-ChildItem "Registry::HKEY_USERS\\$($_.PSChildName)\\Network" | ForEach-Object {
    [PSCustomObject]@{ DriveLetter = "$($_.PSChildName.ToUpper()):"; UncPath = (Get-ItemProperty $_.PSPath).RemotePath }
  }
})
$user = (Get-CimInstance -ClassName Win32_ComputerSystem).UserName
[PSCustomObject]@{ Drives = $drives; Shares = $shares; User = $user } | ConvertTo-Json -Compress -Depth 4
`;

interface RawEnvironment {
  Drives?: { DriveLetter?: string; VolumeLabel?: string; SerialNumber?: string }[] | { DriveLetter?: string };
  Shares?: { DriveLetter?: string; UncPath?: string }[] | { DriveLetter?: string; UncPath?: string };
  User?: string | null;
}

async function readEnvironment(): Promise<{ usb: ScanRoot[]; shares: ScanRoot[]; user: string | null }> {
  try {
    const raw = (await powershell(ENVIRONMENT_PS)).trim();
    if (!raw) return { usb: [], shares: [], user: null };
    const env = JSON.parse(raw) as RawEnvironment;
    const usb = asArray(env.Drives as { DriveLetter?: string; VolumeLabel?: string; SerialNumber?: string }[])
      .filter((d) => d.DriveLetter)
      .map((d) => ({
        root: `${d.DriveLetter}\\`,
        channel: "USB" as const,
        channelDetail: { driveLetter: d.DriveLetter ?? null, volumeLabel: d.VolumeLabel || null, serialNumber: d.SerialNumber || null },
        owner: null,
      }));
    const seenUnc = new Set<string>();
    const shares: ScanRoot[] = [];
    for (const s of asArray(env.Shares)) {
      if (!s.UncPath || seenUnc.has(s.UncPath.toLowerCase())) continue;
      seenUnc.add(s.UncPath.toLowerCase());
      // Watched by its UNC path: SYSTEM can't use the user's drive letter. Shares the computer
      // account isn't allowed to read simply can't be watched and are skipped.
      shares.push({ root: s.UncPath, channel: "NETWORK_SHARE", channelDetail: { uncPath: s.UncPath, driveLetter: s.DriveLetter ?? null }, owner: null });
    }
    return { usb, shares, user: stripDomain(env.User) };
  } catch (err) {
    console.error("Data movement: couldn't read drives and mapped shares", err);
    return { usb: [], shares: [], user: null };
  }
}

const CLOUD_FOLDER_PATTERNS: { test: (name: string) => boolean; provider: string }[] = [
  { test: (n) => n === "OneDrive" || n.startsWith("OneDrive - "), provider: "OneDrive" },
  { test: (n) => n === "Dropbox" || n.startsWith("Dropbox ("), provider: "Dropbox" },
  { test: (n) => n === "Google Drive" || n === "GoogleDrive", provider: "Google Drive" },
  { test: (n) => n === "iCloudDrive" || n === "iCloud Drive", provider: "iCloud Drive" },
  { test: (n) => n === "Box", provider: "Box" },
];

// Cloud-sync folders in every user's profile (the agent's own %USERPROFILE% is SYSTEM's).
async function cloudSyncRoots(extraPaths: string[]): Promise<ScanRoot[]> {
  const profiles = await listUserProfiles();
  const roots: ScanRoot[] = [];
  for (const p of profiles) {
    const owner = path.basename(p.root);
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(p.root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const match = CLOUD_FOLDER_PATTERNS.find((c) => c.test(e.name));
      if (match) roots.push({ root: path.join(p.root, e.name), channel: "CLOUD_SYNC", channelDetail: { provider: match.provider }, owner });
    }
  }
  for (const raw of extraPaths) {
    for (const dir of await resolveTargetPath(raw, profiles)) {
      const owner = profiles.find((p) => dir.toLowerCase().startsWith(p.root.toLowerCase() + "\\"));
      roots.push({ root: dir, channel: "CLOUD_SYNC", channelDetail: { provider: "Custom" }, owner: owner ? path.basename(owner.root) : null });
    }
  }
  return roots;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// Every location to monitor for the current assignment, with the policies that want it.
async function resolveRoots(): Promise<RootWithPolicies[]> {
  if (assigned.length === 0) return [];
  const env = await readEnvironment();
  signedInUser = env.user;
  const byKey = new Map<string, RootWithPolicies>();
  const add = (r: ScanRoot, policyId: string) => {
    const key = r.root.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.policyIds.includes(policyId)) existing.policyIds.push(policyId);
    } else {
      byKey.set(key, { ...r, policyIds: [policyId] });
    }
  };
  for (const policy of assigned) {
    if (policy.monitorUsb) for (const r of env.usb) add(r, policy.policyId);
    if (policy.monitorNetworkShare) for (const r of env.shares) add(r, policy.policyId);
    if (policy.monitorCloudSync) for (const r of await cloudSyncRoots(policy.extraCloudSyncPaths)) add(r, policy.policyId);
  }
  const out: RootWithPolicies[] = [];
  for (const r of byKey.values()) if (await isDirectory(r.root)) out.push(r);
  return out;
}

// ---- Arrivals -------------------------------------------------------------------------------

// Temporary and system files that appear on every drive and say nothing about data leaving.
function isNoise(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (/\\(system volume information|\$recycle\.bin|\.dropbox\.cache|\.tmp\.drivedownload|\.tmp\.driveupload)\\/.test(lower)) return true;
  const name = path.basename(lower);
  return (
    name.startsWith("~$") ||
    name.startsWith(".~lock") ||
    name === "desktop.ini" ||
    name === "thumbs.db" ||
    name === ".ds_store" ||
    name.endsWith(".tmp") ||
    name.endsWith(".partial") ||
    name.endsWith(".crdownload")
  );
}

// Copied or created there: a new creation time. Moved or renamed in, or copied over an existing
// file: a new change time while the content's last-modified time stays old. A file merely edited
// where it already was (new change and modified time, old creation time) hasn't moved anywhere.
// FAT/exFAT USB sticks have no change time; creation time decides there.
function hasArrived(stat: fs.Stats, sinceMs: number): boolean {
  if (stat.birthtimeMs >= sinceMs) return true;
  return stat.ctimeMs >= sinceMs && stat.mtimeMs < stat.ctimeMs - 60_000;
}

function reportedKey(filePath: string, stat: fs.Stats): string {
  return `${filePath.toLowerCase()}|${stat.size}|${Math.round(stat.mtimeMs)}`;
}

async function considerFile(filePath: string, root: RootWithPolicies, sinceMs: number): Promise<void> {
  if (isNoise(filePath)) return;
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return; // gone again (a temp file) - nothing arrived
  }
  if (!stat.isFile() || !hasArrived(stat, sinceMs)) return;
  const key = reportedKey(filePath, stat);
  if (reported.has(key)) return;
  reported.set(key, Date.now());
  if (arrivals.length < MAX_QUEUE) arrivals.push({ filePath, size: stat.size, modifiedAt: stat.mtime, root });
}

function scheduleCheck(filePath: string, root: RootWithPolicies) {
  const key = filePath.toLowerCase();
  const existing = pendingChecks.get(key);
  if (existing) clearTimeout(existing);
  pendingChecks.set(
    key,
    setTimeout(() => {
      pendingChecks.delete(key);
      considerFile(filePath, root, Date.now() - ARRIVED_WINDOW_MS)
        .then(() => processArrivals())
        .catch((err) => console.error("Data movement: failed to check", filePath, err));
    }, SETTLE_MS),
  );
}

// Files that arrived since sinceMs anywhere under root (catch-up and periodic sweep).
async function sweepRoot(root: RootWithPolicies, sinceMs: number, budget: { files: number }): Promise<void> {
  async function walk(dir: string, depth: number): Promise<void> {
    if (budget.files <= 0 || depth > DATA_MOVEMENT_MAX_SCAN_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // inaccessible dir (permissions, disconnected share, junction loop) - skip
    }
    for (const entry of entries) {
      if (budget.files <= 0) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        budget.files--;
        await considerFile(full, root, sinceMs);
      }
    }
  }
  await walk(root.root, 0);
}

async function refreshWatchers(): Promise<void> {
  const wanted = await resolveRoots();
  const wantedByKey = new Map(wanted.map((r) => [r.root.toLowerCase(), r]));

  for (const [key, w] of watchers) {
    const next = wantedByKey.get(key);
    if (!next) {
      w.watcher.close();
      watchers.delete(key);
    } else {
      w.root.policyIds = next.policyIds; // assignment changed, same location
      w.root.channelDetail = next.channelDetail;
    }
  }

  for (const root of wanted) {
    const key = root.root.toLowerCase();
    if (watchers.has(key)) continue;
    try {
      const watcher = fs.watch(root.root, { recursive: true }, (_event, filename) => {
        if (filename) scheduleCheck(path.join(root.root, filename.toString()), root);
      });
      watcher.on("error", () => {
        watcher.close();
        watchers.delete(key); // drive removed / share gone - re-attached on a later refresh
      });
      watchers.set(key, { root, watcher });
      // A drive plugged in (or the agent started) shortly before: pick up what arrived meanwhile.
      await sweepRoot(root, Date.now() - 2 * REFRESH_MS - DATA_MOVEMENT_LOOKBACK_BUFFER_MS, { files: SWEEP_MAX_ENTRIES });
    } catch (err) {
      console.error(`Data movement: can't watch ${root.root}`, err);
    }
  }

  const cutoff = Date.now() - REPORTED_TTL_MS;
  for (const [k, at] of reported) if (at < cutoff) reported.delete(k);
  await processArrivals();
}

// ---- Where it came from ---------------------------------------------------------------------

function lookupKey(name: string, size: number): string {
  return `${name.toLowerCase()}|${size}`;
}

// Windows Search index: finds the file anywhere indexed, and still lists a file for a short while
// after it was moved away - which is how a move is told apart from a copy.
const INDEX_LOOKUP_PS = `
$ErrorActionPreference = 'Stop'
$wanted = $env:EM_DM_LOOKUP | ConvertFrom-Json
$out = @{}
try {
  $conn = New-Object -ComObject ADODB.Connection
  $conn.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
  foreach ($w in $wanted) {
    $name = $w.name.Replace("'", "''")
    $paths = @()
    try {
      $rs = $conn.Execute("SELECT TOP 20 System.ItemPathDisplay FROM SYSTEMINDEX WHERE System.FileName = '$name' AND System.Size = $($w.size)")
      while (-not $rs.EOF) { $paths += [string]$rs.Fields.Item(0).Value; $rs.MoveNext() }
      $rs.Close()
    } catch {}
    $out["$($w.name.ToLower())|$($w.size)"] = $paths
  }
  $conn.Close()
} catch {}
$out | ConvertTo-Json -Compress -Depth 3
`;

async function indexLookup(wanted: { name: string; size: number }[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (wanted.length === 0) return result;
  try {
    const raw = (await powershell(INDEX_LOOKUP_PS, { EM_DM_LOOKUP: JSON.stringify(wanted) })).trim();
    if (!raw) return result;
    const parsed = JSON.parse(raw) as Record<string, string | string[] | null>;
    for (const [k, v] of Object.entries(parsed)) result.set(k, asArray(v).filter((p): p is string => typeof p === "string" && p.length > 0));
  } catch (err) {
    console.error("Data movement: Windows Search lookup failed", err);
  }
  return result;
}

const SKIP_WALK_DIRS = new Set(["appdata", "node_modules", ".git", "$recycle.bin", "system volume information"]);

// The users' own folders, for files the search index doesn't cover. One walk per batch, looking
// for every wanted name/size at once, within a time and entry budget.
async function folderLookup(wanted: Set<string>, skipRoots: string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (wanted.size === 0) return found;
  const profiles = await listUserProfiles();
  const starts: string[] = [];
  for (const p of profiles) {
    for (const sub of ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"]) starts.push(path.join(p.root, sub));
    starts.push(...p.oneDriveRoots);
  }
  const deadline = Date.now() + SOURCE_WALK_MAX_MS;
  let entriesLeft = SOURCE_WALK_MAX_ENTRIES;
  const skip = skipRoots.map((r) => r.toLowerCase());
  const visited = new Set<string>();
  const wantedNames = new Set([...wanted].map((k) => k.slice(0, k.lastIndexOf("|"))));

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 12 || entriesLeft <= 0 || Date.now() > deadline) return;
    const lowerDir = dir.toLowerCase();
    if (visited.has(lowerDir)) return;
    visited.add(lowerDir);
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (--entriesLeft <= 0 || Date.now() > deadline) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_WALK_DIRS.has(e.name.toLowerCase())) await walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      // Cheap name check first; stat only files whose name is wanted.
      if (!wantedNames.has(e.name.toLowerCase())) continue;
      if (skip.some((s) => full.toLowerCase().startsWith(s))) continue;
      try {
        const st = await fsp.stat(full);
        const k = lookupKey(e.name, st.size);
        if (wanted.has(k)) found.set(k, [...(found.get(k) ?? []), full]);
      } catch {
        // locked - skip
      }
    }
  }

  for (const s of starts) await walk(s, 0);
  return found;
}

async function sourceState(p: string): Promise<"file" | "other" | "gone"> {
  try {
    return (await fsp.stat(p)).isFile() ? "file" : "other";
  } catch {
    return "gone";
  }
}

// The best source among the candidates: one still present (copy) - preferring the signed-in
// user's own files - else one the index knew but that is gone now (move).
async function pickSource(candidates: string[], arrival: Arrival, user: string | null): Promise<{ sourcePath: string | null; operation: DataMovementOperation }> {
  const destLower = arrival.filePath.toLowerCase();
  const rootLower = arrival.root.root.toLowerCase();
  const others = [...new Set(candidates)].filter((c) => {
    const l = c.toLowerCase();
    return l !== destLower && !l.startsWith(rootLower.endsWith("\\") ? rootLower : rootLower + "\\");
  });
  const present: string[] = [];
  const gone: string[] = [];
  for (const c of others) {
    const state = await sourceState(c);
    if (state === "file") present.push(c);
    else if (state === "gone") gone.push(c);
  }
  const userDir = user ? `\\users\\${user.toLowerCase()}\\` : null;
  const prefer = (list: string[]) => (userDir ? list.find((p) => p.toLowerCase().includes(userDir)) : undefined) ?? list[0];
  if (present.length > 0) return { sourcePath: prefer(present), operation: "COPY" };
  if (gone.length > 0) return { sourcePath: prefer(gone), operation: "MOVE" };
  return { sourcePath: null, operation: "UNKNOWN" };
}

// Turns the arrivals waiting so far into events with their source, ready to send.
async function processArrivals(): Promise<void> {
  if (processing || arrivals.length === 0) return;
  processing = true;
  try {
    while (arrivals.length > 0) {
      const batch = arrivals.splice(0, MAX_PER_REQUEST);
      const wantedKeys = new Map<string, { name: string; size: number }>();
      for (const a of batch) wantedKeys.set(lookupKey(path.basename(a.filePath), a.size), { name: path.basename(a.filePath), size: a.size });

      const fromIndex = await indexLookup([...wantedKeys.values()].slice(0, MAX_INDEX_LOOKUPS));
      // Folder walk for what the index had nothing (still present) for.
      const unresolved = new Set<string>();
      for (const k of wantedKeys.keys()) if (!(fromIndex.get(k)?.length)) unresolved.add(k);
      const fromFolders = await folderLookup(unresolved, [...watchers.values()].map((w) => w.root.root));

      for (const a of batch) {
        const k = lookupKey(path.basename(a.filePath), a.size);
        const user = a.root.owner ?? signedInUser;
        const { sourcePath, operation } = await pickSource([...(fromIndex.get(k) ?? []), ...(fromFolders.get(k) ?? [])], a, user);
        const event: DataMovementFileEvent = {
          filePath: a.filePath,
          fileSizeBytes: a.size,
          fileModifiedAt: a.modifiedAt.toISOString(),
          channel: a.root.channel,
          channelDetail: a.root.channelDetail,
          sourcePath,
          operation,
          userName: user,
        };
        for (const policyId of a.root.policyIds) {
          const list = queue.get(policyId) ?? [];
          if (list.length < MAX_QUEUE) list.push(event);
          queue.set(policyId, list);
        }
      }
    }
  } finally {
    processing = false;
  }
}

async function sendReport(client: AxiosInstance): Promise<void> {
  for (const [policyId, events] of queue) {
    while (events.length > 0) {
      const chunk = events.slice(0, MAX_PER_REQUEST);
      const payload: DataMovementScanResultPayload = { scannedAt: new Date().toISOString(), policyId, events: chunk };
      try {
        await client.post("/api/agent/data-movement/scan-result", payload);
        events.splice(0, chunk.length);
      } catch (err) {
        console.error(`Data movement: report for policy ${policyId} failed - kept for the next attempt`, err);
        return;
      }
    }
    queue.delete(policyId);
  }
}

// ---- Entry points ---------------------------------------------------------------------------

let client: AxiosInstance | null = null;

async function refresh(): Promise<void> {
  if (!client) return;
  try {
    const { data } = await client.get<AssignedDataMovementPolicyWire[]>("/api/agent/data-movement/assigned");
    assigned = data;
    await refreshWatchers();
  } catch (err) {
    console.error("Data movement: refresh failed", err);
  }
}

export function startDataMovementMonitor(apiClient: AxiosInstance): void {
  if (process.platform !== "win32") return;
  client = apiClient;
  void refresh();
  setInterval(() => void refresh(), REFRESH_MS);
  setInterval(() => void sendReport(apiClient), REPORT_MS);
}

// Periodic safety net (and "scan now"): everything that arrived in the last interval on every
// monitored location, in case the live watcher missed it. Already-reported files are skipped.
export async function runDataMovementScan(apiClient: AxiosInstance): Promise<void> {
  if (process.platform !== "win32") return;
  client = apiClient;
  const { data } = await apiClient.get<AssignedDataMovementPolicyWire[]>("/api/agent/data-movement/assigned");
  assigned = data;
  if (assigned.length === 0) return;
  const sinceMs = Date.now() - DEFAULT_DATA_MOVEMENT_SCAN_INTERVAL_MS - DATA_MOVEMENT_LOOKBACK_BUFFER_MS;
  const budget = { files: SWEEP_MAX_ENTRIES };
  for (const root of await resolveRoots()) await sweepRoot(root, sinceMs, budget);
  await processArrivals();
  await sendReport(apiClient);
}
