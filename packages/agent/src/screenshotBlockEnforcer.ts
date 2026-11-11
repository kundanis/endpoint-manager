import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AssignedScreenshotBlockWire, ScreenshotBlockEventPayload, ScreenshotBlockReport } from "@em/shared";
import { agentConfig } from "./config";
import { isEnforcementSuspended } from "./shellHealthGuard";

const execFileAsync = promisify(execFile);

// EPM -> Screenshot blocking, the service side (runs as SYSTEM, every policy sync):
//  - hands the current settings to the tray app in each user's session (GET /screenshot-block on
//    the local channel), which swallows the screenshot keys, closes tools and clears pictures from
//    the clipboard, and reports each blocked attempt back (POST /screenshot-block/events);
//  - turns off Snipping Tool, Game Bar capture and Edge's web capture by machine policy while
//    tools are blocked, and puts back whatever was there before when they no longer are;
//  - closes listed tools in every session itself, in case the tray app isn't running;
//  - reports the blocked attempts and its sync status to the server.

const NONE: AssignedScreenshotBlockWire = { policyIds: [], blockKeys: false, blockTools: false, blockClipboardImages: false, tools: [] };
let current: AssignedScreenshotBlockWire = NONE;
const pending: ScreenshotBlockEventPayload[] = [];
const MAX_PENDING = 2000;

// What the tray app enforces right now.
export function currentScreenshotBlockSettings(): AssignedScreenshotBlockWire {
  return isEnforcementSuspended() ? NONE : current;
}

export function queueScreenshotBlockEvents(events: unknown): void {
  if (!Array.isArray(events)) return;
  for (const e of events.slice(0, 500)) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (r.kind !== "KEY" && r.kind !== "TOOL" && r.kind !== "CLIPBOARD") continue;
    if (pending.length >= MAX_PENDING) return;
    pending.push({
      username: String(r.username ?? "").slice(0, 200),
      kind: r.kind,
      detail: String(r.detail ?? "").slice(0, 300),
      occurredAt: typeof r.occurredAt === "string" && !Number.isNaN(Date.parse(r.occurredAt)) ? r.occurredAt : new Date().toISOString(),
    });
  }
}

// ---- Machine policy -------------------------------------------------------------------------

interface PolicyValue {
  key: string;
  name: string;
  value: number;
}

const MACHINE_POLICIES: PolicyValue[] = [
  { key: "HKLM\\SOFTWARE\\Policies\\Microsoft\\TabletPC", name: "DisableSnippingTool", value: 1 },
  { key: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR", name: "AllowGameDVR", value: 0 },
  { key: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge", name: "WebCaptureEnabled", value: 0 },
];

// Values that were there before we changed them (null = not set), so removal puts them back.
const SAVED_FILE = () => path.join(agentConfig.stateDir, "screenshot-block-policies.json");

async function readDword(key: string, name: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", key, "/v", name]);
    const m = stdout.match(/REG_DWORD\s+0x([0-9a-f]+)/i);
    return m ? parseInt(m[1], 16) : null;
  } catch {
    return null; // key or value doesn't exist
  }
}

async function writeDword(key: string, name: string, value: number): Promise<void> {
  await execFileAsync("reg.exe", ["add", key, "/v", name, "/t", "REG_DWORD", "/d", String(value), "/f"]);
}

async function deleteValue(key: string, name: string): Promise<void> {
  await execFileAsync("reg.exe", ["delete", key, "/v", name, "/f"]).catch(() => undefined);
}

async function loadSaved(): Promise<Record<string, number | null> | null> {
  try {
    return JSON.parse(await fs.readFile(SAVED_FILE(), "utf8")) as Record<string, number | null>;
  } catch {
    return null; // not applied
  }
}

async function applyMachinePolicies(on: boolean): Promise<void> {
  const saved = await loadSaved();
  if (on) {
    const before: Record<string, number | null> = saved ?? {};
    for (const p of MACHINE_POLICIES) {
      const id = `${p.key}\\${p.name}`;
      const now = await readDword(p.key, p.name);
      if (!(id in before)) before[id] = now; // first time: remember what was there
      if (now !== p.value) await writeDword(p.key, p.name, p.value);
    }
    if (!saved) {
      await fs.mkdir(agentConfig.stateDir, { recursive: true });
      await fs.writeFile(SAVED_FILE(), JSON.stringify(before), "utf8");
    }
  } else if (saved) {
    for (const p of MACHINE_POLICIES) {
      const prior = saved[`${p.key}\\${p.name}`];
      if (prior === null || prior === undefined) await deleteValue(p.key, p.name);
      else await writeDword(p.key, p.name, prior);
    }
    await fs.rm(SAVED_FILE(), { force: true });
  }
}

// ---- Tools in every session (backstop for a tray app that isn't running) -------------------

async function closeToolsEverywhere(tools: string[]): Promise<void> {
  if (tools.length === 0) return;
  const wanted = new Set(tools.map((t) => t.toLowerCase()));
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], { maxBuffer: 8 * 1024 * 1024 }));
  } catch {
    return;
  }
  for (const line of stdout.split(/\r?\n/)) {
    const cols = line.match(/"([^"]*)"/g)?.map((c) => c.slice(1, -1));
    if (!cols || cols.length < 2 || !wanted.has(cols[0].toLowerCase())) continue;
    const pid = cols[1];
    let user = "";
    try {
      const { stdout: v } = await execFileAsync("tasklist.exe", ["/V", "/FO", "CSV", "/NH", "/FI", `PID eq ${pid}`]);
      const vc = v.match(/"([^"]*)"/g)?.map((c) => c.slice(1, -1));
      user = vc?.[6] ?? "";
    } catch {
      // keep going without the user name
    }
    try {
      await execFileAsync("taskkill.exe", ["/PID", pid, "/F"]);
      const name = user.includes("\\") ? user.slice(user.lastIndexOf("\\") + 1) : user;
      queueScreenshotBlockEvents([{ username: name || "(unknown)", kind: "TOOL", detail: cols[0], occurredAt: new Date().toISOString() }]);
    } catch {
      // exited meanwhile
    }
  }
}

// ---- Sync -----------------------------------------------------------------------------------

export async function runScreenshotBlockSync(client: AxiosInstance): Promise<void> {
  if (process.platform !== "win32") return;
  let status: ScreenshotBlockReport["status"] = "SUCCESS";
  let errorMessage: string | null = null;
  try {
    const { data } = await client.get<AssignedScreenshotBlockWire>("/api/agent/screenshot-block/assigned");
    current = data;
    const settings = currentScreenshotBlockSettings();
    await applyMachinePolicies(settings.blockTools);
    if (settings.tools.length > 0) await closeToolsEverywhere(settings.tools);
  } catch (err) {
    status = "FAILED";
    errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    console.error("Screenshot blocking: sync failed", err);
  }

  if (current.policyIds.length === 0 && pending.length === 0) return;
  const events = pending.splice(0, 500);
  const report: ScreenshotBlockReport = { policyIds: current.policyIds, status, errorMessage, events };
  try {
    await client.post("/api/agent/screenshot-block/report", report);
    if (events.length > 0) console.log(`Screenshot blocking: reported ${events.length} blocked attempt(s)`);
  } catch (err) {
    pending.unshift(...events);
    console.error("Screenshot blocking: report failed", err);
  }
}
