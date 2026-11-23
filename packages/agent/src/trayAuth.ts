import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { agentConfig } from "./config";
import { ensureSecureDir, psEscape, removeTreeNoFollow, SYSTEM_SID } from "./secureFs";

const execFileAsync = promisify(execFile);

// Who is calling the local API (localApi.ts). Every process on the PC can reach 127.0.0.1, so a
// user name sent by the caller proves nothing - on a shared PC (Remote Desktop host) one user
// could send pause requests or events as another. Instead the agent gives each signed-in user a
// random key in a file only that user (and SYSTEM / administrators) can read:
//   app\.state\tray\<user SID>.token
// The tray app and the launch blocker (both run as the user) read their own and send it in the
// X-Endpoint-IQ-Token header; the agent knows from the key alone which user is calling.
// New keys are made at every agent start, so a copied key stops working after a restart.

export const LOCAL_API_PORT = 47613;
export const TRAY_TOKEN_HEADER = "x-endpoint-iq-token";
export const trayTokenDir = () => path.join(agentConfig.stateDir, "tray");

const REFRESH_MS = 10_000;
// Signed-in users have their registry hive loaded under HKEY_USERS: local and domain accounts
// (S-1-5-21-...) and Microsoft Entra accounts (S-1-12-1-...).
const USER_SID = /^S-1-(5-21|12-1)-\d+-\d+-\d+-\d+$/;

export interface TrayUser {
  sid: string;
  account: string; // DOMAIN\user, or the SID when Windows can't name it
  userName: string; // the user part alone, as Environment.UserName gives it
}

const bySid = new Map<string, { token: string; user: TrayUser }>();
const byToken = new Map<string, TrayUser>();

export function userForToken(token: string | string[] | undefined): TrayUser | null {
  if (typeof token !== "string" || token.length < 32) return null;
  return byToken.get(token) ?? null;
}

async function signedInSids(): Promise<string[]> {
  const { stdout } = await execFileAsync("reg.exe", ["query", "HKU"], { windowsHide: true });
  const sids = stdout
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^HKEY_USERS\\/i, ""))
    .filter((s) => USER_SID.test(s));
  // SYSTEM too: the launch blocker runs as SYSTEM when a service starts a blocked program.
  return [...new Set([...sids, SYSTEM_SID])];
}

async function accountName(sid: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `(New-Object System.Security.Principal.SecurityIdentifier('${psEscape(sid)}')).Translate([System.Security.Principal.NTAccount]).Value`],
      { timeout: 20_000, windowsHide: true },
    );
    return stdout.trim() || sid;
  } catch {
    return sid;
  }
}

async function issue(sid: string): Promise<void> {
  const account = await accountName(sid);
  const token = randomBytes(32).toString("hex");
  const file = path.join(trayTokenDir(), `${sid}.token`);
  fs.rmSync(file, { force: true });
  // The folder is locked to SYSTEM and administrators; only this one user is let in to read.
  fs.writeFileSync(file, token, { flag: "wx", encoding: "ascii" });
  if (sid !== SYSTEM_SID) await execFileAsync("icacls.exe", [file, "/grant", `*${sid}:(R)`, "/Q"], { windowsHide: true });
  const user: TrayUser = { sid, account, userName: account.includes("\\") ? account.slice(account.lastIndexOf("\\") + 1) : account };
  bySid.set(sid, { token, user });
  byToken.set(token, user);
}

function revoke(sid: string): void {
  const entry = bySid.get(sid);
  if (entry) byToken.delete(entry.token);
  bySid.delete(sid);
  fs.rmSync(path.join(trayTokenDir(), `${sid}.token`), { force: true });
}

async function refresh(): Promise<void> {
  const now = new Set(await signedInSids());
  for (const sid of [...bySid.keys()]) if (!now.has(sid)) revoke(sid);
  for (const sid of now) {
    if (bySid.has(sid)) continue;
    try {
      await issue(sid);
    } catch (err) {
      console.warn(`Tray channel: couldn't issue a key for ${sid}`, err);
      revoke(sid);
    }
  }
}

let started = false;
export function startTrayAuth(): void {
  if (started || process.platform !== "win32") return;
  started = true;
  void (async () => {
    try {
      await ensureSecureDir(trayTokenDir(), { resetChildren: true });
      // Keys from an earlier run are dropped; the ones made below replace them.
      for (const f of fs.readdirSync(trayTokenDir())) removeTreeNoFollow(path.join(trayTokenDir(), f));
    } catch (err) {
      console.error("Tray channel: couldn't prepare the key folder", err);
      started = false;
      return;
    }
    let busy = false;
    const run = async () => {
      if (busy) return; // a slow name lookup is still running
      busy = true;
      await refresh().catch((err) => console.warn("Tray channel: refreshing user keys failed", err));
      busy = false;
    };
    await run();
    setInterval(run, REFRESH_MS);
  })();
}
