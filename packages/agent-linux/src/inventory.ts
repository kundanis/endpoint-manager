import { execFile } from "node:child_process";
import { promisify } from "node:util";
import si from "systeminformation";
import type { DiskVolume, InstalledSoftwareEntry, InventoryReport, MemModule } from "@em/shared";

const execFileAsync = promisify(execFile);

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

// dpkg/rpm are the two package-manager families this agent understands (Core + Patch
// Management scope — see the Linux-agent scoping decision). A distro using neither (e.g.
// Alpine's apk) simply reports no installed software / no missing patches rather than
// erroring — same "degrade to empty, never throw" convention the Windows agent already
// uses for every optional inventory facet.
async function collectInstalledSoftwareDeb(): Promise<InstalledSoftwareEntry[]> {
  try {
    // db:Status-Abbrev's first char is 'i' only for a genuinely installed package (not
    // "rc" = removed-but-config-remains, not "un" = unknown) — same filter `dpkg -l`
    // itself applies visually via its "ii" status column.
    const { stdout } = await execFileAsync("dpkg-query", [
      "-W",
      "-f=${db:Status-Abbrev}\t${Package}\t${Version}\t${Maintainer}\n",
    ]);
    return stdout
      .split("\n")
      .filter((line) => line.startsWith("ii\t"))
      .map((line) => {
        const [, name, version, maintainer] = line.split("\t");
        return { name, version: version || null, publisher: maintainer || null, installDate: null };
      });
  } catch (err) {
    console.error("dpkg-query failed", err);
    return [];
  }
}

async function collectInstalledSoftwareRpm(): Promise<InstalledSoftwareEntry[]> {
  try {
    const { stdout } = await execFileAsync("rpm", [
      "-qa",
      "--qf",
      "%{NAME}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\t%{INSTALLTIME:date}\n",
    ]);
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, version, vendor, installDate] = line.split("\t");
        return {
          name,
          version: version || null,
          publisher: vendor && vendor !== "(none)" ? vendor : null,
          installDate: installDate || null,
        };
      });
  } catch (err) {
    console.error("rpm -qa failed", err);
    return [];
  }
}

async function collectInstalledSoftware(): Promise<InstalledSoftwareEntry[]> {
  if (await commandExists("dpkg-query")) return collectInstalledSoftwareDeb();
  if (await commandExists("rpm")) return collectInstalledSoftwareRpm();
  return [];
}

// Best-effort — who's actually sitting at the console right now, if anyone. `who` reports
// nothing on a headless server with no interactive session, which is a normal, expected
// result (null), not a failure.
async function collectLastLoggedOnUser(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("who", []);
    const firstLine = stdout.split("\n").find((l) => l.trim().length > 0);
    return firstLine ? firstLine.trim().split(/\s+/)[0] : null;
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
      // Manufacturer/serial via systeminformation's own DMI reader (root\wmi's Linux
      // equivalent — reads /sys/class/dmi/id/*, falling back to dmidecode if present) —
      // no PowerShell-equivalent hand-rolled WMI query needed here, unlike the Windows agent.
      si.system(),
      // Cross-platform in systeminformation itself (reads /sys/class/power_supply on Linux) —
      // same reason this doesn't need a hand-rolled sysfs reader either.
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

  const diskVolumes: DiskVolume[] = fsSize.map((v) => ({
    mount: v.mount,
    fsType: v.type || null,
    sizeBytes: v.size ? String(v.size) : null,
    usedBytes: v.used ? String(v.used) : null,
    availableBytes: v.available ? String(v.available) : null,
    usePercent: v.use ?? null,
  }));

  return {
    cpuModel: cpu.brand || cpu.manufacturer || null,
    cpuCores: cpu.cores ?? null,
    cpuPhysicalCores: cpu.physicalCores ?? null,
    cpuSpeedGhz: cpu.speed ? Number(cpu.speed) : null,
    totalMemBytes: mem.total ? String(mem.total) : null,
    memLayout: memModules,
    osInfo: osInfo as unknown as Record<string, unknown>,
    osBuild: osInfo.build || osInfo.release || null,
    // No Windows-activation equivalent on Linux — always null, same as every other
    // platform-specific fact this agent can't report (see below).
    osLicenseStatus: null,
    osLicenseChannel: null,
    osPartialProductKey: null,
    lastLoggedOnUser,
    systemManufacturer: system.manufacturer || null,
    systemSerialNumber: system.serial && system.serial !== "0" ? system.serial : null,
    // No WMI PCSystemType equivalent — device-type classification falls back to whatever
    // deriveDeviceType can infer from batteryPresent alone (see agentDerived.util.ts).
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
