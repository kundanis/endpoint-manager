import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AiComponentReportItem, AiGuardAgentAssignment } from "@em/shared";
import { agentConfig } from "./config";

// AI Guard phase 3 on Windows:
//  - finds the browser extensions (Chrome, Edge), code-editor extensions (VS Code, Cursor,
//    Windsurf, VSCodium) and npm command-line tools of every user on this PC and reports them; the
//    server keeps the AI ones (names and ids only - nothing inside them is read);
//  - applies what the server blocks: AI browser extensions through each browser's extension
//    blocklist policy, AI VS Code extensions through VS Code's AllowedExtensions policy;
//  - keeps the clipboard settings for the tray app's check on AI desktop apps (localApi.ts).
// Only entries this agent added are ever removed: the lists can hold the organisation's own.

const execFileAsync = promisify(execFile);
const SYNC_MS = 5 * 60 * 1000;
// Looking for add-ons is cheap (folder listings): every 15 minutes, reported when something changed
// and at least every 6 hours, or at once when an admin selects Scan now.
const SCAN_MS = 15 * 60 * 1000;
const REPORT_ANYWAY_MS = 6 * 60 * 60 * 1000;
const FIRST_SCAN_DELAY_MS = 2 * 60 * 1000;
const MAX_ITEMS = 3000;

const BLOCKLIST_KEYS = {
  chrome: "HKLM\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallBlocklist",
  edge: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallBlocklist",
} as const;
const VSCODE_POLICY_KEY = "HKLM\\SOFTWARE\\Policies\\Microsoft\\VSCode";
const VSCODE_VALUE = "AllowedExtensions";

const OFF_CLIPBOARD: AiGuardAgentAssignment["clipboard"] = { enabled: false, action: "WARN", patterns: [], keywordTypes: [], apps: [] };
let clipboardSettings = OFF_CLIPBOARD;

// What the tray app checks (GET /ai-guard/clipboard on the local API).
export function currentAiClipboardSettings(): AiGuardAgentAssignment["clipboard"] {
  return clipboardSettings;
}

// ---- State: which entries this agent added -------------------------------------------------------

interface OwnState {
  browser: { chrome: string[]; edge: string[] };
  vscode: string[];
  vscodeValueCreated: boolean;
}
const stateFile = () => path.join(agentConfig.stateDir, "ai-guard-blocks.json");

async function readState(): Promise<OwnState> {
  try {
    const s = JSON.parse(await fs.readFile(stateFile(), "utf8")) as OwnState;
    return { browser: { chrome: s.browser?.chrome ?? [], edge: s.browser?.edge ?? [] }, vscode: s.vscode ?? [], vscodeValueCreated: !!s.vscodeValueCreated };
  } catch {
    return { browser: { chrome: [], edge: [] }, vscode: [], vscodeValueCreated: false };
  }
}

async function writeState(s: OwnState) {
  await fs.writeFile(stateFile(), JSON.stringify(s), "utf8");
}

// ---- Browser extension blocklists ------------------------------------------------------------------

async function readListValues(key: string): Promise<{ name: string; data: string }[]> {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", key]);
    return stdout
      .split(/\r?\n/)
      .map((line) => /^\s+(\S+)\s+REG_SZ\s+(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ name: m[1], data: m[2].trim() }));
  } catch {
    return [];
  }
}

async function applyBrowserBlocklist(browser: "chrome" | "edge", wanted: string[], owned: string[]): Promise<string[]> {
  const key = BLOCKLIST_KEYS[browser];
  const values = await readListValues(key);
  const present = new Set(values.map((v) => v.data.toLowerCase()));
  const nowOwned = owned.filter((id) => wanted.includes(id));
  // Remove what we added and no longer want.
  for (const v of values) {
    const id = v.data.toLowerCase();
    if (owned.includes(id) && !wanted.includes(id)) await execFileAsync("reg.exe", ["delete", key, "/v", v.name, "/f"]).catch(() => {});
  }
  // Add what's wanted and not already listed (by us or by the organisation).
  let next = values.reduce((max, v) => Math.max(max, Number(v.name) || 0), 0);
  for (const id of wanted) {
    if (present.has(id)) continue;
    next += 1;
    await execFileAsync("reg.exe", ["add", key, "/v", String(next), "/t", "REG_SZ", "/d", id, "/f"]);
    nowOwned.push(id);
  }
  return [...new Set(nowOwned)];
}

// ---- VS Code AllowedExtensions policy -----------------------------------------------------------

async function readVscodeValue(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", VSCODE_POLICY_KEY, "/v", VSCODE_VALUE]);
    const m = /AllowedExtensions\s+REG_SZ\s+(.*)$/m.exec(stdout);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

async function applyVscode(wanted: string[], state: OwnState): Promise<Pick<OwnState, "vscode" | "vscodeValueCreated">> {
  const raw = await readVscodeValue();
  if (wanted.length === 0 && state.vscode.length === 0) return { vscode: [], vscodeValueCreated: state.vscodeValueCreated };
  let rules: Record<string, unknown> = {};
  if (raw) {
    try {
      rules = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // The organisation's value isn't JSON we understand: leave it alone.
      return { vscode: state.vscode, vscodeValueCreated: state.vscodeValueCreated };
    }
  }
  const created = state.vscodeValueCreated || raw === null;
  if (raw === null) rules = { "*": true };
  for (const id of state.vscode) if (!wanted.includes(id) && rules[id] === false) delete rules[id];
  for (const id of wanted) if (!(id in rules)) rules[id] = false;
  const ours = wanted.filter((id) => rules[id] === false);
  const onlyDefault = Object.keys(rules).length === 1 && rules["*"] === true;
  if (created && onlyDefault) {
    await execFileAsync("reg.exe", ["delete", VSCODE_POLICY_KEY, "/v", VSCODE_VALUE, "/f"]).catch(() => {});
    return { vscode: [], vscodeValueCreated: false };
  }
  await execFileAsync("reg.exe", ["add", VSCODE_POLICY_KEY, "/v", VSCODE_VALUE, "/t", "REG_SZ", "/d", JSON.stringify(rules), "/f"]);
  return { vscode: ours, vscodeValueCreated: created };
}

let handledScanRequest: string | null = null;

async function sync(client: AxiosInstance) {
  const { data } = await client.get<AiGuardAgentAssignment>("/api/agent/ai-guard/assigned");
  clipboardSettings = data.clipboard?.enabled ? data.clipboard : OFF_CLIPBOARD;
  if (data.scanRequest && data.scanRequest !== handledScanRequest) {
    handledScanRequest = data.scanRequest;
    void scanAndReport(client, true).catch((err) => console.error("AI Guard add-on scan failed", err instanceof Error ? err.message : err));
  }

  const state = await readState();
  const want = (b: "chrome" | "edge") => [...new Set(data.blockedBrowserExtensions.filter((e) => e.browser === b).map((e) => e.id.toLowerCase()))];
  const chrome = await applyBrowserBlocklist("chrome", want("chrome"), state.browser.chrome);
  const edge = await applyBrowserBlocklist("edge", want("edge"), state.browser.edge);
  const vs = await applyVscode([...new Set(data.blockedVscodeExtensions.map((x) => x.toLowerCase()))], state);
  await writeState({ browser: { chrome, edge }, ...vs });
}

// ---- Finding add-ons ----------------------------------------------------------------------------------

async function dirs(p: string): Promise<string[]> {
  try {
    return (await fs.readdir(p, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse((await fs.readFile(p, "utf8")).replace(/^﻿/, "")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

// "__MSG_appName__" -> the extension's own text for it (its default locale, else English).
async function localized(dir: string, manifest: Record<string, unknown>, value: string): Promise<string> {
  const m = /^__MSG_(.+)__$/.exec(value);
  if (!m) return value;
  for (const locale of [str(manifest.default_locale), "en", "en_US"].filter(Boolean)) {
    const messages = await readJson(path.join(dir, "_locales", locale, "messages.json"));
    if (!messages) continue;
    const hit = Object.entries(messages).find(([k]) => k.toLowerCase() === m[1].toLowerCase());
    const text = hit && typeof hit[1] === "object" && hit[1] ? str((hit[1] as Record<string, unknown>).message) : "";
    if (text) return text;
  }
  return value;
}

const BROWSER_DATA = [
  { host: "chrome" as const, rel: ["AppData", "Local", "Google", "Chrome", "User Data"] },
  { host: "edge" as const, rel: ["AppData", "Local", "Microsoft", "Edge", "User Data"] },
];
const EDITORS = [
  { host: "vscode" as const, rel: [".vscode", "extensions"] },
  { host: "cursor" as const, rel: [".cursor", "extensions"] },
  { host: "windsurf" as const, rel: [".windsurf", "extensions"] },
  { host: "vscodium" as const, rel: [".vscode-oss", "extensions"] },
];
const SKIP_USERS = new Set(["public", "default", "default user", "all users"]);

export async function findComponents(): Promise<AiComponentReportItem[]> {
  const usersRoot = path.join(process.env.SystemDrive ?? "C:", "\\Users");
  const items: AiComponentReportItem[] = [];
  for (const user of await dirs(usersRoot)) {
    if (SKIP_USERS.has(user.toLowerCase())) continue;
    const home = path.join(usersRoot, user);

    for (const b of BROWSER_DATA) {
      const data = path.join(home, ...b.rel);
      for (const profile of (await dirs(data)).filter((p) => p === "Default" || /^Profile \d+$/.test(p))) {
        const extRoot = path.join(data, profile, "Extensions");
        for (const id of (await dirs(extRoot)).filter((d) => /^[a-p]{32}$/.test(d))) {
          const versions = (await dirs(path.join(extRoot, id))).sort();
          const latest = versions[versions.length - 1];
          if (!latest) continue;
          const dir = path.join(extRoot, id, latest);
          const manifest = await readJson(path.join(dir, "manifest.json"));
          if (!manifest) continue;
          const name = await localized(dir, manifest, str(manifest.name));
          items.push({ kind: "BROWSER_EXTENSION", host: b.host, identifier: id, name, version: str(manifest.version) || null, userName: user });
        }
      }
    }

    for (const e of EDITORS) {
      const extRoot = path.join(home, ...e.rel);
      for (const d of await dirs(extRoot)) {
        const pkg = await readJson(path.join(extRoot, d, "package.json"));
        if (!pkg || !str(pkg.publisher) || !str(pkg.name)) continue;
        const id = `${str(pkg.publisher)}.${str(pkg.name)}`.toLowerCase();
        const display = str(pkg.displayName);
        items.push({ kind: "IDE_EXTENSION", host: e.host, identifier: id, name: display && !display.startsWith("%") ? display : id, version: str(pkg.version) || null, userName: user });
      }
    }

    const npmRoot = path.join(home, "AppData", "Roaming", "npm", "node_modules");
    for (const d of await dirs(npmRoot)) {
      const names = d.startsWith("@") ? (await dirs(path.join(npmRoot, d))).map((n) => `${d}/${n}`) : [d];
      for (const n of names) {
        const pkg = await readJson(path.join(npmRoot, ...n.split("/"), "package.json"));
        if (!pkg) continue;
        items.push({ kind: "CLI_TOOL", host: "npm", identifier: n.toLowerCase(), name: str(pkg.name) || n, version: str(pkg.version) || null, userName: user });
      }
    }
    if (items.length >= MAX_ITEMS) break;
  }
  return items.slice(0, MAX_ITEMS);
}

let lastReported: { fingerprint: string; at: number } | null = null;

async function scanAndReport(client: AxiosInstance, force = false) {
  const items = await findComponents();
  const fingerprint = JSON.stringify(items.map((i) => `${i.kind}|${i.host}|${i.identifier}|${i.version ?? ""}|${i.userName ?? ""}`).sort());
  if (!force && lastReported && lastReported.fingerprint === fingerprint && Date.now() - lastReported.at < REPORT_ANYWAY_MS) return;
  await client.post("/api/agent/ai-guard/components", { items });
  lastReported = { fingerprint, at: Date.now() };
}

export function startAiGuardAgent(client: AxiosInstance): void {
  if (process.platform !== "win32") return;
  const runSync = () => sync(client).catch((err) => console.error("AI Guard sync failed", err instanceof Error ? err.message : err));
  const runScan = () => scanAndReport(client).catch((err) => console.error("AI Guard add-on scan failed", err instanceof Error ? err.message : err));
  void runSync();
  setInterval(runSync, SYNC_MS);
  setTimeout(() => {
    void runScan();
    setInterval(runScan, SCAN_MS);
  }, FIRST_SCAN_DELAY_MS);
}

// The tray's clipboard check caught something (POST /ai-guard/clipboard-events on the local API).
export async function reportClipboardEvent(client: AxiosInstance, body: Record<string, unknown>): Promise<void> {
  await client.post("/api/agent/ai-guard/clipboard-events", body);
}
