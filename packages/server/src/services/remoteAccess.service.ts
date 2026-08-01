import { DEFAULT_COMMAND_TIMEOUT_SEC } from "@em/shared";
import { prisma } from "../db";
import { createCommandJob } from "./command.service";

const RDP_RULE_NAME = "EM-RemoteAccess-RDP";

export class AgentNotFoundError extends Error {}

// Deliberately scoped to one specific admin IP, not a blanket RDP-open — the built-in
// "Remote Desktop" firewall rule group (whatever its current state) is left untouched
// and this rule alone governs access, relying on Windows Firewall's default-block-inbound
// posture: with no other allow rule present, only traffic from adminIp on port 3389 gets
// through. Re-running enable for a new admin IP simply replaces the prior rule outright.
function buildEnableScript(adminIp: string): string {
  return [
    `Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 0`,
    `netsh advfirewall firewall delete rule name="${RDP_RULE_NAME}" | Out-Null`,
    `netsh advfirewall firewall add rule name="${RDP_RULE_NAME}" dir=in action=allow protocol=TCP localport=3389 remoteip=${adminIp} | Out-Null`,
    `Write-Output "REMOTE_ACCESS_ENABLED"`,
  ].join("\n");
}

function buildDisableScript(): string {
  return [
    `netsh advfirewall firewall delete rule name="${RDP_RULE_NAME}" | Out-Null`,
    `Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 1`,
    `Write-Output "REMOTE_ACCESS_DISABLED"`,
  ].join("\n");
}

// Normalizes a possibly IPv6-mapped IPv4 address (Express's req.ip returns "::ffff:1.2.3.4"
// for IPv4 clients on a dual-stack listener) down to the plain form netsh expects.
export function normalizeAdminIp(rawIp: string): string {
  return rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;
}

export async function enableRemoteAccess(agentId: string, adminIp: string, createdByAdminId: string) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } });
  if (!agent) throw new AgentNotFoundError();

  const { jobId } = await createCommandJob({
    agentIds: [agentId],
    groupIds: [],
    shell: "powershell",
    script: buildEnableScript(adminIp),
    timeoutSec: DEFAULT_COMMAND_TIMEOUT_SEC,
    createdByAdminId,
  });
  await prisma.agent.update({
    where: { id: agentId },
    data: { remoteAccessEnabled: true, remoteAccessEnabledAt: new Date(), remoteAccessAllowedIp: adminIp },
  });
  return { jobId };
}

export async function disableRemoteAccess(agentId: string, createdByAdminId: string) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } });
  if (!agent) throw new AgentNotFoundError();

  const { jobId } = await createCommandJob({
    agentIds: [agentId],
    groupIds: [],
    shell: "powershell",
    script: buildDisableScript(),
    timeoutSec: DEFAULT_COMMAND_TIMEOUT_SEC,
    createdByAdminId,
  });
  await prisma.agent.update({
    where: { id: agentId },
    data: { remoteAccessEnabled: false, remoteAccessEnabledAt: null, remoteAccessAllowedIp: null },
  });
  return { jobId };
}
