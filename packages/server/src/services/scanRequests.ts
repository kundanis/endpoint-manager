// "Scan now" requests for Zero Trust and security-benchmark scans, delivered on the agent's
// next check-in (within one poll interval) as runZeroTrustScanNow / runSecurityConfigScanNow.
//
// Kept in memory rather than the database (unlike data discovery's scanRequested column):
// a request lives at most one poll interval before the agent collects it, so losing it to a
// server restart costs nothing worse than the agent's regular scan schedule. Same
// single-process seam as presence.ts - shared storage would be needed for several server
// instances.

// "inventory": report installed software now (Sync now on the endpoint's Software tab, and after
// a command or deployment finishes, since either may have installed or removed something).
// "threatProtection": a Threat Protection scan or action was requested, or its policy changed.
type ScanKind = "zeroTrust" | "securityConfig" | "inventory" | "threatProtection";

const pending: Record<ScanKind, Set<string>> = { zeroTrust: new Set(), securityConfig: new Set(), inventory: new Set(), threatProtection: new Set() };

export function requestScan(kind: ScanKind, agentIds: string[]): void {
  for (const id of agentIds) pending[kind].add(id);
}

// Returns whether a scan was requested for this agent, and clears the request.
export function takeScanRequest(kind: ScanKind, agentId: string): boolean {
  return pending[kind].delete(agentId);
}
