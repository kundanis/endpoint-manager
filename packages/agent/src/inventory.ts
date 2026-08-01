import { execFile } from "node:child_process";
import { promisify } from "node:util";
import si from "systeminformation";
import type { DiskVolume, InstalledSoftwareEntry, InventoryReport, MemModule } from "@em/shared";

const execFileAsync = promisify(execFile);

const LICENSE_STATUS_NAMES: Record<number, string> = {
  0: "Unlicensed",
  1: "Licensed",
  2: "OOB Grace",
  3: "OOT Grace",
  4: "Non-Genuine Grace",
  5: "Notification",
  6: "Extended Grace",
};

// Placeholder values OEMs/motherboard vendors leave in BIOS/WMI fields when a real
// serial/manufacturer was never programmed — treated as "not available", not a real fact.
const PLACEHOLDER_FACTS = new Set([
  "system serial number",
  "to be filled by o.e.m.",
  "none",
  "default string",
  "not specified",
  "n/a",
  "invalid",
  "0000000000",
]);

function cleanFact(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_FACTS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

// One combined PowerShell call (rather than 3 separate spawns) for: OS activation status
// (SoftwareLicensingProduct, filtered to the Windows OS licensing ApplicationID so Office/
// other SLP entries aren't picked up), the currently-signed-in-or-last-signed-in user (the
// same LogonUI registry value Windows itself uses to pre-fill the lock-screen username),
// and hardware manufacturer/serial (Win32_ComputerSystem / Win32_BIOS) — a real captured
// fact rather than requiring manual entry.
const SYSTEM_FACTS_PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$license = Get-CimInstance -ClassName SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f'" |
  Select-Object -First 1 LicenseStatus, PartialProductKey, ProductKeyChannel
$lastUser = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Authentication\\LogonUI' -Name LastLoggedOnUser).LastLoggedOnUser
$cs = Get-CimInstance -ClassName Win32_ComputerSystem
$bios = Get-CimInstance -ClassName Win32_BIOS

[PSCustomObject]@{
  LicenseStatus     = $license.LicenseStatus
  LicenseChannel    = $license.ProductKeyChannel
  PartialProductKey = $license.PartialProductKey
  LastLoggedOnUser  = $lastUser
  Manufacturer      = $cs.Manufacturer
  SerialNumber      = $bios.SerialNumber
  PCSystemType      = $cs.PCSystemType
} | ConvertTo-Json -Compress
`;

interface RawSystemFacts {
  LicenseStatus?: number;
  LicenseChannel?: string;
  PartialProductKey?: string;
  LastLoggedOnUser?: string;
  Manufacturer?: string;
  SerialNumber?: string;
  PCSystemType?: number;
}

interface SystemFacts {
  osLicenseStatus: string | null;
  osLicenseChannel: string | null;
  osPartialProductKey: string | null;
  lastLoggedOnUser: string | null;
  systemManufacturer: string | null;
  systemSerialNumber: string | null;
  // Raw Win32_ComputerSystem.PCSystemType code (1=Desktop,2=Mobile/Laptop,3=Workstation,
  // 4=Enterprise Server,5=SOHO Server,6=Appliance PC,7=Performance Server,8=Slate) — the
  // standard WMI signal for device form factor. Classified into Laptop/Desktop/Server on
  // read (see deriveDeviceType in agentDerived.util.ts), not here — this is the raw fact.
  pcSystemType: number | null;
}

async function collectSystemFacts(): Promise<SystemFacts> {
  const empty: SystemFacts = {
    osLicenseStatus: null,
    osLicenseChannel: null,
    osPartialProductKey: null,
    lastLoggedOnUser: null,
    systemManufacturer: null,
    systemSerialNumber: null,
    pcSystemType: null,
  };
  if (process.platform !== "win32") return empty;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SYSTEM_FACTS_PS_SCRIPT],
      { maxBuffer: 1024 * 1024 },
    );

    const trimmed = stdout.trim();
    if (!trimmed) return empty;

    const parsed: RawSystemFacts = JSON.parse(trimmed);
    return {
      osLicenseStatus: parsed.LicenseStatus !== undefined ? LICENSE_STATUS_NAMES[parsed.LicenseStatus] ?? null : null,
      osLicenseChannel: cleanFact(parsed.LicenseChannel),
      osPartialProductKey: cleanFact(parsed.PartialProductKey),
      lastLoggedOnUser: cleanFact(parsed.LastLoggedOnUser)?.replace(/^\.\\/, "") ?? null,
      systemManufacturer: cleanFact(parsed.Manufacturer),
      systemSerialNumber: cleanFact(parsed.SerialNumber),
      pcSystemType: parsed.PCSystemType ?? null,
    };
  } catch (err) {
    console.error("Failed to collect system facts", err);
    return empty;
  }
}

// Deliberately reads the Uninstall registry keys rather than Get-WmiObject Win32_Product,
// which triggers a repair/reconfigure pass on every installed MSI as a side effect of querying it.
const INSTALLED_SOFTWARE_PS_SCRIPT = `
$paths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
Get-ItemProperty -Path $paths -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName } |
  Select-Object DisplayName, DisplayVersion, Publisher, InstallDate |
  ConvertTo-Json -Compress
`;

interface RawUninstallEntry {
  DisplayName?: string;
  DisplayVersion?: string;
  Publisher?: string;
  InstallDate?: string;
}

async function collectInstalledSoftware(): Promise<InstalledSoftwareEntry[]> {
  if (process.platform !== "win32") return [];

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", INSTALLED_SOFTWARE_PS_SCRIPT],
      { maxBuffer: 10 * 1024 * 1024 },
    );

    const trimmed = stdout.trim();
    if (!trimmed) return [];

    const parsed: RawUninstallEntry | RawUninstallEntry[] = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];

    return rows.map((r) => ({
      name: r.DisplayName ?? "Unknown",
      version: r.DisplayVersion ?? null,
      publisher: r.Publisher ?? null,
      installDate: r.InstallDate ?? null,
    }));
  } catch (err) {
    console.error("Failed to collect installed software", err);
    return [];
  }
}

// Win32_Battery no longer reliably exposes DesignCapacity/FullChargeCapacity on modern
// Windows (both blank on this real dev laptop), and root\wmi's BatteryStaticData class
// returned zero instances here too — but `powercfg /batteryreport` reliably surfaces all
// three (DesignCapacity/FullChargeCapacity/CycleCount) together, confirmed against this
// machine's real hardware, so it's the primary source for capacity/cycle facts rather than
// a last-resort fallback. Win32_Battery.EstimatedChargeRemaining and root\wmi's BatteryStatus
// (Charging/PowerOnline) are live/dynamic values a point-in-time report can't give, so those
// still come from CIM directly. root\wmi BatteryStatus is preferred over decoding
// Win32_Battery's own BatteryStatus code — verified on this machine that the WMI code alone
// reads "Unknown" (2) while the device is actually charging on AC.
const BATTERY_PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$battery = Get-CimInstance -ClassName Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus

if ($null -eq $battery) {
  [PSCustomObject]@{ HasBattery = $false } | ConvertTo-Json -Compress
} else {
  $status = Get-CimInstance -Namespace root\\wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue |
    Select-Object -First 1 Charging, PowerOnline

  $charging = $null
  $acConnected = $null
  if ($null -ne $status) {
    $charging = [bool]$status.Charging
    $acConnected = [bool]$status.PowerOnline
  } elseif ($battery.BatteryStatus) {
    $code = [int]$battery.BatteryStatus
    $charging = ($code -ge 6 -and $code -le 9)
    $acConnected = $charging -or ($code -eq 2) -or ($code -eq 3)
  }

  $designCapacity = $null
  $fullChargeCapacity = $null
  $cycleCount = $null
  try {
    $reportPath = Join-Path $env:TEMP "battery-report-$PID.xml"
    powercfg /batteryreport /xml /output $reportPath *> $null
    if (Test-Path $reportPath) {
      [xml]$xmlReport = Get-Content -Raw -Path $reportPath
      $b = $xmlReport.BatteryReport.Batteries.Battery | Select-Object -First 1
      if ($b) {
        if ($b.DesignCapacity) { $designCapacity = [int]$b.DesignCapacity }
        if ($b.FullChargeCapacity) { $fullChargeCapacity = [int]$b.FullChargeCapacity }
        if ($b.CycleCount) { $cycleCount = [int]$b.CycleCount }
      }
      Remove-Item -Force -ErrorAction SilentlyContinue -Path $reportPath
    }
  } catch { }

  [PSCustomObject]@{
    HasBattery         = $true
    DesignCapacity     = $designCapacity
    FullChargeCapacity = $fullChargeCapacity
    ChargePercent      = $battery.EstimatedChargeRemaining
    CycleCount         = $cycleCount
    Charging           = $charging
    AcConnected        = $acConnected
  } | ConvertTo-Json -Compress
}
`;

interface RawBatteryFacts {
  HasBattery?: boolean;
  DesignCapacity?: number;
  FullChargeCapacity?: number;
  ChargePercent?: number;
  CycleCount?: number;
  Charging?: boolean;
  AcConnected?: boolean;
}

interface BatteryFacts {
  batteryPresent: boolean;
  batteryDesignCapacityMwh: number | null;
  batteryFullChargeCapacityMwh: number | null;
  batteryChargePercent: number | null;
  batteryCycleCount: number | null;
  batteryCharging: boolean | null;
  batteryAcConnected: boolean | null;
}

// Guards against a WMI/report read of 0 (or a negative sentinel) rather than a legitimate
// gap being reported as an actual capacity — same defensive spirit as cleanFact() above.
function sanitizeCapacity(v: number | null | undefined): number | null {
  return typeof v === "number" && v > 0 ? v : null;
}

function sanitizeChargePercent(v: number | null | undefined): number | null {
  return typeof v === "number" && v >= 0 && v <= 100 ? v : null;
}

async function collectBattery(): Promise<BatteryFacts> {
  const empty: BatteryFacts = {
    batteryPresent: false,
    batteryDesignCapacityMwh: null,
    batteryFullChargeCapacityMwh: null,
    batteryChargePercent: null,
    batteryCycleCount: null,
    batteryCharging: null,
    batteryAcConnected: null,
  };
  if (process.platform !== "win32") return empty;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", BATTERY_PS_SCRIPT],
      { maxBuffer: 1024 * 1024 },
    );

    const trimmed = stdout.trim();
    if (!trimmed) return empty;

    const parsed: RawBatteryFacts = JSON.parse(trimmed);
    if (!parsed.HasBattery) return empty;

    return {
      batteryPresent: true,
      batteryDesignCapacityMwh: sanitizeCapacity(parsed.DesignCapacity),
      batteryFullChargeCapacityMwh: sanitizeCapacity(parsed.FullChargeCapacity),
      batteryChargePercent: sanitizeChargePercent(parsed.ChargePercent),
      batteryCycleCount: parsed.CycleCount ?? null,
      batteryCharging: parsed.Charging ?? null,
      batteryAcConnected: parsed.AcConnected ?? null,
    };
  } catch (err) {
    console.error("Failed to collect battery facts", err);
    return empty;
  }
}

export async function collectInventory(): Promise<InventoryReport> {
  const [cpu, mem, memLayout, osInfo, diskLayout, fsSize, installedSoftware, systemFacts, battery] =
    await Promise.all([
      si.cpu(),
      si.mem(),
      si.memLayout(),
      si.osInfo(),
      si.diskLayout(),
      si.fsSize(),
      collectInstalledSoftware(),
      collectSystemFacts(),
      collectBattery(),
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
    osBuild: osInfo.build || null,
    osLicenseStatus: systemFacts.osLicenseStatus,
    osLicenseChannel: systemFacts.osLicenseChannel,
    osPartialProductKey: systemFacts.osPartialProductKey,
    lastLoggedOnUser: systemFacts.lastLoggedOnUser,
    systemManufacturer: systemFacts.systemManufacturer,
    systemSerialNumber: systemFacts.systemSerialNumber,
    pcSystemType: systemFacts.pcSystemType,
    diskInfo: diskLayout as unknown as Record<string, unknown>[],
    diskVolumes,
    installedSoftware,
    batteryPresent: battery.batteryPresent,
    batteryDesignCapacityMwh: battery.batteryDesignCapacityMwh,
    batteryFullChargeCapacityMwh: battery.batteryFullChargeCapacityMwh,
    batteryChargePercent: battery.batteryChargePercent,
    batteryCycleCount: battery.batteryCycleCount,
    batteryCharging: battery.batteryCharging,
    batteryAcConnected: battery.batteryAcConnected,
  };
}
