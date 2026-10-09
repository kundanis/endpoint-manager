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
  // Read fresh from the agent's own package.json on every checkin (see config.ts's
  // readAgentVersion()), not just at enroll — lets Agent.agentVersion self-correct if the
  // on-disk build ever changes without a server-driven self-update having run (e.g. an
  // admin manually re-ran the installer over an existing install). Optional so pre-update
  // agents that don't send it yet still pass validation.
  agentVersion: z.string().min(1).optional(),
});
export type CheckinRequest = z.infer<typeof checkinRequestSchema>;

export const commandTaskWireSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  shell: z.enum(["powershell", "cmd", "bash", "sh"]),
  script: z.string(),
  timeoutSec: z.number().int().positive(),
});
export type CommandTaskWire = z.infer<typeof commandTaskWireSchema>;

export const deploymentTaskWireSchema = z.object({
  id: z.string(),
  packageId: z.string(),
  installerType: z.enum(["EXE", "MSI", "DEB", "RPM", "SH"]),
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

// targetVersion/sha256 describe whatever build was staged on the server at dispatch time -
// the agent downloads and verifies against these, not against "whatever is live now" (which
// could theoretically change between dispatch and download if a newer build gets staged in
// between - an edge case, but this keeps one task's contract self-consistent either way).
export const agentUpdateTaskWireSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  targetVersion: z.string(),
  sha256: z.string(),
});
export type AgentUpdateTaskWire = z.infer<typeof agentUpdateTaskWireSchema>;

export const checkinResponseSchema = z.object({
  pollIntervalSec: z.number().int().positive(),
  commandTasks: z.array(commandTaskWireSchema),
  deploymentTasks: z.array(deploymentTaskWireSchema),
  patchTasks: z.array(patchTaskWireSchema),
  networkScanTasks: z.array(networkScanTaskWireSchema),
  agentUpdateTasks: z.array(agentUpdateTaskWireSchema),
  // An admin's "Scan now" click, delivered on the next poll rather than a new push
  // channel — the agent already checks in every pollIntervalSec. Agent-level, not
  // per-policy: it just means "run your data discovery scan cycle now", which scans
  // everything currently assigned regardless of which policy the request came from.
  runDataDiscoveryScanNow: z.boolean(),
  // Every address this server can be reached on, in the order the agent should try them
  // (LAN first, then the web URL, then the NAT'd public IP) - lets an admin change or add
  // addresses after install without touching endpoints. Absent until an admin has saved
  // connection settings, in which case the agent keeps whatever list it already has.
  serverUrls: z.array(z.string()).optional(),
});
export type CheckinResponse = z.infer<typeof checkinResponseSchema>;
