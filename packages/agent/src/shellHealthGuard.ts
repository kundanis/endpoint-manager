import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { SafetyEventPayload } from "@em/shared";
import { appControlRulesActive, IFEO_MARKER, IFEO_ROOTS, REMOVE_ALL_BLOCKS_PS, watcherRulesFile } from "./appControlPaths";
import { agentConfig } from "./config";

const execFileAsync = promisify(execFile);

// Desktop safety net. If a signed-in user has had no desktop (no explorer.exe in their session)
// for 2 minutes while this agent's blocking rules are in force, the agent assumes its own rules
// broke sign-in: it removes every Application control rule it wrote, tells the user to sign in
// again, and reports it. The server then pauses the endpoint, so the rules stay off until an
// admin has fixed the policy. (Command blocking protections never touch the desktop and stay on
// until that pause arrives.)
// This catches mistakes no rule check foresaw.

const CHECK_MS = 30_000;
const GRACE_MS = 2 * 60_000;
const STATE_FILE = () => path.join(agentConfig.stateDir, "shell-safety.json");

interface State {
  suspended: boolean; // enforcement off until the server has acknowledged the report
  reportPending: SafetyEventPayload | null;
}

let state: State = { suspended: false, reportPending: null };
try {
  state = { ...state, ...(JSON.parse(fs.readFileSync(STATE_FILE(), "utf8")) as Partial<State>) };
} catch {
  // first run
}

async function saveState() {
  await fsp.mkdir(agentConfig.stateDir, { recursive: true });
  await fsp.writeFile(STATE_FILE(), JSON.stringify(state), "utf8");
}

// Read by the Application control and Command blocking enforcers.
export function isEnforcementSuspended(): boolean {
  return state.suspended;
}

// Signed-in desktop sessions, whether each has a desktop, and how many launch blocks this agent wrote.
// RemoteApp sessions (rdpinit/rdpshell) never have explorer.exe and are left out.
export const CHECK_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$managed = 0
foreach ($root in @(${IFEO_ROOTS.map((r) => `'${r}'`).join(", ")})) {
  $managed += @(Get-ChildItem -LiteralPath $root | Where-Object { (Get-ItemProperty -LiteralPath $_.PSPath).${IFEO_MARKER} }).Count
}
$procs = Get-CimInstance Win32_Process -Property Name, SessionId
$sessions = @()
# quser is a fixed-width table and user names can contain spaces, so the user name is cut by
# the header's column positions (as in userProductivityScanner.ts) and the id / state are
# taken from the text after it.
$lines = @(quser 2>$null)
if ($lines.Count -gt 1) {
  $idxSession = $lines[0].IndexOf('SESSIONNAME')
  foreach ($line in ($lines | Select-Object -Skip 1)) {
    $text = $line -replace '^>', ' '
    if ($idxSession -lt 1 -or $text.Length -le $idxSession) { continue }
    $m = [regex]::Match($text.Substring($idxSession), '\\s(\\d+)\\s+Active\\b')
    if (-not $m.Success) { continue }
    $id = [int]$m.Groups[1].Value
    $names = @($procs | Where-Object { $_.SessionId -eq $id } | ForEach-Object { $_.Name.ToLowerInvariant() })
    if ($names -contains 'rdpinit.exe' -or $names -contains 'rdpshell.exe') { continue }
    $sessions += [PSCustomObject]@{ Id = $id; User = $text.Substring(0, $idxSession).Trim(); HasDesktop = ($names -contains 'explorer.exe') }
  }
}
ConvertTo-Json -InputObject ([PSCustomObject]@{ Managed = $managed; HasShell = (Test-Path "$env:SystemRoot\\explorer.exe"); Sessions = @($sessions) }) -Depth 3 -Compress
`;


const missingSince = new Map<number, number>(); // session id -> first time seen without a desktop

async function check(client: AxiosInstance) {
  if (state.reportPending) {
    await report(client);
    return;
  }
  if (state.suspended) return;

  let data: { Managed: number; HasShell: boolean; Sessions: { Id: number; User: string; HasDesktop: boolean }[] };
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", CHECK_PS], { timeout: 25_000 });
    data = JSON.parse(stdout.trim() || "{}");
  } catch (err) {
    console.error("Desktop safety net: check failed", err);
    return;
  }
  if (!data.HasShell) return; // Server Core and similar: no desktop to protect

  const now = Date.now();
  const seen = new Set<number>();
  for (const s of data.Sessions ?? []) {
    seen.add(s.Id);
    if (s.HasDesktop) missingSince.delete(s.Id);
    else if (!missingSince.has(s.Id)) missingSince.set(s.Id, now);
  }
  for (const id of [...missingSince.keys()]) if (!seen.has(id)) missingSince.delete(id);

  // Only the agent's own blocking rules can be undone here; with none in force there is
  // nothing to recover from.
  const managed = data.Managed + (appControlRulesActive() ? 1 : 0);
  if (managed === 0) return;
  const stuck = (data.Sessions ?? []).find((s) => !s.HasDesktop && now - (missingSince.get(s.Id) ?? now) >= GRACE_MS);
  if (!stuck) return;

  console.error(`Desktop safety net: ${stuck.User}'s desktop hasn't started for 2 minutes with Application control blocking in force - removing it.`);
  state.suspended = true;
  state.reportPending = {
    kind: "DESKTOP_NOT_STARTED",
    username: stuck.User,
    managedRules: managed,
    detectedAt: new Date().toISOString(),
  };
  await saveState();
  await fsp.writeFile(watcherRulesFile(), "[]", "utf8").catch(() => undefined); // the process watcher stops closing programs
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", REMOVE_ALL_BLOCKS_PS], { timeout: 60_000 });
  } catch (err) {
    console.error("Desktop safety net: removing rules failed", err);
  }
  // Tell the user what to do; msg.exe isn't on every edition, so a failure is fine.
  await execFileAsync("msg.exe", [String(stuck.Id), "/TIME:600", "Endpoint IQ removed a blocking rule that stopped your desktop from starting. Press Ctrl+Alt+Del, choose Sign out, then sign in again."]).catch(() => undefined);
  missingSince.clear();
  await report(client);
}

async function report(client: AxiosInstance) {
  if (!state.reportPending) return;
  try {
    await client.post("/api/agent/safety-event", state.reportPending);
    // The server has paused the endpoint: its policies now come back empty, so the local
    // suspension can end (rules return only when an admin resumes the endpoint).
    state = { suspended: false, reportPending: null };
    await saveState();
    console.log("Desktop safety net: reported; the endpoint is paused on the server.");
  } catch (err) {
    console.error("Desktop safety net: report failed (enforcement stays off until it gets through)", err);
  }
}

export function startShellHealthGuard(client: AxiosInstance): void {
  if (process.platform !== "win32") return;
  const run = () => check(client).catch((err) => console.error("Desktop safety net failed", err));
  setTimeout(run, 20_000);
  setInterval(run, CHECK_MS);
}
