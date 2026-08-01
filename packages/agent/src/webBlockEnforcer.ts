import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AssignedWebBlockResponse, WebBlockSyncResultPayload } from "@em/shared";

const execFileAsync = promisify(execFile);

const HOSTS_PATH = "C:\\Windows\\System32\\drivers\\etc\\hosts";
const START_MARKER = "# EM-WEBBLOCK-START";
const END_MARKER = "# EM-WEBBLOCK-END";

// Rewrites ONLY the marker-delimited block this tool owns — everything else in the hosts
// file (including any admin-authored entries) is left byte-for-byte untouched, the same
// "own managed section only" discipline the quarantine feature's named firewall rules use.
function applyHostsBlock(domains: string[]): void {
  const original = fs.readFileSync(HOSTS_PATH, "utf8");
  const startIdx = original.indexOf(START_MARKER);
  const endIdx = original.indexOf(END_MARKER);

  const withoutManagedBlock =
    startIdx !== -1 && endIdx !== -1 && endIdx > startIdx
      ? `${original.slice(0, startIdx).trimEnd()}\r\n`
      : `${original.trimEnd()}\r\n`;

  const next =
    domains.length > 0
      ? `${withoutManagedBlock}\r\n${START_MARKER}\r\n${domains.map((d) => `0.0.0.0 ${d}`).join("\r\n")}\r\n${END_MARKER}\r\n`
      : withoutManagedBlock;

  fs.writeFileSync(HOSTS_PATH, next, "utf8");
}

function psEscape(value: string): string {
  return value.replace(/'/g, "''");
}

// Chrome's/Edge's URLBlocklist policy keys are treated as exclusively owned by this tool
// (rewritten from scratch every sync) rather than tagged-and-merged like SRP's Disallowed
// list — unlike SRP's Paths key, this key has no room for a per-entry ownership marker and
// in practice is set by exactly one central management tool, never hand-authored alongside it.
function buildBrowserPolicyScript(domains: string[]): string {
  const domainsLiteral = domains.map((d) => `'${psEscape(d)}'`).join(", ");

  return `
$ErrorActionPreference = 'SilentlyContinue'
$domains = @(${domainsLiteral})

function Set-UrlBlocklist([string]$basePath) {
  New-Item -Path $basePath -Force | Out-Null
  $existing = Get-Item -Path $basePath
  foreach ($name in $existing.Property) {
    Remove-ItemProperty -Path $basePath -Name $name -ErrorAction SilentlyContinue
  }
  $i = 1
  foreach ($d in $domains) {
    Set-ItemProperty -Path $basePath -Name "$i" -Value $d -Type String
    $i++
  }
}

Set-UrlBlocklist 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome\\URLBlocklist'
Set-UrlBlocklist 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge\\URLBlocklist'

Write-Output 'APPLIED'
`;
}

async function applyBrowserPolicy(domains: string[]): Promise<void> {
  const script = buildBrowserPolicyScript(domains);
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { maxBuffer: 1024 * 1024 },
  );
  if (!stdout.includes("APPLIED")) {
    throw new Error(`Unexpected browser policy apply output: ${stdout.trim()}`);
  }
}

// Never throws — any failure is caught and reported as a FAILED sync rather than left
// silent. No event stream here: hosts-file/registry blocking has no convenient "a block
// just happened" signal, so per-assignment lastSyncedAt/lastSyncStatus/lastSyncError is
// the only observable signal (see the WebBlockPolicyAssignment model comment).
export async function runWebBlockScan(client: AxiosInstance): Promise<void> {
  let assigned: AssignedWebBlockResponse;
  try {
    const { data } = await client.get<AssignedWebBlockResponse>("/api/agent/web-block/assigned");
    assigned = data;
  } catch (err) {
    console.error("Failed to fetch assigned Web Block rules", err);
    return;
  }

  let payload: WebBlockSyncResultPayload;
  try {
    applyHostsBlock(assigned.domains);
    await applyBrowserPolicy(assigned.domains);
    payload = { policyIds: assigned.policyIds, status: "SUCCESS", errorMessage: null };
  } catch (err) {
    console.error("Web Block sync failed", err);
    payload = {
      policyIds: assigned.policyIds,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (payload.policyIds.length === 0) return;

  try {
    await client.post("/api/agent/web-block/sync-result", payload);
    console.log(`Reported Web Block sync: ${payload.status}`);
  } catch (err) {
    console.error("Failed to report Web Block sync result", err);
  }
}
