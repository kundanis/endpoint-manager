import { prisma } from "../db";
import { quarantineAgents, releaseAgents } from "./quarantine.service";
import { disableRemoteAccess, enableRemoteAccess } from "./remoteAccess.service";

// Pausing does NOT stop the local Windows process, unlike quarantine/remote-access which
// dispatch an enforcement script. This agent only ever reaches the server by polling
// (packages/agent/src/checkinLoop.ts) - there is no inbound channel to it - so a "resume"
// action could never be delivered to a process that had actually been stopped. Instead,
// pause is a purely server-side state: checkin.service.ts stops handing out new
// command/deployment/patch tasks while paused, and every policy-resolution endpoint
// (see isAgentPaused below) comes back empty, releasing enforcement. It does NOT free the
// license seat - see licenseActivation.service.ts's comment - only a real uninstall does
// that, since the endpoint is still under management, just held back.
export class AgentNotFoundError extends Error {}

// Called first thing by every policy-resolution function (web-block, ip-block,
// app-control, usb-control, zero-trust, DLP, data-discovery, data-movement, security
// benchmarks) so a paused agent's next poll of each comes back empty. For the ones that
// wholesale-rewrite local state every cycle (web-block's hosts file/registry, ip-block's
// firewall rules, app-control's SRP entries) this is genuinely self-healing - an empty
// response actively removes what was there, and resuming (simply no longer
// short-circuiting here) lets the real current assignments flow again with no separate
// "restore" step needed, since they were never touched in the database. USB control is
// the one exception: its enforcement is a one-shot Disable-PnpDevice with no scriptable
// undo (see usbControlEnforcer.ts) - gating it here only stops NEW devices from being
// blocked while paused, it cannot un-block ones already disabled.
export async function isAgentPaused(agentId: string): Promise<boolean> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { paused: true } });
  return agent?.paused ?? false;
}

// Quarantine and remote access are dispatched, one-shot CommandJobs, not polled
// assignments - unlike the policy resolvers above, withholding them doesn't undo
// anything already applied. So an active one is explicitly released here, and the
// pre-pause state is snapshotted (Agent.pausedFrom*) so resumeAgent can restore exactly
// what was in effect, rather than a pause/resume cycle silently and permanently
// un-quarantining a machine. The release MUST happen before paused is set to true:
// checkin.service.ts withholds all commandTasks once paused, so a reverse command
// dispatched afterward would sit PENDING forever and never reach the agent.
export async function pauseAgent(agentId: string, createdByAdminId: string): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, quarantined: true, remoteAccessEnabled: true, remoteAccessAllowedIp: true },
  });
  if (!agent) throw new AgentNotFoundError();

  if (agent.quarantined) {
    await releaseAgents([agentId], createdByAdminId);
  }
  if (agent.remoteAccessEnabled) {
    await disableRemoteAccess(agentId, createdByAdminId);
  }

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      paused: true,
      pausedAt: new Date(),
      pausedFromQuarantined: agent.quarantined,
      pausedFromRemoteAccessEnabled: agent.remoteAccessEnabled,
      pausedFromRemoteAccessAllowedIp: agent.remoteAccessAllowedIp,
    },
  });
}

// Mirror of pauseAgent's ordering constraint: paused must flip to false FIRST, before
// re-dispatching quarantine/remote-access below, or those fresh CommandJobs would be
// withheld by the very pause state resumeAgent is in the middle of lifting.
export async function resumeAgent(agentId: string, createdByAdminId: string): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, pausedFromQuarantined: true, pausedFromRemoteAccessEnabled: true, pausedFromRemoteAccessAllowedIp: true },
  });
  if (!agent) throw new AgentNotFoundError();

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      paused: false,
      pausedAt: null,
      pausedFromQuarantined: false,
      pausedFromRemoteAccessEnabled: false,
      pausedFromRemoteAccessAllowedIp: null,
    },
  });

  if (agent.pausedFromQuarantined) {
    await quarantineAgents([agentId], createdByAdminId);
  }
  if (agent.pausedFromRemoteAccessEnabled && agent.pausedFromRemoteAccessAllowedIp) {
    await enableRemoteAccess(agentId, agent.pausedFromRemoteAccessAllowedIp, createdByAdminId);
  }
}
