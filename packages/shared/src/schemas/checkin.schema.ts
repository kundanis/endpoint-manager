import { z } from "zod";

export const checkinRequestSchema = z.object({
  // Self-reported by the agent (its own primary non-internal network interface) —
  // the server's own view of the connecting socket (req.ip) is unusable whenever the
  // agent sits behind NAT/a proxy, or on this same host, so it's only a fallback.
  ipAddress: z.string().min(1).nullable().optional(),
  // From the SAME interface as ipAddress above (Node's os.networkInterfaces() already
  // reports mac per-interface) — no server-side fallback exists for this one, since
  // there's no equivalent to req.ip for a MAC address.
  macAddress: z.string().min(1).nullable().optional(),
});
export type CheckinRequest = z.infer<typeof checkinRequestSchema>;

export const commandTaskWireSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  shell: z.enum(["powershell", "cmd"]),
  script: z.string(),
  timeoutSec: z.number().int().positive(),
});
export type CommandTaskWire = z.infer<typeof commandTaskWireSchema>;

export const deploymentTaskWireSchema = z.object({
  id: z.string(),
  packageId: z.string(),
  installerType: z.enum(["EXE", "MSI"]),
  silentArgs: z.string(),
  sha256: z.string(),
});
export type DeploymentTaskWire = z.infer<typeof deploymentTaskWireSchema>;

export const patchTaskWireSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  updateIds: z.array(z.string()),
});
export type PatchTaskWire = z.infer<typeof patchTaskWireSchema>;

export const networkScanTaskWireSchema = z.object({
  id: z.string(),
  scanRunId: z.string(),
  cidr: z.string(),
});
export type NetworkScanTaskWire = z.infer<typeof networkScanTaskWireSchema>;

export const checkinResponseSchema = z.object({
  pollIntervalSec: z.number().int().positive(),
  commandTasks: z.array(commandTaskWireSchema),
  deploymentTasks: z.array(deploymentTaskWireSchema),
  patchTasks: z.array(patchTaskWireSchema),
  networkScanTasks: z.array(networkScanTaskWireSchema),
  // An admin's "Scan now" click, delivered on the next poll rather than a new push
  // channel — the agent already checks in every pollIntervalSec. Agent-level, not
  // per-policy: it just means "run your data discovery scan cycle now", which scans
  // everything currently assigned regardless of which policy the request came from.
  runDataDiscoveryScanNow: z.boolean(),
});
export type CheckinResponse = z.infer<typeof checkinResponseSchema>;
