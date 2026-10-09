import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The concrete binary this endpoint actually has, not an abstract "family" — resolved once
// by detectPackageManager() and threaded through to both the scanner and the installer, so
// a yum-only box (RHEL/CentOS 7, no dnf present at all) never gets a hardcoded "dnf" install
// command it can't run.
export type PackageManager = "apt" | "dnf" | "yum";

export interface UpgradablePackage {
  packageName: string;
  currentVersion: string | null;
  newVersion: string;
  // apt: the suite/pocket an update came from (e.g. "jammy-security") — used as both a
  // severity heuristic and a display category. dnf/yum: the repo id (e.g. "updates").
  source: string | null;
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

export async function detectPackageManager(): Promise<PackageManager | null> {
  if (await commandExists("apt-get")) return "apt";
  if (await commandExists("dnf")) return "dnf";
  if (await commandExists("yum")) return "yum";
  return null;
}

// Inst <name> [<old>] (<new> <origin> [<arch>]) — apt-get's own simulation-mode output
// format, e.g.: "Inst openssl [3.0.2-0ubuntu1.7] (3.0.2-0ubuntu1.10 Ubuntu:22.04/jammy-security [amd64])"
// Chosen over `apt list --upgradable` specifically because it reports the OLD version too
// in one line, and the origin/suite (used for the security-severity heuristic) is easier to
// isolate than list's bracketed "[upgradable from: ...]" suffix.
const APT_INST_LINE = /^Inst (\S+) \[(\S+)\] \((\S+) ([^)]*)\)/;

async function scanApt(): Promise<UpgradablePackage[]> {
  // Best-effort — a stale local package index still yields whatever apt already knows
  // about, and a network-down endpoint shouldn't turn "no updates found" into a crash.
  await execFileAsync("apt-get", ["update"]).catch(() => {});

  const { stdout } = await execFileAsync("apt-get", ["-s", "-o", "Debug::NoLocking=true", "upgrade"]);
  const results: UpgradablePackage[] = [];
  for (const line of stdout.split("\n")) {
    const match = APT_INST_LINE.exec(line);
    if (!match) continue;
    const [, packageName, currentVersion, newVersion, rest] = match;
    // rest looks like "Ubuntu:22.04/jammy-security [amd64]" — the suite is the part after
    // the colon and before the optional trailing "[arch]".
    const originMatch = /^\S+:\S+\/(\S+)/.exec(rest);
    results.push({ packageName, currentVersion, newVersion, source: originMatch?.[1] ?? null });
  }
  return results;
}

// name.arch  version  repo — dnf/yum check-update's plain output (identical format for
// both), e.g.: "openssl.x86_64  1:3.0.7-27.el9_3  updates"
// check-update exits 100 (not 0) when updates ARE available — a genuinely documented,
// intentional exit code, not an error (see `man dnf`), so it's excluded from execFileAsync's
// normal reject-on-nonzero handling below.
async function scanDnfOrYum(binary: "dnf" | "yum"): Promise<UpgradablePackage[]> {
  let stdout = "";
  try {
    const result = await execFileAsync(binary, ["check-update"]);
    stdout = result.stdout;
  } catch (err) {
    const execErr = err as { code?: number; stdout?: string };
    if (execErr.code === 100 && typeof execErr.stdout === "string") {
      stdout = execErr.stdout;
    } else {
      throw err;
    }
  }

  const results: UpgradablePackage[] = [];
  for (const line of stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || !parts[0].includes(".")) continue;
    const packageName = parts[0].slice(0, parts[0].lastIndexOf("."));
    results.push({ packageName, currentVersion: null, newVersion: parts[1], source: parts[2] });
  }
  return results;
}

// Best-effort cross-reference against the distro's own security-advisory list — absent
// entirely on distros without a security metadata feed configured (e.g. plain CentOS
// Stream), in which case every dnf/yum-sourced update just reports severity null (unknown)
// rather than guessing.
async function securityPackageNames(binary: "dnf" | "yum"): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync(binary, ["updateinfo", "list", "security", "--quiet"]);
    const names = new Set<string>();
    for (const line of stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      // Format: "<advisory-id> <severity> <name.arch>" — package is always the last field.
      const nameArch = parts[parts.length - 1];
      if (nameArch?.includes(".")) names.add(nameArch.slice(0, nameArch.lastIndexOf(".")));
    }
    return names;
  } catch {
    return new Set();
  }
}

export interface ScannedUpdate extends UpgradablePackage {
  severity: string | null;
}

export async function scanForUpgrades(manager: PackageManager): Promise<ScannedUpdate[]> {
  if (manager === "apt") {
    const packages = await scanApt();
    // Debian/Ubuntu's own naming convention marks a security pocket with a "-security"
    // suffix on the suite/codename (e.g. "jammy-security", "bullseye-security").
    return packages.map((p) => ({ ...p, severity: p.source?.includes("-security") ? "HIGH" : null }));
  }

  const [packages, securityNames] = await Promise.all([scanDnfOrYum(manager), securityPackageNames(manager)]);
  return packages.map((p) => ({ ...p, severity: securityNames.has(p.packageName) ? "HIGH" : null }));
}

export function installUpdateCommand(manager: PackageManager, packageNames: string[]): { bin: string; args: string[] } {
  if (manager === "apt") {
    // --only-upgrade: refuse to freshly install a package that merely shares a name with
    // something not currently installed — this command only ever upgrades what's already there.
    return { bin: "apt-get", args: ["install", "--only-upgrade", "-y", ...packageNames] };
  }
  return { bin: manager, args: ["update", "-y", ...packageNames] };
}
