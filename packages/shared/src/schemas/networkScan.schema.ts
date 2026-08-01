import { z } from "zod";

export const startNetworkScanRequestSchema = z.object({
  cidr: z.string().min(1).max(50).optional(), // e.g. "192.168.1.0/24"; omitted => server auto-detects
  vlanId: z.string().min(1).optional(), // when present, cidr is ignored — sourced from the VLAN instead
});
export type StartNetworkScanRequest = z.infer<typeof startNetworkScanRequestSchema>;

export const discoveredHostResultSchema = z.object({
  ipAddress: z.string(),
  macAddress: z.string().nullable(),
  hostname: z.string().nullable(),
  openPorts: z.array(z.number().int()),
  responseTimeMs: z.number().int().nullable(),
});
export type DiscoveredHostResult = z.infer<typeof discoveredHostResultSchema>;

export const networkScanTaskResultPayloadSchema = z.object({
  status: z.enum(["SUCCESS", "FAILED"]),
  hostsScanned: z.number().int().nonnegative(),
  hosts: z.array(discoveredHostResultSchema),
  errorMessage: z.string().nullable(),
  completedAt: z.string(),
});
export type NetworkScanTaskResultPayload = z.infer<typeof networkScanTaskResultPayloadSchema>;
