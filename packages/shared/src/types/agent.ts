import type { DiskVolume, MemModule } from "../schemas/inventory.schema";

export type AgentStatus = "ONLINE" | "OFFLINE";

export interface Agent {
  id: string;
  hostname: string;
  osPlatform: string;
  osVersion: string;
  osArch: string;
  agentVersion: string;
  ipAddress: string | null;
  macAddress: string | null;
  tags: string[];
  lastCheckinAt: string | null;
  status: AgentStatus;
  createdAt: string;
}

export interface InstalledSoftwareEntry {
  name: string;
  version: string | null;
  publisher: string | null;
  installDate: string | null;
}

export interface InventorySnapshot {
  agentId: string;
  cpuModel: string | null;
  cpuCores: number | null;
  cpuPhysicalCores: number | null;
  cpuSpeedGhz: number | null;
  totalMemBytes: string | null;
  memLayout: MemModule[];
  osInfo: Record<string, unknown>;
  osBuild: string | null;
  osLicenseStatus: string | null;
  osLicenseChannel: string | null;
  osPartialProductKey: string | null;
  lastLoggedOnUser: string | null;
  diskInfo: Record<string, unknown>[];
  diskVolumes: DiskVolume[];
  installedSoftware: InstalledSoftwareEntry[];
  collectedAt: string;
}
