import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { SecuritySignal } from "@em/shared";
import { agentConfig } from "./config";
import { collectInstalledSoftware } from "./inventory";
import { listUserProfiles } from "./userPaths";

const execFileAsync = promisify(execFile);

// Signals for Identity Governance -> User Risk, read on the endpoint:
// - Windows event log: failed sign-ins (4625), a user added to local Administrators (4732),
//   the Security or System log cleared (1102 / 104)
// - antivirus (Security Center) or a firewall profile switched off since the last check
// - software installed since the last check (the inventory's own list, compared)
// - bursts of deleted files in users' Documents / Desktop / Downloads / Pictures / OneDrive
// Reported every 5 minutes; the server files them into each user's activity stream.

const INTERVAL_MS = 5 * 60_000;
const DELETE_BURST_MIN = 20; // deletions per user per interval worth reporting
const STATE_FILE = () => path.join(agentConfig.stateDir, "security-signals.json");

interface State {
  lastEventAt?: string;
  avOn?: boolean | null;
  firewall?: Record<string, boolean>;
  software?: string[];
}

function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), "utf8")) as State;
  } catch {
    return {};
  }
}

async function saveState(state: State) {
  await fsp.mkdir(agentConfig.stateDir, { recursive: true });
  await fsp.writeFile(STATE_FILE(), JSON.stringify(state), "utf8");
}

async function powershell(script: string, env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  return stdout.trim();
}

// ---- event log

// Failed sign-ins and group changes are only logged when those audit subcategories are on
// (they are by default on Windows 10/11, but a hardened image may have changed it). By GUID,
// so it works on every language of Windows: Logon, Security Group Management.
let auditEnsured = false;
async function ensureAuditing() {
  if (auditEnsured) return;
  auditEnsured = true;
  for (const args of [
    ["/set", "/subcategory:{0CCE9215-69AE-11D9-BED3-505054503030}", "/failure:enable"],
    ["/set", "/subcategory:{0CCE9237-69AE-11D9-BED3-505054503030}", "/success:enable"],
  ]) {
    await execFileAsync("auditpol.exe", args).catch((err) => console.error("Security signals: auditpol failed", err));
  }
}

const READ_EVENTS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$since = [DateTime]::Parse($env:SS_SINCE).ToLocalTime()
$events = @()
$events += Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625, 4732, 1102; StartTime = $since } -MaxEvents 3000 -ErrorAction SilentlyContinue
$events += Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 104; StartTime = $since } -MaxEvents 100 -ErrorAction SilentlyContinue
$out = @()
foreach ($e in $events) {
  if (-not $e) { continue }
  $x = [xml]$e.ToXml()
  $d = @{}
  if ($x.Event.EventData) { foreach ($n in $x.Event.EventData.Data) { if ($n.Name) { $d[$n.Name] = $n.'#text' } } }
  if ($x.Event.UserData) { foreach ($n in $x.Event.UserData.FirstChild.ChildNodes) { $d[$n.LocalName] = $n.InnerText } }
  if ($e.Id -eq 4732 -and $d['MemberSid']) {
    try { $d['MemberResolved'] = (New-Object System.Security.Principal.SecurityIdentifier($d['MemberSid'])).Translate([System.Security.Principal.NTAccount]).Value } catch {}
  }
  $out += [PSCustomObject]@{ Id = $e.Id; Log = $e.LogName; Record = $e.RecordId; At = $e.TimeCreated.ToUniversalTime().ToString('o'); Data = $d }
}
ConvertTo-Json -InputObject @($out) -Depth 4 -Compress
`;

interface RawEvent {
  Id: number;
  Log: string;
  Record: number;
  At: string;
  Data: Record<string, string | null>;
}

const isMachineOrSystem = (name: string | null | undefined) => !name || name.endsWith("$") || ["system", "local service", "network service", "-"].includes(name.toLowerCase());

function toSignal(e: RawEvent): SecuritySignal | null {
  const d = e.Data ?? {};
  const key = `${e.Log}:${e.Record}`;
  if (e.Id === 4625) {
    const user = d.TargetUserName ?? "";
    if (isMachineOrSystem(user)) return null;
    const from = d.IpAddress && d.IpAddress !== "-" ? ` from ${d.IpAddress}` : d.WorkstationName && d.WorkstationName !== "-" ? ` from ${d.WorkstationName}` : "";
    return {
      key,
      type: "FAILED_LOGON",
      occurredAt: e.At,
      username: d.TargetDomainName && d.TargetDomainName !== "-" ? `${d.TargetDomainName}\\${user}` : user,
      summary: `Failed sign-in as ${user}${from}`,
      detail: { logonType: d.LogonType, ip: d.IpAddress, workstation: d.WorkstationName, status: d.SubStatus ?? d.Status },
    };
  }
  if (e.Id === 4732) {
    if (d.TargetSid !== "S-1-5-32-544") return null; // only the local Administrators group
    const member = d.MemberResolved ?? d.MemberName ?? d.MemberSid ?? "unknown";
    const actor = d.SubjectUserName ?? "";
    return {
      key,
      type: "ADMIN_GROUP_ADD",
      occurredAt: e.At,
      // Whoever made the change; a change made by the system itself is filed under the new admin.
      username: isMachineOrSystem(actor) ? member : d.SubjectDomainName ? `${d.SubjectDomainName}\\${actor}` : actor,
      summary: `${member} added to local Administrators${isMachineOrSystem(actor) ? "" : ` by ${actor}`}`,
      detail: { member, actor },
    };
  }
  if (e.Id === 1102 || e.Id === 104) {
    const actor = d.SubjectUserName ?? null;
    const log = e.Id === 1102 ? "Security" : (d.Channel ?? "System");
    return {
      key,
      type: "LOG_CLEARED",
      occurredAt: e.At,
      username: actor && !isMachineOrSystem(actor) ? (d.SubjectDomainName ? `${d.SubjectDomainName}\\${actor}` : actor) : null,
      summary: `${log} event log cleared${actor ? ` by ${actor}` : ""}`,
      detail: { log, actor },
    };
  }
  return null;
}

async function readEventLog(state: State): Promise<SecuritySignal[]> {
  const since = state.lastEventAt ? new Date(new Date(state.lastEventAt).getTime() - 60_000) : new Date(Date.now() - 60 * 60_000);
  const startedAt = new Date();
  let rows: RawEvent[];
  try {
    rows = JSON.parse((await powershell(READ_EVENTS_PS, { SS_SINCE: since.toISOString() })) || "[]");
  } catch (err) {
    console.error("Security signals: couldn't read the event log", err);
    return [];
  }
  state.lastEventAt = startedAt.toISOString();
  return rows.map(toSignal).filter((s): s is SecuritySignal => s !== null);
}

// ---- protection state

const PROTECTION_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$av = $null
$products = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue
if ($products) { $av = @($products | ForEach-Object { [PSCustomObject]@{ Name = $_.displayName; On = ((($_.productState -shr 12) -band 0xF) -eq 1) } }) }
$fw = @(Get-NetFirewallProfile -ErrorAction SilentlyContinue | ForEach-Object { [PSCustomObject]@{ Name = [string]$_.Name; On = [bool]$_.Enabled } })
ConvertTo-Json -InputObject ([PSCustomObject]@{ Av = $av; Firewall = $fw }) -Depth 4 -Compress
`;

async function readProtection(state: State, firstRun: boolean): Promise<SecuritySignal[]> {
  let data: { Av: { Name: string; On: boolean }[] | null; Firewall: { Name: string; On: boolean }[] };
  try {
    data = JSON.parse((await powershell(PROTECTION_PS)) || "{}");
  } catch (err) {
    console.error("Security signals: couldn't read protection state", err);
    return [];
  }
  const now = new Date().toISOString();
  const out: SecuritySignal[] = [];

  // Security Center isn't on Windows Server - no antivirus signal there.
  if (data.Av && data.Av.length > 0) {
    const on = data.Av.some((p) => p.On);
    if (!firstRun && state.avOn === true && !on) {
      out.push({ key: `av-off:${now}`, type: "SECURITY_OFF", occurredAt: now, username: null, summary: `Antivirus real-time protection turned off (${data.Av.map((p) => p.Name).join(", ")})`, detail: { what: "antivirus", products: data.Av } });
    }
    state.avOn = on;
  }

  const firewall: Record<string, boolean> = {};
  for (const p of data.Firewall ?? []) {
    firewall[p.Name] = p.On;
    if (!firstRun && state.firewall?.[p.Name] === true && !p.On) {
      out.push({ key: `fw-off:${p.Name}:${now}`, type: "SECURITY_OFF", occurredAt: now, username: null, summary: `Windows Firewall turned off (${p.Name} profile)`, detail: { what: "firewall", profile: p.Name } });
    }
  }
  state.firewall = firewall;
  return out;
}

// ---- new software

async function readSoftware(state: State, firstRun: boolean): Promise<SecuritySignal[]> {
  let list: { name: string; version?: string | null; publisher?: string | null }[];
  try {
    list = await collectInstalledSoftware();
  } catch (err) {
    console.error("Security signals: couldn't read installed software", err);
    return [];
  }
  const names = [...new Set(list.map((s) => s.name).filter(Boolean))];
  const known = new Set(state.software ?? []);
  state.software = names;
  if (firstRun || known.size === 0) return []; // first look: just remember what's there
  const now = new Date().toISOString();
  return list
    .filter((s) => s.name && !known.has(s.name))
    .slice(0, 50)
    .map((s) => ({
      key: `sw:${s.name}:${now}`.slice(0, 100),
      type: "SOFTWARE_INSTALLED" as const,
      occurredAt: now,
      username: null,
      summary: `Installed ${s.name}${s.version ? ` ${s.version}` : ""}`,
      detail: { name: s.name, version: s.version ?? null, publisher: s.publisher ?? null },
    }));
}

// ---- file deletions

const deletions = new Map<string, { count: number; samples: string[]; first: number }>();
const watchers = new Map<string, fs.FSWatcher>();
const IGNORE_FILE = /(^~\$|\.tmp$|\.temp$|\.crdownload$|\.partial$|\.part$|^desktop\.ini$|^thumbs\.db$|\.lnk$)/i;

async function watchProfiles() {
  const profiles = await listUserProfiles();
  for (const p of profiles) {
    const user = path.basename(p.root);
    const dirs = [
      ...["Documents", "Desktop", "Downloads", "Pictures"].map((d) => path.join(p.root, d)),
      ...p.oneDriveRoots,
    ];
    for (const dir of dirs) {
      const key = dir.toLowerCase();
      if (watchers.has(key)) continue;
      try {
        if (!(await fsp.stat(dir)).isDirectory()) continue;
        const w = fs.watch(dir, { recursive: true }, (event, filename) => {
          if (event !== "rename" || !filename) return;
          const name = filename.toString();
          if (IGNORE_FILE.test(path.basename(name))) return;
          const full = path.join(dir, name);
          setTimeout(() => {
            fs.stat(full, (err) => {
              if (!err || err.code !== "ENOENT") return; // still there: created or renamed into place
              const entry = deletions.get(user) ?? { count: 0, samples: [], first: Date.now() };
              entry.count++;
              if (entry.samples.length < 5) entry.samples.push(name);
              deletions.set(user, entry);
            });
          }, 1000);
        });
        w.on("error", () => {
          w.close();
          watchers.delete(key);
        });
        watchers.set(key, w);
      } catch {
        // folder missing
      }
    }
  }
}

function drainDeletions(): SecuritySignal[] {
  const out: SecuritySignal[] = [];
  const now = new Date().toISOString();
  for (const [user, d] of deletions) {
    if (d.count >= DELETE_BURST_MIN) {
      out.push({
        key: `del:${user}:${now}`.slice(0, 100),
        type: "FILES_DELETED",
        occurredAt: now,
        username: user,
        summary: `${d.count} files deleted in ${Math.max(1, Math.round((Date.now() - d.first) / 60_000))} min (e.g. ${d.samples.slice(0, 3).join(", ")})`,
        detail: { count: d.count, samples: d.samples },
      });
    }
  }
  deletions.clear();
  return out;
}

// ---- loop

let pending: SecuritySignal[] = [];

async function cycle(client: AxiosInstance) {
  const state = loadState();
  const firstRun = !state.lastEventAt;
  await ensureAuditing();
  await watchProfiles();
  const signals = [...(await readEventLog(state)), ...(await readProtection(state, firstRun)), ...(await readSoftware(state, firstRun)), ...drainDeletions()];
  await saveState(state);

  pending = [...pending, ...signals].slice(-1000);
  if (pending.length === 0) return;
  try {
    await client.post("/api/agent/security-signals", { signals: pending });
    console.log(`Security signals: reported ${pending.length}`);
    pending = [];
  } catch (err) {
    console.error("Security signals: report failed (kept for the next attempt)", err);
  }
}

export function startSecuritySignals(client: AxiosInstance): void {
  if (process.platform !== "win32") return;
  const run = () => cycle(client).catch((err) => console.error("Security signals: cycle failed", err));
  setTimeout(run, 60_000);
  setInterval(run, INTERVAL_MS);
}
