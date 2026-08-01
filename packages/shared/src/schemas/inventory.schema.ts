import { z } from "zod";

export const installedSoftwareEntrySchema = z.object({
  name: z.string(),
  version: z.string().nullable(),
  publisher: z.string().nullable(),
  installDate: z.string().nullable(),
});

export const memModuleSchema = z.object({
  sizeBytes: z.string().nullable(), // stringified bigint over the wire
  type: z.string().nullable(),
  clockSpeedMHz: z.number().nullable(),
  manufacturer: z.string().nullable(),
});
export type MemModule = z.infer<typeof memModuleSchema>;

export const diskVolumeSchema = z.object({
  mount: z.string(),
  fsType: z.string().nullable(),
  sizeBytes: z.string().nullable(),
  usedBytes: z.string().nullable(),
  availableBytes: z.string().nullable(),
  usePercent: z.number().nullable(),
});
export type DiskVolume = z.infer<typeof diskVolumeSchema>;

export const inventoryReportSchema = z.object({
  cpuModel: z.string().nullable(),
  cpuCores: z.number().int().nullable(),
  cpuPhysicalCores: z.number().int().nullable(),
  cpuSpeedGhz: z.number().nullable(),
  totalMemBytes: z.string().nullable(), // stringified bigint over the wire
  memLayout: z.array(memModuleSchema),
  osInfo: z.record(z.unknown()),
  osBuild: z.string().nullable(),
  osLicenseStatus: z.string().nullable(),
  osLicenseChannel: z.string().nullable(),
  osPartialProductKey: z.string().nullable(),
  lastLoggedOnUser: z.string().nullable(),
  systemManufacturer: z.string().nullable(),
  systemSerialNumber: z.string().nullable(),
  pcSystemType: z.number().int().nullable(),
  diskInfo: z.array(z.record(z.unknown())),
  diskVolumes: z.array(diskVolumeSchema),
  installedSoftware: z.array(installedSoftwareEntrySchema),
  batteryPresent: z.boolean(),
  batteryDesignCapacityMwh: z.number().int().nullable(),
  batteryFullChargeCapacityMwh: z.number().int().nullable(),
  batteryChargePercent: z.number().int().nullable(),
  batteryCycleCount: z.number().int().nullable(),
  batteryCharging: z.boolean().nullable(),
  batteryAcConnected: z.boolean().nullable(),
});
export type InventoryReport = z.infer<typeof inventoryReportSchema>;
