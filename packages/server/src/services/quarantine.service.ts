import { DEFAULT_COMMAND_TIMEOUT_SEC } from "@em/shared";
import { prisma } from "../db";
import { getAgentFirewallExceptions } from "./agentConnection.service";
import { createCommandJob } from "./command.service";

// Adapted from QurantineDats/Block-Quarantine.ps1 and Revert-Quarantine.ps1 (repo root) -
// same New-NetFirewallRule-based default-deny-with-exceptions model, minus the interactive
// bits (elevation check, prompts) that don't apply to a script pushed and run unattended by
// the agent. Rule prefix is this feature's own namespace, distinct from Web/IP Block's
// EM-WEBBLOCK-*/EM-IPBLOCK-* rules and from a manually-run copy of the QurantineDats
// scripts (those use a bare "Quarantine-*" prefix) - "safe to re-run" cleanup below only
// ever touches rules this feature created.
const RULE_PREFIX = "EM-Quarantine";

function psEscape(value: string): string {
  return value.replace(/'/g, "''");
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

# Explicitly block LocalSubnet, ICMP (ping), and SMB - redundant with the default-block
# above for anything not otherwise excepted, but explicit so it survives even if a broader
# allow rule from another policy gets added later.
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Block-LocalSubnet-Out' -Direction Outbound -RemoteAddress LocalSubnet -Action Block | Out-Null
New-NetFirewallRule -DisplayName '${RULE_PREFIX}-Block-LocalSubnet-In'  -Direction Inbound  -RemoteAddress LocalSubnet -Action Block | Out-Null
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

// Mirrors Revert-Quarantine.ps1's no-backup-path branch: remove every rule this feature
// owns and restore the profile defaults to Allow. Deliberately doesn't attempt the .wfw
// restore path - that backup lives on the endpoint from whatever quarantine job created it,
// and this release job has no way to know its path (or that quarantine even ran via this
// path rather than a manual run of Block-Quarantine.ps1); removing the rules and resetting
// the defaults gets back to an equivalent "everything allowed" state either way.
function buildReleaseScript(): string {
  return `
$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -DisplayName '${RULE_PREFIX}-*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Set-NetFirewallProfile -Profile Domain, Private, Public -DefaultInboundAction Allow -DefaultOutboundAction Allow
Write-Output 'RELEASED'
`;
}

// Bulk-capable — the script itself is agent-independent (no per-agent parameterization),
// so the whole target list shares one CommandJob. The single-endpoint route
// (admin.routes.ts's POST /agents/:id/quarantine, used by AgentsPage.tsx's per-row button)
// just calls this with a 1-element array — same behavior, same contract, unchanged.
export async function quarantineAgents(agentIds: string[], createdByAdminId: string) {
  const existing = await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true } });
  if (existing.length === 0) return null;
  const validIds = existing.map((a) => a.id);

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
    bypassesPause: true,
  });
  await prisma.agent.updateMany({ where: { id: { in: validIds } }, data: { quarantined: false } });
  return { jobId };
}
