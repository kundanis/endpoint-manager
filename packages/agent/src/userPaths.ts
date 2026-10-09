import fs from "node:fs/promises";
import path from "node:path";

// The agent runs as SYSTEM, so its own %USERPROFILE%/%APPDATA%/... point at
// C:\Windows\System32\config\systemprofile — not at any real user. A policy path written
// against those variables means "this folder for every user on the machine", so it's
// expanded once per real user profile instead of from the agent's own environment.

const USER_SCOPED_VARS = new Set(["USERPROFILE", "APPDATA", "LOCALAPPDATA", "ONEDRIVE", "ONEDRIVECOMMERCIAL", "ONEDRIVECONSUMER"]);

// Known folders OneDrive "folder backup" commonly redirects into the OneDrive root, so
// %USERPROFILE%\Documents may really live at %USERPROFILE%\OneDrive - <Org>\Documents.
const ONEDRIVE_REDIRECTABLE = new Set(["desktop", "documents", "pictures"]);

const NON_USER_PROFILE_DIRS = new Set(["default", "default user", "public", "all users"]);

interface UserProfile {
  root: string;
  oneDriveRoots: string[];
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// Real interactive user profiles: folders under %SystemDrive%\Users holding an NTUSER.DAT
// hive (service/system profiles live elsewhere; Default/Public are templates, not users).
export async function listUserProfiles(): Promise<UserProfile[]> {
  const usersDir = path.join(process.env.SystemDrive ?? "C:", "\\Users");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(usersDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const profiles: UserProfile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || NON_USER_PROFILE_DIRS.has(entry.name.toLowerCase())) continue;
    const root = path.join(usersDir, entry.name);
    try {
      await fs.access(path.join(root, "NTUSER.DAT"));
    } catch {
      continue;
    }
    let children: import("node:fs").Dirent[] = [];
    try {
      children = await fs.readdir(root, { withFileTypes: true });
    } catch {
      // keep the profile; just no OneDrive roots discoverable
    }
    const oneDriveRoots = children
      .filter((c) => c.isDirectory() && /^OneDrive(\b| - )/i.test(c.name))
      .map((c) => path.join(root, c.name));
    profiles.push({ root, oneDriveRoots });
  }
  return profiles;
}

function userVarValues(name: string, profile: UserProfile): string[] {
  switch (name) {
    case "USERPROFILE":
      return [profile.root];
    case "APPDATA":
      return [path.join(profile.root, "AppData", "Roaming")];
    case "LOCALAPPDATA":
      return [path.join(profile.root, "AppData", "Local")];
    default: // ONEDRIVE / ONEDRIVECOMMERCIAL / ONEDRIVECONSUMER
      return profile.oneDriveRoots;
  }
}

function expandMachineVars(p: string): string {
  return p.replace(/%([^%]+)%/g, (match, name: string) => process.env[name] ?? match);
}

// Resolves one policy target path to the concrete, existing folders to scan — possibly
// several (one per user, plus OneDrive-redirected copies), possibly none. Paths without
// any user-scoped variable just get machine-level env expansion, as before.
export async function resolveTargetPath(rawPath: string, profiles: UserProfile[]): Promise<string[]> {
  const userVar = [...rawPath.matchAll(/%([^%]+)%/g)].map((m) => m[1]).find((v) => USER_SCOPED_VARS.has(v.toUpperCase()));
  if (!userVar) {
    const expanded = expandMachineVars(rawPath);
    return (await isDirectory(expanded)) ? [expanded] : [];
  }

  const candidates: string[] = [];
  const token = new RegExp(`%${userVar}%`, "gi");
  for (const profile of profiles) {
    for (const value of userVarValues(userVar.toUpperCase(), profile)) {
      const concrete = expandMachineVars(rawPath.replace(token, value));
      candidates.push(concrete);

      // %USERPROFILE%\Documents (or Desktop/Pictures) → also each OneDrive root's copy.
      if (userVar.toUpperCase() === "USERPROFILE") {
        const rest = path.relative(profile.root, concrete);
        const first = rest.split(path.sep)[0]?.toLowerCase();
        if (first && ONEDRIVE_REDIRECTABLE.has(first)) {
          for (const od of profile.oneDriveRoots) candidates.push(path.join(od, rest));
        }
      }
    }
  }

  const unique = [...new Set(candidates.map((c) => path.normalize(c)))];
  const existing: string[] = [];
  for (const c of unique) if (await isDirectory(c)) existing.push(c);
  return existing;
}
