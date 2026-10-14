import { execFile } from "node:child_process";
import { promisify } from "node:util";
import si from "systeminformation";
import type { DiskVolume, InstalledSoftwareEntry, InventoryReport, MemModule } from "@em/shared";

const execFileAsync = promisify(execFile);

// One entry of `system_profiler SPApplicationsDataType -json` (the fields used here).
interface SystemProfilerApp {
  _name?: string;
  version?: string;
  path?: string;
  lastModified?: string;
  obtained_from?: string; // "apple" | "mac_app_store" | "identified_developer" | "unknown"
  signed_by?: string[];
}

// Only real, user-visible applications: /Applications (incl. sub-folders like
// /Applications/Utilities), Apple's own /System/Applications, and per-user ~/Applications.
// system_profiler also lists hundreds of helper .apps buried inside frameworks and other
// apps' bundles, which would bury the list and the vulnerability matcher in noise.
function isUserVisibleApp(path: string): boolean {
  return (
    path.startsWith("/Applications/") ||
    path.startsWith("/System/Applications/") ||
    /^\/Users\/[^/]+\/Applications\//.test(path)
  ) && !path.slice(1).split("/").slice(1, -1).some((segment) => segment.endsWith(".app"));
}

// "Developer ID Application: Google LLC (EQHXZ8M8AV)" -> "Google LLC"; Apple-shipped apps
// are signed by Apple's own chain and carry obtained_from "apple".
function publisherOf(app: SystemProfilerApp): string | null {
  if (app.obtained_from === "apple") return "Apple Inc.";
  const leaf = app.signed_by?.[0];
  const match = leaf ? /^(?:Developer ID Application|Apple Mac OS Application Signing|Apple Development):\s*(.+?)(?:\s*\([A-Z0-9]{10}\))?$/.exec(leaf) : null;
  if (match) return match[1];
  if (app.obtained_from === "mac_app_store") return "Mac App Store";
  return null;
}

// Pure, exported for tests: parses system_profiler's JSON into the agent's software list,
// de-duplicated by name+version (the same app can be listed from several locations).
export function parseSystemProfilerApps(json: string): InstalledSoftwareEntry[] {
  let apps: SystemProfilerApp[] = [];
  try {
    apps = (JSON.parse(json) as { SPApplicationsDataType?: SystemProfilerApp[] }).SPApplicationsDataType ?? [];
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const result: InstalledSoftwareEntry[] = [];
  for (const app of apps) {
    if (!app._name || !app.path || !isUserVisibleApp(app.path)) continue;
    const version = app.version?.trim() || null;
    const key = `${app._name}\u0000${version ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      name: app._name,
      version,
      publisher: publisherOf(app),
      installDate: app.lastModified ? app.lastModified.slice(0, 10) : null,
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function collectInstalledSoftware(): Promise<InstalledSoftwareEntry[]> {
  try {
    // Can take tens of seconds on a Mac with many apps (it reads every bundle's signature),
    // hence the generous timeout; runs on the 10-minute inventory cycle, not every check-in.
    // Default detail level: "mini" can omit signed_by, which publisherOf() needs.
    const { stdout } = await execFileAsync("system_profiler", ["SPApplicationsDataType", "-json"], {
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseSystemProfilerApps(stdout);
  } catch (err) {
    console.error("system_profiler failed", err);
    return [];
  }
}

// Whoever owns the console (the logged-in GUI user). At the login window it's "root" -
// that's "nobody signed in", not a user.
async function collectLastLoggedOnUser(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("stat", ["-f", "%Su", "/dev/console"]);
    const user = stdout.trim();
    return user && user !== "root" && user !== "_mbsetupuser" ? user : null;
  } catch {
    return null;
  }
}

export async function collectInventory(): Promise<InventoryReport> {
  const [cpu, mem, memLayout, osInfo, diskLayout, fsSize, system, battery, installedSoftware, lastLoggedOnUser] =
    await Promise.all([
      si.cpu(),
      si.mem(),
      si.memLayout(),
      si.osInfo(),
      si.diskLayout(),
      si.fsSize(),
      si.system(),
      si.battery(),
      collectInstalledSoftware(),
      collectLastLoggedOnUser(),
    ]);

  const memModules: MemModule[] = memLayout.map((m) => ({
    sizeBytes: m.size ? String(m.size) : null,
    type: m.type || null,
    clockSpeedMHz: m.clockSpeed ?? null,
    manufacturer: m.manufacturer || null,
  }));

  // APFS shows the same container through several synthetic mounts (/System/Volumes/VM,
  // Preboot, Update, ...); only the volumes a person would recognise are reported.
  const diskVolumes: DiskVolume[] = fsSize
    .filter((v) => v.mount === "/" || v.mount === "/System/Volumes/Data" || v.mount.startsWith("/Volumes/"))
    .map((v) => ({
      mount: v.mount,
      fsType: v.type || null,
      sizeBytes: v.size ? String(v.size) : null,
      usedBytes: v.used ? String(v.used) : null,
      availableBytes: v.available ? String(v.available) : null,
      usePercent: v.use ?? null,
    }));

  // The OS label the console shows and groups by (agentDerived.util.ts's extractOsEditionLabel
  // reads osInfo.distro): "macOS Sonoma" rather than a bare "macOS".
  const distro = osInfo.codename ? `macOS ${osInfo.codename}` : "macOS";

  return {
    cpuModel: cpu.brand || cpu.manufacturer || null,
    cpuCores: cpu.cores ?? null,
    cpuPhysicalCores: cpu.physicalCores ?? null,
    cpuSpeedGhz: cpu.speed ? Number(cpu.speed) : null,
    totalMemBytes: mem.total ? String(mem.total) : null,
    memLayout: memModules,
    osInfo: { ...osInfo, distro } as unknown as Record<string, unknown>,
    osBuild: osInfo.build || osInfo.release || null,
    // No Windows-activation equivalent on macOS.
    osLicenseStatus: null,
    osLicenseChannel: null,
    osPartialProductKey: null,
    lastLoggedOnUser,
    systemManufacturer: system.manufacturer || "Apple Inc.",
    systemSerialNumber: system.serial && system.serial !== "0" ? system.serial : null,
    // No PCSystemType on macOS - device type is inferred from batteryPresent (laptop vs desktop).
    pcSystemType: null,
    diskInfo: diskLayout as unknown as Record<string, unknown>[],
    diskVolumes,
    installedSoftware,
    batteryPresent: battery.hasBattery,
    batteryDesignCapacityMwh: battery.hasBattery && battery.designedCapacity > 0 ? battery.designedCapacity : null,
    batteryFullChargeCapacityMwh: battery.hasBattery && battery.maxCapacity > 0 ? battery.maxCapacity : null,
    batteryChargePercent: battery.hasBattery ? battery.percent : null,
    batteryCycleCount: battery.hasBattery && battery.cycleCount > 0 ? battery.cycleCount : null,
    batteryCharging: battery.hasBattery ? battery.isCharging : null,
    batteryAcConnected: battery.hasBattery ? battery.acConnected : null,
  };
}
