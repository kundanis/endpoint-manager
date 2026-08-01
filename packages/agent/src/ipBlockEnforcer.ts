import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AssignedIpBlockResponse, IpBlockSyncResultPayload } from "@em/shared";

const execFileAsync = promisify(execFile);

const RULE_NAME_OUTBOUND = "EM-IPBLOCK-Outbound";
const RULE_NAME_INBOUND = "EM-IPBLOCK-Inbound";

function psEscape(value: string): string {
  return value.replace(/'/g, "''");
}

// Rewrites ONLY the two named rules this tool owns, from scratch, every sync — same
// "exclusively owned, rewritten wholesale" discipline as Web Block's browser URLBlocklist
// registry key. An explicit Windows Firewall block rule takes precedence over any allow
// rule regardless of order/specificity (the same property the Quarantine feature relies
// on), so this holds even when the endpoint's general firewall policy allows everything
// else. Both directions are blocked — "no access to this IP" reads as no traffic either way.
function buildFirewallScript(addresses: string[]): string {
  const addressesLiteral = addresses.map((a) => `'${psEscape(a)}'`).join(", ");

  return `
$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -DisplayName '${RULE_NAME_OUTBOUND}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName '${RULE_NAME_INBOUND}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

$addresses = @(${addressesLiteral})
if ($addresses.Count -gt 0) {
  New-NetFirewallRule -DisplayName '${RULE_NAME_OUTBOUND}' -Direction Outbound -Action Block -RemoteAddress $addresses -Profile Any | Out-Null
  New-NetFirewallRule -DisplayName '${RULE_NAME_INBOUND}' -Direction Inbound -Action Block -RemoteAddress $addresses -Profile Any | Out-Null
}

Write-Output 'APPLIED'
`;
}

async function applyFirewallRules(addresses: string[]): Promise<void> {
  const script = buildFirewallScript(addresses);
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { maxBuffer: 1024 * 1024 },
  );
  if (!stdout.includes("APPLIED")) {
    throw new Error(`Unexpected IP Block apply output: ${stdout.trim()}`);
  }
}

// Never throws — mirrors webBlockEnforcer.ts exactly. No event stream: asserting a
// firewall rule has no convenient "a connection was just blocked" signal without enabling
// and parsing firewall logs, so lastSyncedAt/lastSyncStatus/lastSyncError (stamped on the
// assignment row server-side) is the only observable signal.
export async function runIpBlockScan(client: AxiosInstance): Promise<void> {
  if (process.platform !== "win32") return;

  let assigned: AssignedIpBlockResponse;
  try {
    const { data } = await client.get<AssignedIpBlockResponse>("/api/agent/ip-block/assigned");
    assigned = data;
  } catch (err) {
    console.error("Failed to fetch assigned IP Block rules", err);
    return;
  }

  let payload: IpBlockSyncResultPayload;
  try {
    await applyFirewallRules(assigned.addresses);
    payload = { policyIds: assigned.policyIds, status: "SUCCESS", errorMessage: null };
  } catch (err) {
    console.error("IP Block sync failed", err);
    payload = {
      policyIds: assigned.policyIds,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (payload.policyIds.length === 0) return;

  try {
    await client.post("/api/agent/ip-block/sync-result", payload);
    console.log(`Reported IP Block sync: ${payload.status}`);
  } catch (err) {
    console.error("Failed to report IP Block sync result", err);
  }
}
