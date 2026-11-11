import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AssignedScreenCaptureWire, ScreenCaptureCapture, ScreenCaptureReportPayload, ScreenCaptureSource } from "@em/shared";
import { SCREEN_CAPTURE_IMAGE_EXTENSIONS, SCREEN_CAPTURE_IMAGE_MAX_BYTES, isIgnoredScreenshotOpener } from "@em/shared";
import { agentConfig } from "./config";
import { listUserProfiles, resolveTargetPath } from "./userPaths";

const execFileAsync = promisify(execFile);

// DLP -> Screen capture monitoring. Watches the folders screenshots are saved to, for every user
// on the machine, and reports each new capture the moment it appears - so taking a screenshot
// and deleting it straight after still leaves a record. It also reports deletions, and (with
// Windows file-access auditing on those folders) the programs that opened each screenshot -
// a browser, WhatsApp, Outlook or OneDrive opening it usually means it was sent or uploaded.
// Only metadata is reported, unless a policy keeps images for this endpoint (saveImages): then
// each new screenshot is read the moment it appears (so deleting it straight after doesn't stop
// it) and uploaded after its capture has been reported. Videos are never uploaded.

const REFRESH_MS = 60_000; // re-read the assignment and look for newly created folders
const REPORT_MS = 60_000;
const AUDIT_READ_MS = 2 * 60_000;
const SETTLE_MS = 1_500; // let the writer finish before stat-ing a new file
const TEMP_SETTLE_MS = 5_000; // Snipping Tool's temp copy: handled after the saved copy
const DUPLICATE_WINDOW_MS = 3_000;
const KNOWN_TTL_MS = 3 * 24 * 60 * 60_000;
const MAX_QUEUE = 2_000;

const CAPTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".mp4"]);

// Snipping Tool (Windows 11) keeps a copy of every capture here, saved or not; Win+Shift+S on
// older builds uses ScreenClip. Windows cleans these up by itself, so deletions here mean nothing.
const SNIPPING_TEMP_DIRS = [
  "AppData\\Local\\Packages\\Microsoft.ScreenSketch_8wekyb3d8bbwe\\TempState\\Screenshots",
  "AppData\\Local\\Packages\\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\\TempState\\ScreenClip",
];


interface WatchedDir {
  dir: string;
  source: ScreenCaptureSource;
  username: string;
  temp: boolean;
}

interface KnownCapture {
  username: string;
  dir: string;
  size: number;
  birthMs: number;
  seenAt: number;
}

let assigned: AssignedScreenCaptureWire = { sources: [], extraPaths: [], trackOpenedBy: false, saveImages: false };

interface PendingImage {
  filePath: string;
  capturedAt: string;
  data: Buffer;
  attempts: number;
}
const MAX_IMAGE_QUEUE_BYTES = 150 * 1024 * 1024;
const MAX_IMAGE_ATTEMPTS = 10;
const images: PendingImage[] = [];
let imageQueueBytes = 0;

async function queueImage(file: string, size: number, capturedAt: string) {
  if (!assigned.saveImages || size === 0 || size > SCREEN_CAPTURE_IMAGE_MAX_BYTES) return;
  if (!SCREEN_CAPTURE_IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase())) return;
  if (imageQueueBytes + size > MAX_IMAGE_QUEUE_BYTES) return; // server unreachable for long - keep memory bounded
  try {
    const data = await fsp.readFile(file);
    images.push({ filePath: file, capturedAt, data, attempts: 0 });
    imageQueueBytes += data.length;
  } catch {
    // deleted or locked before it could be read - the capture itself is still reported
  }
}

// After the captures are reported: the server matches each image to its capture.
async function uploadImages(client: AxiosInstance) {
  for (const img of [...images]) {
    let done = true;
    try {
      await client.post("/api/agent/screen-capture/image", img.data, {
        headers: { "Content-Type": "application/octet-stream", "X-Capture-Path": encodeURIComponent(img.filePath), "X-Captured-At": img.capturedAt },
        maxBodyLength: SCREEN_CAPTURE_IMAGE_MAX_BYTES + 1024,
        timeout: 120_000,
      });
    } catch (err: any) {
      const status = err?.response?.status;
      // 409: capture not recorded yet; no response: server unreachable. Both: try again later.
      if ((status === 409 || !status) && ++img.attempts < MAX_IMAGE_ATTEMPTS) done = false;
      else console.error(`Screen capture: image upload failed (${status ?? "no response"})`, img.filePath);
    }
    if (done) {
      images.splice(images.indexOf(img), 1);
      imageQueueBytes -= img.data.length;
    }
  }
}
const watchers = new Map<string, { watched: WatchedDir; watcher: fs.FSWatcher }>();
const known = new Map<string, KnownCapture>(); // lower-cased path -> capture
const pending = new Map<string, NodeJS.Timeout>();
// Folders this agent put an audit rule on - kept on disk so the rules are removed again after a
// restart once the policy no longer applies.
const AUDITED_DIRS_FILE = path.join(agentConfig.stateDir, "screen-capture-audited.json");
const auditedDirs = new Set<string>();

function loadAuditedDirs() {
  try {
    for (const d of JSON.parse(fs.readFileSync(AUDITED_DIRS_FILE, "utf8")) as string[]) auditedDirs.add(d);
  } catch {
    // first run
  }
}

async function saveAuditedDirs() {
  try {
    await fsp.mkdir(agentConfig.stateDir, { recursive: true });
    await fsp.writeFile(AUDITED_DIRS_FILE, JSON.stringify([...auditedDirs]), "utf8");
  } catch (err) {
    console.error("Screen capture: couldn't save audited folders", err);
  }
}
let auditPolicyEnabled = false;
let lastAuditReadAt = new Date(Date.now() - AUDIT_READ_MS);
const queue: ScreenCaptureReportPayload = { captures: [], deletions: [], opens: [] };

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function push<T>(list: T[], item: T) {
  if (list.length < MAX_QUEUE) list.push(item);
}

// Every folder to watch for the current assignment, per user profile.
async function resolveWatchedDirs(): Promise<WatchedDir[]> {
  const sources = new Set(assigned.sources);
  if (sources.size === 0) return [];
  const profiles = await listUserProfiles();
  const out: WatchedDir[] = [];
  const add = (dir: string, source: ScreenCaptureSource, username: string, temp = false) => out.push({ dir, source, username, temp });

  for (const p of profiles) {
    const user = path.basename(p.root);
    if (sources.has("WINDOWS")) {
      add(path.join(p.root, "Pictures", "Screenshots"), "WINDOWS", user);
      for (const od of p.oneDriveRoots) {
        add(path.join(od, "Pictures", "Screenshots"), "WINDOWS", user);
        add(path.join(od, "Screenshots"), "WINDOWS", user);
      }
    }
    if (sources.has("SNIPPING_TOOL")) {
      for (const rel of SNIPPING_TEMP_DIRS) add(path.join(p.root, rel), "SNIPPING_TOOL", user, true);
      add(path.join(p.root, "Videos", "Screen Recordings"), "SNIPPING_TOOL", user);
    }
    if (sources.has("GAME_BAR")) add(path.join(p.root, "Videos", "Captures"), "GAME_BAR", user);
    if (sources.has("THIRD_PARTY")) {
      add(path.join(p.root, "Documents", "ShareX", "Screenshots"), "THIRD_PARTY", user);
      for (const od of p.oneDriveRoots) add(path.join(od, "Documents", "ShareX", "Screenshots"), "THIRD_PARTY", user);
    }
  }
  if (sources.has("CUSTOM")) {
    for (const raw of assigned.extraPaths) {
      for (const dir of await resolveTargetPath(raw, profiles)) {
        const owner = profiles.find((p) => dir.toLowerCase().startsWith(p.root.toLowerCase() + "\\"));
        add(dir, "CUSTOM", owner ? path.basename(owner.root) : "(shared folder)");
      }
    }
  }

  const existing: WatchedDir[] = [];
  const seen = new Set<string>();
  for (const w of out) {
    const key = w.dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if ((await fsp.stat(w.dir)).isDirectory()) existing.push(w);
    } catch {
      // not created yet (e.g. no screenshot taken so far) - picked up on a later refresh
    }
  }
  return existing;
}

// A second file for the same capture: Snipping Tool's temp copy next to the saved one, or a
// screenshot renamed straight after it was taken.
function isDuplicate(file: string, w: WatchedDir, size: number, birthMs: number): boolean {
  for (const [p, k] of known) {
    if (p === file.toLowerCase() || k.username !== w.username) continue;
    if (Math.abs(k.birthMs - birthMs) > DUPLICATE_WINDOW_MS) continue;
    if (k.dir !== w.dir.toLowerCase() || k.size === size) return true;
  }
  return false;
}

async function handleChange(file: string, w: WatchedDir) {
  const key = file.toLowerCase();
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    // Gone: a deletion (or the old name of a rename). Snipping Tool's temp copies are cleaned up
    // by Windows, not the user, so those don't count.
    if (known.has(key)) {
      known.delete(key);
      if (!w.temp) push(queue.deletions, { filePath: file, deletedAt: new Date().toISOString() });
    }
    return;
  }
  if (!stat.isFile() || known.has(key) || !CAPTURE_EXTENSIONS.has(path.extname(file).toLowerCase())) return;
  // Only files created just now are new captures - not old images moved or renamed in.
  if (Date.now() - stat.birthtimeMs > 10 * 60_000) return;
  if (isDuplicate(file, w, stat.size, stat.birthtimeMs)) return;

  known.set(key, { username: w.username, dir: w.dir.toLowerCase(), size: stat.size, birthMs: stat.birthtimeMs, seenAt: Date.now() });
  const capturedAt = new Date(stat.birthtimeMs);
  const capture: ScreenCaptureCapture = {
    username: w.username,
    source: w.source,
    filePath: file,
    fileSizeBytes: stat.size,
    capturedAt: capturedAt.toISOString(),
    captureDay: localDay(capturedAt),
  };
  push(queue.captures, capture);
  await queueImage(file, stat.size, capture.capturedAt);
}

function schedule(file: string, w: WatchedDir) {
  const key = file.toLowerCase();
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      handleChange(file, w).catch((err) => console.error("Screen capture: failed to handle", file, err));
    }, w.temp ? TEMP_SETTLE_MS : SETTLE_MS),
  );
}

async function listFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await listFiles(full, depth + 1)));
    else if (e.isFile() && CAPTURE_EXTENSIONS.has(path.extname(e.name).toLowerCase())) files.push(full);
  }
  return files;
}

// Files created while the agent wasn't watching (agent start, folder just created).
async function catchUp(w: WatchedDir) {
  for (const file of await listFiles(w.dir)) {
    try {
      const stat = await fsp.stat(file);
      // Seed what's already there so a later deletion of it is recognised; only recent ones are new captures.
      if (Date.now() - stat.birthtimeMs > 10 * 60_000) {
        known.set(file.toLowerCase(), { username: w.username, dir: w.dir.toLowerCase(), size: stat.size, birthMs: stat.birthtimeMs, seenAt: Date.now() });
      } else {
        await handleChange(file, w);
      }
    } catch {
      // vanished meanwhile
    }
  }
}

async function refreshWatchers() {
  const wanted = await resolveWatchedDirs();
  const wantedKeys = new Set(wanted.map((w) => w.dir.toLowerCase()));

  for (const [key, { watcher }] of watchers) {
    if (!wantedKeys.has(key)) {
      watcher.close();
      watchers.delete(key);
    }
  }
  for (const w of wanted) {
    const key = w.dir.toLowerCase();
    if (watchers.has(key)) continue;
    try {
      const watcher = fs.watch(w.dir, { recursive: true }, (_event, filename) => {
        if (filename) schedule(path.join(w.dir, filename.toString()), w);
      });
      watcher.on("error", () => {
        watcher.close();
        watchers.delete(key); // folder deleted - re-attached on a later refresh if it comes back
      });
      watchers.set(key, { watched: w, watcher });
      await catchUp(w);
    } catch (err) {
      console.error(`Screen capture: can't watch ${w.dir}`, err);
    }
  }

  const cutoff = Date.now() - KNOWN_TTL_MS;
  for (const [p, k] of known) if (k.seenAt < cutoff) known.delete(p);

  await syncAuditing(assigned.trackOpenedBy ? wanted.map((w) => w.dir) : []);
}

async function powershell(script: string, env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  return stdout;
}

// Windows file-access auditing: the "File System" audit subcategory (by GUID, so it works on
// every language of Windows) plus an audit rule "Everyone - read - success" on each watched
// folder. Windows then logs event 4663 with the program for every read of a screenshot.
const SET_AUDIT_RULES_PS = `
$ErrorActionPreference = 'Stop'
$sid = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$none = [System.Security.AccessControl.PropagationFlags]::None
$rule = New-Object System.Security.AccessControl.FileSystemAuditRule($sid, [System.Security.AccessControl.FileSystemRights]::ReadData, $inherit, $none, [System.Security.AccessControl.AuditFlags]::Success)
$done = @()
foreach ($d in (ConvertFrom-Json $env:SC_ADD)) {
  try { $acl = [System.IO.Directory]::GetAccessControl($d, 'Audit'); $acl.AddAuditRule($rule); [System.IO.Directory]::SetAccessControl($d, $acl); $done += $d } catch {}
}
foreach ($d in (ConvertFrom-Json $env:SC_REMOVE)) {
  try { $acl = [System.IO.Directory]::GetAccessControl($d, 'Audit'); [void]$acl.RemoveAuditRuleSpecific($rule); [System.IO.Directory]::SetAccessControl($d, $acl) } catch {}
}
ConvertTo-Json -InputObject @($done) -Compress
`;

async function syncAuditing(dirs: string[]) {
  if (dirs.length > 0 && !auditPolicyEnabled) {
    try {
      await execFileAsync("auditpol.exe", ["/set", "/subcategory:{0CCE921D-69AE-11D9-BED3-505054503030}", "/success:enable"]);
      auditPolicyEnabled = true;
    } catch (err) {
      console.error("Screen capture: couldn't enable file-system auditing", err);
    }
  }
  const wanted = new Set(dirs);
  const add = dirs.filter((d) => !auditedDirs.has(d));
  const remove = [...auditedDirs].filter((d) => !wanted.has(d));
  if (add.length === 0 && remove.length === 0) return;
  try {
    const out = await powershell(SET_AUDIT_RULES_PS, { SC_ADD: JSON.stringify(add), SC_REMOVE: JSON.stringify(remove) });
    for (const d of JSON.parse(out.trim() || "[]") as string[]) auditedDirs.add(d);
    for (const d of remove) auditedDirs.delete(d);
    await saveAuditedDirs();
  } catch (err) {
    console.error("Screen capture: couldn't set folder auditing", err);
  }
}

const READ_OPENS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$since = [DateTime]::Parse($env:SC_SINCE).ToLocalTime()
$events = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4663; StartTime = $since } -MaxEvents 5000 -ErrorAction SilentlyContinue
$out = @()
foreach ($e in $events) {
  $x = [xml]$e.ToXml()
  $d = @{}
  foreach ($n in $x.Event.EventData.Data) { $d[$n.Name] = $n.'#text' }
  $out += [PSCustomObject]@{ File = $d['ObjectName']; Process = $d['ProcessName']; At = $e.TimeCreated.ToUniversalTime().ToString('o') }
}
ConvertTo-Json -InputObject @($out) -Compress
`;

const reportedOpens = new Set<string>(); // "path|process" already sent

async function readOpens() {
  if (auditedDirs.size === 0) return;
  const since = lastAuditReadAt;
  lastAuditReadAt = new Date();
  let rows: { File?: string; Process?: string; At?: string }[];
  try {
    rows = JSON.parse((await powershell(READ_OPENS_PS, { SC_SINCE: since.toISOString() })).trim() || "[]");
  } catch (err) {
    console.error("Screen capture: couldn't read the Security log", err);
    return;
  }
  const dirs = [...auditedDirs].map((d) => d.toLowerCase() + "\\");
  for (const r of rows) {
    if (!r.File || !r.Process || !r.At) continue;
    const file = r.File.toLowerCase();
    if (!dirs.some((d) => file.startsWith(d)) || !CAPTURE_EXTENSIONS.has(path.extname(file))) continue;
    const proc = path.win32.basename(r.Process);
    if (isIgnoredScreenshotOpener(proc)) continue; // shell, indexing, antivirus... (shared list)
    const key = `${file}|${proc.toLowerCase()}`;
    if (reportedOpens.has(key)) continue;
    reportedOpens.add(key);
    push(queue.opens, { filePath: r.File, process: proc, at: r.At });
  }
  if (reportedOpens.size > 20_000) reportedOpens.clear();
}

async function sendReport(client: AxiosInstance) {
  if (queue.captures.length + queue.deletions.length + queue.opens.length === 0) {
    if (images.length > 0) await uploadImages(client); // retries
    return;
  }
  const batch: ScreenCaptureReportPayload = {
    captures: queue.captures.splice(0, 500),
    deletions: queue.deletions.splice(0, 500),
    opens: queue.opens.splice(0, 1000),
  };
  try {
    await client.post("/api/agent/screen-capture/report", batch);
    if (batch.captures.length > 0) console.log(`Screen capture: reported ${batch.captures.length} capture(s)`);
    if (images.length > 0) await uploadImages(client);
  } catch (err) {
    // Keep them for the next attempt.
    queue.captures.unshift(...batch.captures);
    queue.deletions.unshift(...batch.deletions);
    queue.opens.unshift(...batch.opens);
    console.error("Screen capture: report failed", err);
  }
}

async function refresh(client: AxiosInstance) {
  try {
    const { data } = await client.get<AssignedScreenCaptureWire>("/api/agent/screen-capture/assigned");
    assigned = data;
    await refreshWatchers();
  } catch (err) {
    console.error("Screen capture: refresh failed", err);
  }
}

export function startScreenCaptureMonitor(client: AxiosInstance): void {
  if (process.platform !== "win32") return;
  loadAuditedDirs();
  void refresh(client);
  setInterval(() => void refresh(client), REFRESH_MS);
  setInterval(() => void sendReport(client), REPORT_MS);
  setInterval(() => void readOpens(), AUDIT_READ_MS);
}
