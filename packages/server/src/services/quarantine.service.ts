import { DEFAULT_COMMAND_TIMEOUT_SEC } from "@em/shared";
import { config } from "../config";
import { prisma } from "../db";
import { createCommandJob } from "./command.service";

const DNS_RULE_NAME = "EM-Quarantine-DNS";
const SERVER_RULE_NAME = "EM-Quarantine-Server";

// Windows Firewall evaluates an explicit block rule over an explicit allow rule
// regardless of specificity or order, so "block everything, then allow two things"
// (the naive approach) would still block the two things. The only way to get a
// real default-deny-with-exceptions is to set the profile's default action to
// block and rely on allow rules for the exceptions — same model NAC's own
// local_enforcement.py used. The server-port allow rule is scoped by remote port
// only (not a specific IP), since the agent may reach this server via any LAN
// address; that's enough to keep check-ins (and a future Release command) alive
// while everything else is cut off.
function buildQuarantineScript(): string {
  return [
    `netsh advfirewall firewall delete rule name="${DNS_RULE_NAME}" | Out-Null`,
    `netsh advfirewall firewall delete rule name="${SERVER_RULE_NAME}" | Out-Null`,
    `netsh advfirewall firewall add rule name="${DNS_RULE_NAME}" dir=out action=allow protocol=UDP remoteport=53 | Out-Null`,
    `netsh advfirewall firewall add rule name="${SERVER_RULE_NAME}" dir=out action=allow protocol=TCP remoteport=${config.port} | Out-Null`,
    `netsh advfirewall set allprofiles firewallpolicy blockinbound,blockoutbound`,
    `Write-Output "QUARANTINED"`,
  ].join("\n");
}

function buildReleaseScript(): string {
  return [
    `netsh advfirewall set allprofiles firewallpolicy blockinbound,allowoutbound`,
    `netsh advfirewall firewall delete rule name="${DNS_RULE_NAME}" | Out-Null`,
    `netsh advfirewall firewall delete rule name="${SERVER_RULE_NAME}" | Out-Null`,
    `Write-Output "RELEASED"`,
  ].join("\n");
}

// Bulk-capable — the script itself is agent-independent (no per-agent parameterization),
// so the whole target list shares one CommandJob. The single-endpoint route
// (admin.routes.ts's POST /agents/:id/quarantine, used by AgentsPage.tsx's per-row button)
// just calls this with a 1-element array — same behavior, same contract, unchanged.
export async function quarantineAgents(agentIds: string[], createdByAdminId: string) {
  const existing = await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true } });
  if (existing.length === 0) return null;
  const validIds = existing.map((a) => a.id);

  const { jobId } = await createCommandJob({
    agentIds: validIds,
    groupIds: [],
    shell: "powershell",
    script: buildQuarantineScript(),
    timeoutSec: DEFAULT_COMMAND_TIMEOUT_SEC,
    createdByAdminId,
  });
  await prisma.agent.updateMany({ where: { id: { in: validIds } }, data: { quarantined: true } });
  return { jobId };
}

export async function releaseAgents(agentIds: string[], createdByAdminId: string) {
  const existing = await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true } });
  if (existing.length === 0) return null;
  const validIds = existing.map((a) => a.id);

  const { jobId } = await createCommandJob({
    agentIds: validIds,
    groupIds: [],
    shell: "powershell",
    script: buildReleaseScript(),
    timeoutSec: DEFAULT_COMMAND_TIMEOUT_SEC,
    createdByAdminId,
  });
  await prisma.agent.updateMany({ where: { id: { in: validIds } }, data: { quarantined: false } });
  return { jobId };
}
