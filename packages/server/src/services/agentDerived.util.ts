import { AGENT_OFFLINE_AFTER_MISSED_POLLS, DEFAULT_POLL_INTERVAL_SEC } from "@em/shared";
import type { DeviceType } from "@em/shared";

// Extracted from admin.routes.ts so dashboard.service.ts can reuse the exact same
// derivation logic without a service-importing-from-a-route dependency inversion.

export function computeStatus(lastCheckinAt: Date | null): "ONLINE" | "OFFLINE" {
  if (!lastCheckinAt) return "OFFLINE";
  const thresholdMs = AGENT_OFFLINE_AFTER_MISSED_POLLS * DEFAULT_POLL_INTERVAL_SEC * 1000;
  return Date.now() - lastCheckinAt.getTime() <= thresholdMs ? "ONLINE" : "OFFLINE";
}

// Reduces the raw si.diskLayout() blob (already stored, not re-collected) down to a
// physical-disk summary — total capacity + distinct media types (SSD/HD/...) — cheap
// enough to compute on every list-page poll, unlike sending the raw array itself.
export function summarizeDiskLayout(diskInfoJson: string): { totalDiskBytes: string | null; diskTypes: string[] } {
  let disks: Array<{ size?: number; type?: string }>;
  try {
    disks = JSON.parse(diskInfoJson);
  } catch {
    return { totalDiskBytes: null, diskTypes: [] };
  }
  if (!Array.isArray(disks) || disks.length === 0) return { totalDiskBytes: null, diskTypes: [] };

  const totalBytes = disks.reduce((sum, d) => sum + (d.size ?? 0), 0);
  const diskTypes = [...new Set(disks.map((d) => d.type).filter((t): t is string => Boolean(t)))];

  return { totalDiskBytes: totalBytes > 0 ? String(totalBytes) : null, diskTypes };
}

// osVersion (the raw kernel version string, e.g. "10.0.26200") reads identically for
// Windows 10, 11, and some Server builds — it cannot tell them apart. `distro` (from
// the systeminformation package) is the actual product name (e.g. "Microsoft Windows
// 11 Pro", "Microsoft Windows Server 2022 Standard"), which is what an admin actually
// needs to tell which security benchmark (Windows 10/11/Server) applies to an agent.
export function extractOsEditionLabel(osInfoJson: string | undefined): string | null {
  if (!osInfoJson) return null;
  try {
    const parsed = JSON.parse(osInfoJson) as { distro?: string };
    return parsed.distro ?? null;
  } catch {
    return null;
  }
}

// Capacity ratio (not cycle count) drives the health classification, since full-charge
// capacity is reliably reported across OEMs while cycle count is not — see
// packages/agent/src/inventory.ts's collectBattery(). Computed fresh on every read (not
// persisted) so the 80%/50% thresholds can be tuned later with zero migration/backfill.
export function deriveBatteryHealth(
  designMwh: number | null,
  fullChargeMwh: number | null,
): { healthPercent: number | null; healthStatus: "GOOD" | "DEGRADED" | "REPLACE" | "UNKNOWN" } {
  if (!designMwh || !fullChargeMwh) return { healthPercent: null, healthStatus: "UNKNOWN" };
  const percent = Math.min(100, Math.round((fullChargeMwh / designMwh) * 100));
  if (percent >= 80) return { healthPercent: percent, healthStatus: "GOOD" };
  if (percent >= 50) return { healthPercent: percent, healthStatus: "DEGRADED" };
  return { healthPercent: percent, healthStatus: "REPLACE" };
}

export interface IpGeoHint {
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
}

// A hint only — the admin-entered Agent.location field is authoritative and this never
// overwrites it. Null when no successful geo-IP lookup has landed yet (e.g. a private/
// loopback IP, or the external lookup failing/being rate-limited).
export function buildIpGeoHint(agent: {
  ipGeoCity: string | null;
  ipGeoRegion: string | null;
  ipGeoCountry: string | null;
  ipGeoLat: number | null;
  ipGeoLon: number | null;
}): IpGeoHint | null {
  if (!agent.ipGeoCity && !agent.ipGeoCountry) return null;
  return {
    city: agent.ipGeoCity,
    region: agent.ipGeoRegion,
    country: agent.ipGeoCountry,
    lat: agent.ipGeoLat,
    lon: agent.ipGeoLon,
  };
}

export function buildBatteryView(inv: {
  batteryPresent: boolean;
  batteryDesignCapacityMwh: number | null;
  batteryFullChargeCapacityMwh: number | null;
  batteryChargePercent: number | null;
  batteryCycleCount: number | null;
  batteryCharging: boolean | null;
  batteryAcConnected: boolean | null;
}) {
  return {
    present: inv.batteryPresent,
    designCapacityMwh: inv.batteryDesignCapacityMwh,
    fullChargeCapacityMwh: inv.batteryFullChargeCapacityMwh,
    chargePercent: inv.batteryChargePercent,
    cycleCount: inv.batteryCycleCount,
    acConnected: inv.batteryAcConnected,
    charging: inv.batteryCharging,
    ...deriveBatteryHealth(inv.batteryDesignCapacityMwh, inv.batteryFullChargeCapacityMwh),
  };
}

// OS label wins first — it's the most reliable signal already collected (a machine
// running a Server OS is a server regardless of what PCSystemType reports, since some
// real server hardware misreports that code). Win32_ComputerSystem.PCSystemType codes:
// 1=Desktop, 2=Mobile/Laptop, 3=Workstation, 4=Enterprise Server, 5=SOHO Server,
// 6=Appliance PC, 7=Performance Server, 8=Slate — only 2 (Laptop) and 4/5/7 (Server)
// are unambiguous; everything else falls back to Desktop.
export function deriveDeviceType(pcSystemType: number | null, osEditionLabel: string | null): DeviceType {
  if (osEditionLabel?.toLowerCase().includes("server")) return "SERVER";
  if (pcSystemType === 2) return "LAPTOP";
  if (pcSystemType === 4 || pcSystemType === 5 || pcSystemType === 7) return "SERVER";
  return "DESKTOP";
}
