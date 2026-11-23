import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { agentConfig } from "./config";

const execFileAsync = promisify(execFile);

// Folders the agent (SYSTEM) writes to or runs things from must never be writable by ordinary
// users: a user who can drop a file, a junction or a symbolic link there can make SYSTEM run,
// overwrite or delete something of their choosing. Everything here keeps to that.

// Text for a PowerShell single-quoted string. PowerShell also ends such a string at the Unicode
// single quotes (U+2018-U+201B), so those are doubled too - a server-supplied value can never
// break out of the quotes whichever quote character it uses.
export function psEscape(value: string): string {
  return value.replace(/['\u2018\u2019\u201A\u201B]/g, (q) => q + q);
}

export const SYSTEM_SID = "S-1-5-18";
export const ADMINISTRATORS_SID = "S-1-5-32-544";
export const USERS_SID = "S-1-5-32-545";

// C:\ProgramData\EndpointPro and the install folder inside it (install.ps1 / NativeInstaller.cs).
export const ENDPOINTPRO_DIR = path.join(process.env.ProgramData ?? "C:\\ProgramData", "EndpointPro");
export const AGENT_INSTALL_DIR = path.join(ENDPOINTPRO_DIR, "Agent");

// The folder this agent actually runs from: app\dist\..\.. (a sibling of node\).
export function installDir(): string {
  return path.join(__dirname, "..", "..");
}

// Only a packaged install (running from app\dist with node\node.exe beside it) has its folder
// permissions managed; `npm run dev` must never lock a developer out of their own checkout.
export function isPackagedInstall(): boolean {
  return process.platform === "win32" && path.basename(__dirname) === "dist" && fs.existsSync(path.join(installDir(), "node", "node.exe"));
}

// Helper scripts and task definitions SYSTEM runs (self-update, service setup, watchdog
// repair): inside the locked state folder, never %TEMP% (C:\Windows\Temp, which users can write).
export const secureWorkDir = () => path.join(agentConfig.stateDir, "work");
export const logDir = () => process.env.UEM_LOG_DIR ?? path.join(__dirname, "..", "logs");

// Folder permissions: SYSTEM and Administrators full control, inheritance from the parent cut
// (so ProgramData's "users may create folders" doesn't reach in). usersRead adds read & execute
// for ordinary users, for what their own sessions must run (the launch blocker script).
const SDDL_PRIVATE = "D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";
const SDDL_USERS_READ = "D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)";

export interface SecureDirOptions {
  usersRead?: boolean;
  // Everything already inside also gets its owner set to SYSTEM and its own permissions
  // dropped in favour of the folder's (anything a user put there before is no longer theirs).
  // Not for ProgramData\EndpointPro itself, whose Agent folder has its own, stricter lock.
  resetChildren?: boolean;
}

// Deletes a folder tree without ever following a junction or symbolic link inside it: links are
// unlinked, so nothing outside the tree can be reached through one.
export function removeTreeNoFollow(target: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(target);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) {
    try {
      fs.unlinkSync(target);
    } catch {
      fs.rmdirSync(target);
    }
  } else if (st.isDirectory()) {
    for (const name of fs.readdirSync(target)) removeTreeNoFollow(path.join(target, name));
    fs.rmdirSync(target);
  } else {
    fs.unlinkSync(target);
  }
}

// A junction or symbolic link where one of our folders should be: lstat reports both as a
// symbolic link on Windows. The link itself is removed (unlink / rmdir never follow it to its
// target) and a real folder is made in its place.
function replaceIfLink(dir: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return; // not there yet
  }
  if (st.isSymbolicLink()) {
    console.warn(`Removing a link found in place of the agent folder ${dir}`);
    try {
      fs.unlinkSync(dir);
    } catch {
      fs.rmdirSync(dir);
    }
  } else if (!st.isDirectory()) {
    console.warn(`Removing a file found in place of the agent folder ${dir}`);
    fs.rmSync(dir, { force: true });
  }
}

// The folders from the first one that belongs to the agent (ProgramData\EndpointPro or the
// install folder) down to dir; only those are ever replaced. Outside both, only dir itself.
function managedChain(dir: string): string[] {
  const full = path.resolve(dir);
  const lower = full.toLowerCase();
  for (const root of [ENDPOINTPRO_DIR, installDir()].map((r) => path.resolve(r))) {
    const rl = root.toLowerCase();
    if (lower === rl || lower.startsWith(rl + path.sep)) {
      const chain = [root];
      let cur = root;
      for (const part of path.relative(root, full).split(path.sep).filter(Boolean)) {
        cur = path.join(cur, part);
        chain.push(cur);
      }
      return chain;
    }
  }
  return [full];
}

// Makes the folder chain exist as real folders (no links anywhere along it). Synchronous and
// cheap, so it can run before every use of a folder.
export function ensureRealDirSync(dir: string): void {
  for (const d of managedChain(dir)) {
    replaceIfLink(d);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function buildAclScript(dir: string, opts: SecureDirOptions): string {
  const sddl = opts.usersRead ? SDDL_USERS_READ : SDDL_PRIVATE;
  return `
$ErrorActionPreference = 'Stop'
$p = '${psEscape(dir)}'
& icacls.exe $p /setowner '*${SYSTEM_SID}' ${opts.resetChildren ? "/T " : ""}/C /Q | Out-Null
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetSecurityDescriptorSddlForm('${sddl}', [System.Security.AccessControl.AccessControlSections]::Access)
[System.IO.Directory]::SetAccessControl($p, $acl)
${opts.resetChildren ? `if (@(Get-ChildItem -LiteralPath $p -Force).Count -gt 0) { & icacls.exe (Join-Path $p '*') /reset /T /C /Q | Out-Null }` : ""}
Write-Output 'LOCKED'
`;
}

const locked = new Map<string, Promise<void>>();

// Makes dir a real folder that only SYSTEM and administrators can change (see SecureDirOptions).
// The permissions are applied once per agent run (they are what every start repairs on an
// existing install); the link check runs on every call.
export async function ensureSecureDir(dir: string, opts: SecureDirOptions = {}): Promise<void> {
  ensureRealDirSync(dir);
  if (!isPackagedInstall()) return;
  const key = path.resolve(dir).toLowerCase();
  let pending = locked.get(key);
  if (!pending) {
    pending = execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", buildAclScript(dir, opts)], {
      timeout: 120_000,
      windowsHide: true,
    }).then(({ stdout }) => {
      if (!stdout.includes("LOCKED")) throw new Error(`Couldn't set the permissions of ${dir}`);
    });
    locked.set(key, pending);
    pending.catch(() => locked.delete(key)); // tried again next time
  }
  await pending;
}

// Writes a file SYSTEM will run or hand to another tool, under a fresh random name in the
// locked work folder; the file must not exist already ('wx'), so nothing planted is reused.
export async function writeWorkFile(prefix: string, ext: string, data: string | Buffer, encoding?: BufferEncoding): Promise<string> {
  const dir = secureWorkDir();
  await ensureSecureDir(dir, { resetChildren: true });
  const file = path.join(dir, `${prefix}_${randomBytes(12).toString("hex")}${ext}`);
  fs.writeFileSync(file, data, { flag: "wx", encoding });
  return file;
}

// Run once at every start of a packaged agent, before anything else writes files: repairs the
// permissions of the folders the agent uses, including those an older version left open to
// users, and removes the old user-writable Application control folder.
let prepared: Promise<void> | null = null;
export function prepareAgentFolders(): Promise<void> {
  if (!prepared) {
    prepared = (async () => {
      if (!isPackagedInstall()) return;
      // The parent of the install folder: a user could create it (or a link) before the
      // agent was installed, since ProgramData lets users create folders.
      await ensureSecureDir(ENDPOINTPRO_DIR, { usersRead: true });
      // Earlier agents kept the launch blocker in ProgramData\EndpointPro\AppControl with
      // an events folder every user could write to. Removed (links inside are unlinked, never
      // followed); the blocker now lives in the locked install folder.
      const legacy = path.join(ENDPOINTPRO_DIR, "AppControl");
      try {
        removeTreeNoFollow(legacy);
      } catch (err) {
        console.warn("Couldn't remove the old Application control folder", err);
      }
      await ensureSecureDir(agentConfig.stateDir, { resetChildren: true });
      await ensureSecureDir(logDir(), { resetChildren: true });
      await ensureSecureDir(secureWorkDir(), { resetChildren: true });
      // Leftovers of a helper that never ran (the work folder only ever holds those).
      for (const f of fs.readdirSync(secureWorkDir())) {
        try {
          const full = path.join(secureWorkDir(), f);
          if (Date.now() - fs.lstatSync(full).mtimeMs > 24 * 60 * 60_000) removeTreeNoFollow(full);
        } catch {
          // in use
        }
      }
    })().catch((err) => {
      console.error("Couldn't repair the agent folders' permissions", err);
    });
  }
  return prepared;
}
