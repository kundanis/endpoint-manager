import { z } from "zod";

export const startNetworkScanRequestSchema = z.object({
  cidr: z.string().min(1).max(50).optional(), // e.g. "192.168.1.0/24"; omitted => server auto-detects
  vlanId: z.string().min(1).optional(), // when present, cidr is ignored — sourced from the VLAN instead
});
export type StartNetworkScanRequest = z.infer<typeof startNetworkScanRequestSchema>;

// Scan results come from an agent, so a compromised one could push anything here - and these
// values are shown in the console and passed on (e.g. a hostname as a remote install target).
// Every field is bounded and charset-checked. A bad optional field is dropped to null and a
// host with a bad address is dropped, rather than failing the whole scan result.
const SCAN_HOSTNAME_RE = /^[A-Za-z0-9_](?:[A-Za-z0-9._-]{0,252})$/;
const SCAN_MAC_RE = /^[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}$/;
const SCAN_IP_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9A-Fa-f:.]{2,45})$/;
const MAX_SCAN_HOSTS = 65_536;
const MAX_SCAN_ERROR_CHARS = 2_000;

export const discoveredHostResultSchema = z.object({
  ipAddress: z.string().max(45).regex(SCAN_IP_RE),
  macAddress: z.string().regex(SCAN_MAC_RE).nullable().catch(null),
  hostname: z.string().max(253).regex(SCAN_HOSTNAME_RE).nullable().catch(null),
  openPorts: z.array(z.number().int().min(0).max(65535)).max(65536).catch([]),
  responseTimeMs: z.number().int().nonnegative().nullable().catch(null),
});
export type DiscoveredHostResult = z.infer<typeof discoveredHostResultSchema>;

export const networkScanTaskResultPayloadSchema = z.object({
  status: z.enum(["SUCCESS", "FAILED"]),
  hostsScanned: z.number().int().nonnegative(),
  hosts: z
    .array(z.unknown())
    .max(MAX_SCAN_HOSTS)
    .transform((hosts) =>
      hosts.flatMap((h) => {
        const parsed = discoveredHostResultSchema.safeParse(h);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  errorMessage: z
    .string()
    .nullable()
    .transform((s) => (s === null ? null : s.slice(0, MAX_SCAN_ERROR_CHARS))),
  completedAt: z.string().max(64),
});
export type NetworkScanTaskResultPayload = z.infer<typeof networkScanTaskResultPayloadSchema>;
