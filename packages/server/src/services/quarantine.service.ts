import { DEFAULT_COMMAND_TIMEOUT_SEC } from "@em/shared";
import { prisma } from "../db";
import { getAgentFirewallExceptions } from "./agentConnection.service";
import { createCommandJob } from "./command.service";
import { psEscape } from "../utils/psQuote";
import { emitInvalidate } from "../events/bus";
import { decryptField } from "../utils/fieldEncryption";

// Adapted from QurantineDats/Block-Quarantine.ps1 and Revert-Quarantine.ps1 (repo root) -
// same New-NetFirewallRule-based default-deny-with-exceptions model, minus the interactive
// bits (elevation check, prompts) that don't apply to a script pushed and run unattended by
// the agent. Rule prefix is this feature's own namespace, distinct from Web/IP Block's
// EM-WEBBLOCK-*/EM-IPBLOCK-* rules and from a manually-run copy of the QurantineDats
// scripts (those use a bare "Quarantine-*" prefix) - "safe to re-run" cleanup below only
// ever touches rules this feature created.
const RULE_PREFIX = "EM-Quarantine";

// Markers the two scripts contain - also how a finished task is recognised as a quarantine or
// a release (recordQuarantineResult, getQuarantineActivity, command.service securityActionLabel).
export const QUARANTINE_SCRIPT_MARKER = "pre-quarantine-";
export const RELEASE_SCRIPT_MARKER = "Write-Output 'RELEASED'";

export class QuarantineNotSupportedError extends Error {}

// Which of the two a stored job is. CommandJob.script is stored encrypted (command.service
// createCommandJob), so it can't be matched in SQL - only after decrypting it here.
function quarantineJobKind(storedScript: string): "QUARANTINE" | "RELEASE" | null {
  let script: string;
  try {
    script = decryptField(storedScript);
  } catch {
    script = storedScript; // stored before scripts were encrypted
  }
  if (script.includes(RELEASE_SCRIPT_MARKER)) return "RELEASE";
  if (script.includes(QUARANTINE_SCRIPT_MARKER)) return "QUARANTINE";
  return null;
}


// The exceptions are gathered fresh for every quarantine job rather than hardcoded (see
// getAgentFirewallExceptions): this server's own LAN-facing IPv4s - a multi-homed server has
// more than one address an agent's traffic could be arriving from/going to - plus the public
// IP / web URL from the agent connection settings, so an endpoint quarantined while out on
// the internet can still check in and receive its Release command.

// Windows Firewall evaluates an explicit block rule over an explicit allow rule regardless
// of specificity or order, so the only way to get a real default-deny-with-exceptions is to
// set the profile's default action to block and rely on allow rules for the exceptions -
// same model Block-Quarantine.ps1 and the old version of this file both used.
function buildQuarantineScript(exceptions: { address: string; port: number }[]): string {
  const exceptionsLiteral = exceptions.map((e) => `@{ ip = '${psEscape(e.address)}'; port = ${e.port} }`).join(", ");

  return `
$ErrorActionPreference = 'Stop'
$exceptions = @(${exceptionsLiteral})

# Safe to re-run: clear out anything this feature owns before rewriting it wholesale.
Get-NetFirewallRule -DisplayName '${RULE_PREFIX}-*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

# Backup the pre-quarantine firewall state locally on the endpoint, same as
# Block-Quarantine.ps1 - a recovery path if this machine ever needs a manual/local revert.
$backupDir = 'C:\\FirewallBackup'
if (-not (Test-Path $backupDir)) { New-Item -Path $backupDir -ItemType Directory -Force | Out-Null }
$backupPath = Join-Path $backupDir ('pre-quarantine-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.wfw')
netsh advfirewall export "$backupPath" | Out-Null

Set-NetFirewallProfile -Profile Domain, Private, Public -Enabled True -DefaultInboundAction Block -DefaultOutboundAction Block

# Explicitly block ICMP (ping) and SMB - redundant with the default-block above, but explicit
# so they stay blocked even if another policy adds a broader allow rule later. There is NO
# "block the local subnet" rule: Windows Firewall applies a block rule over every allow rule,
# so it also blocked this server and the router's DNS whenever the endpoint sits on the same
# LAN as the server - the endpoint then lost contact and couldn't even receive its Release.
# The local network is blocked by the default-block like everything else.
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Block-ICMPv4-Out' -Direction Outbound -Protocol ICMPv4 -Action Block | Out-Null
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Block-ICMPv4-In'  -Direction Inbound  -Protocol ICMPv4 -Action Block | Out-Null
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Block-ICMPv6-Out' -Direction Outbound -Protocol ICMPv6 -Action Block | Out-Null
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Block-ICMPv6-In'  -Direction Inbound  -Protocol ICMPv6 -Action Block | Out-Null
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Block-SMB-Out' -Direction Outbound -Protocol TCP -RemotePort 445,139 -Action Block | Out-Null
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Block-SMB-In'  -Direction Inbound  -Protocol TCP -LocalPort 445,139  -Action Block | Out-Null

# DNS stays allowed outbound - the agent is commonly configured with a hostname (not a raw
# IP) as its server URL, and it needs to keep resolving that hostname to know which of the
# exception IPs below to actually talk to. The exception rules match the resolved IP, not
# the hostname, so this doesn't widen what's reachable, only what's resolvable.
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Allow-DNS-Out' -Direction Outbound -Protocol UDP -RemotePort 53 -Action Allow | Out-Null
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Allow-DNS-TCP-Out' -Direction Outbound -Protocol TCP -RemotePort 53 -Action Allow | Out-Null
# DHCP: without it the endpoint loses its IP address when the lease runs out, and with it the
# connection to this server.
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Allow-DHCP-Out' -Direction Outbound -Protocol UDP -LocalPort 68 -RemotePort 67 -Action Allow | Out-Null
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Allow-DHCP-In' -Direction Inbound -Protocol UDP -LocalPort 68 -RemotePort 67 -Action Allow | Out-Null

# Allow this server's own address(es), each restricted to its port, in both directions -
# covers check-ins/heartbeats (outbound) and the eventual Release command delivery (inbound).
$i = 1
foreach ($e in $exceptions) {
  New-NetFirewallRule -DisplayName "${RULE_PREFIX}-Allow-Server$i-Out" -Direction Outbound -RemoteAddress $e.ip -Protocol TCP -RemotePort $e.port -Action Allow | Out-Null
  New-NetFirewallRule -DisplayName "${RULE_PREFIX}-Allow-Server$i-In"  -Direction Inbound  -RemoteAddress $e.ip -Protocol TCP -LocalPort $e.port  -Action Allow | Out-Null
  $i++
}

# Verify the block actually took effect before claiming success. On a domain-joined
# endpoint, a Group Policy that manages the Windows Firewall (a policy setting an org's
# AD admins configured) can silently force the profile's default action back to Allow -
# New-NetFirewallRule/Set-NetFirewallProfile above still succeed and write to the local
# store without error, but ActiveStore (what's actually enforced) can end up completely
# different. Checking PersistentStore (the default, what we just wrote) would show exactly
# what we asked for either way and prove nothing; ActiveStore plus a live connectivity
# probe is the only way to know whether isolation is real. Without this check, a
# GPO-overridden endpoint reports "QUARANTINED" and looks isolated in the console while
# actually being fully reachable - worse than a visible failure, because nobody would
# think to check.
$activeDefaults = Get-NetFirewallProfile -PolicyStore ActiveStore -Profile Domain, Private, Public -ErrorAction SilentlyContinue
$notBlocking = $activeDefaults | Where-Object { $_.DefaultOutboundAction -ne 'Block' -or $_.DefaultInboundAction -ne 'Block' }
$canaryReachable = $false
try {
  $canary = Test-NetConnection -ComputerName '8.8.8.8' -Port 443 -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
  $canaryReachable = [bool]$canary.TcpTestSucceeded
} catch { $canaryReachable = $false }

if ($notBlocking -or $canaryReachable) {
  $activeSummary = ($activeDefaults | ForEach-Object { '{0}=In:{1}/Out:{2}' -f $_.Name, $_.DefaultInboundAction, $_.DefaultOutboundAction }) -join ', '
  $reason = 'Quarantine rules were written but are NOT being enforced - most likely a domain Group Policy manages this endpoint''s Windows Firewall and overrides the local default-block. ' +
    'ActiveStore default action: ' + $activeSummary + '. Outbound-internet canary reachable: ' + $canaryReachable + '. ' +
    'This machine is NOT actually isolated - see the quarantine service''s domain-GPO note for remediation options.'
  Write-Error $reason
  exit 1
}

Write-Output 'QUARANTINED'
`;
}

// Removes every rule this feature owns and puts the profile defaults back to Windows' own:
// block unsolicited inbound, allow outbound. (Setting inbound to Allow - what this used to do -
// left a released machine accepting every incoming connection, more exposed than before it was
// quarantined.) Doesn't restore the .wfw backup: this job can't know its path, and the
// defaults plus the machine's own rules are what was in force before anyway.
function buildReleaseScript(): string {
  return `
$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -DisplayName '${RULE_PREFIX}-*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Set-NetFirewallProfile -Profile Domain, Private, Public -DefaultInboundAction Block -DefaultOutboundAction Allow
$left = @(Get-NetFirewallRule -DisplayName '${RULE_PREFIX}-*' -ErrorAction SilentlyContinue).Count
if ($left -gt 0) { Write-Error "$left quarantine firewall rule(s) could not be removed."; exit 1 }
Write-Output 'RELEASED'
`;
}

// The quarantine scripts are Windows Firewall scripts: Linux and macOS agents have no
// equivalent yet, so they're refused rather than sent a job that can only fail.
async function windowsAgents(agentIds: string[]) {
  const agents = await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, hostname: true, osPlatform: true } });
  const others = agents.filter((a) => a.osPlatform !== "win32");
  return {
    found: agents.length,
    windowsIds: agents.filter((a) => a.osPlatform === "win32").map((a) => a.id),
    otherIds: others.map((a) => a.id),
    skipped: others.map((a) => a.hostname),
  };
}

// Bulk-capable — the script itself is agent-independent (no per-agent parameterization),
// so the whole target list shares one CommandJob. The single-endpoint route
// (admin.routes.ts's POST /agents/:id/quarantine, used by AgentsPage.tsx's per-row button)
// just calls this with a 1-element array — same behavior, same contract, unchanged.
//
// The endpoint is marked quarantined only when its job reports success (recordQuarantineResult),
// not when the job is sent: a job that fails (Group Policy overriding the firewall, a script
// error) or never runs (endpoint offline) must not show the machine as isolated.
export async function quarantineAgents(agentIds: string[], createdByAdminId: string) {
  const targets = await windowsAgents(agentIds);
  if (targets.found === 0) return null;
  if (targets.windowsIds.length === 0) {
    throw new QuarantineNotSupportedError("Quarantine is available for Windows endpoints only.");
  }
  const validIds = targets.windowsIds;

  const exceptions = await getAgentFirewallExceptions();
  if (exceptions.length === 0) {
    // No LAN-facing address to except means the resulting quarantine would cut an agent
    // off from this server entirely, with no remote path left to release it. Refuse rather
    // than silently ship an unrecoverable lockout.
    throw new Error("Could not determine this server's LAN IP address(es) - refusing to build a quarantine rule with no exception.");
  }

  const { jobId } = await createCommandJob({
    agentIds: validIds,
    groupIds: [],
    shell: "powershell",
    script: buildQuarantineScript(exceptions),
    timeoutSec: DEFAULT_COMMAND_TIMEOUT_SEC,
    createdByAdminId,
    bypassesPause: true,
  });
  return { jobId, skipped: targets.skipped };
}

export async function releaseAgents(agentIds: string[], createdByAdminId: string) {
  const targets = await windowsAgents(agentIds);
  if (targets.found === 0) return null;
  // Linux/macOS endpoints were never actually isolated (older releases marked them anyway):
  // just clear the mark.
  if (targets.otherIds.length > 0) {
    await prisma.agent.updateMany({ where: { id: { in: targets.otherIds } }, data: { quarantined: false } });
  }
  const validIds = targets.windowsIds;
  if (validIds.length === 0) return { jobId: null, skipped: targets.skipped };

  const { jobId } = await createCommandJob({
    agentIds: validIds,
    groupIds: [],
    shell: "powershell",
    script: buildReleaseScript(),
    timeoutSec: DEFAULT_COMMAND_TIMEOUT_SEC,
    createdByAdminId,
    bypassesPause: true,
  });
  return { jobId, skipped: targets.skipped };
}

// Called with every finished command result (command.service recordCommandResult): a
// quarantine that reported QUARANTINED marks the endpoint quarantined, a release that reported
// RELEASED clears it. A failed job leaves the mark as it was - a failed release means the
// machine is still isolated, a failed quarantine means it never was.
export async function recordQuarantineResult(
  job: { script: string; bypassesPause: boolean },
  agentId: string,
  result: { status: string; stdout?: string | null },
): Promise<void> {
  if (!job.bypassesPause) return;
  const kind = quarantineJobKind(job.script);
  if (!kind) return;
  const isRelease = kind === "RELEASE";
  const isQuarantine = kind === "QUARANTINE";
  if (result.status === "SUCCESS" && isRelease && result.stdout?.includes("RELEASED")) {
    await prisma.agent.update({ where: { id: agentId }, data: { quarantined: false } });
  } else if (result.status === "SUCCESS" && isQuarantine && result.stdout?.includes("QUARANTINED")) {
    await prisma.agent.update({ where: { id: agentId }, data: { quarantined: true } });
  }
  // Open consoles refresh the endpoint right away - done, or failed - instead of on their
  // next fallback poll.
  emitInvalidate(["agents"]);
}

export type QuarantineActivity = { action: "QUARANTINE" | "RELEASE"; state: "PENDING" | "FAILED" };

// The latest quarantine/release job per endpoint, when it's still waiting to run or failed -
// so the console can show "Quarantining…", "Releasing…" or the failure instead of a mark that
// doesn't match the machine. Absent when the latest one succeeded (the mark says it all).
export async function getQuarantineActivity(agentIds?: string[]): Promise<Map<string, QuarantineActivity>> {
  // Security-action jobs only (bypassesPause: quarantine, release, remote access, uninstall) -
  // a small set; the scripts are encrypted, so which ones are quarantine jobs is decided here.
  const tasks = await prisma.commandTask.findMany({
    where: { ...(agentIds ? { agentId: { in: agentIds } } : {}), job: { bypassesPause: true } },
    select: { agentId: true, status: true, job: { select: { id: true, createdAt: true, script: true } } },
    orderBy: { job: { createdAt: "desc" } },
  });
  const kindByJob = new Map<string, ReturnType<typeof quarantineJobKind>>();
  const out = new Map<string, QuarantineActivity>();
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.agentId)) continue; // newest first: only the latest quarantine/release counts
    if (!kindByJob.has(t.job.id)) kindByJob.set(t.job.id, quarantineJobKind(t.job.script));
    const action = kindByJob.get(t.job.id);
    if (!action) continue;
    seen.add(t.agentId);
    if (t.status === "PENDING" || t.status === "DISPATCHED") out.set(t.agentId, { action, state: "PENDING" });
    else if (t.status === "FAILED" || t.status === "TIMEOUT") out.set(t.agentId, { action, state: "FAILED" });
  }
  return out;
}
