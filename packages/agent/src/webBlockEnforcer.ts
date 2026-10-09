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
// file (including any admin-authored entries, before OR after the block) is kept, the same
// "own managed section only" discipline the quarantine feature's named firewall rules use.
// Returns whether the file actually changed: it's only written then, so a 20s re-assert
// that changes nothing doesn't rewrite the hosts file (or flush DNS) every time.
function applyHostsBlock(domains: string[]): boolean {
  const original = fs.readFileSync(HOSTS_PATH, "utf8");
  const startIdx = original.indexOf(START_MARKER);
  const endIdx = original.indexOf(END_MARKER);

  let before = original;
  let after = "";
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    before = original.slice(0, startIdx);
    after = original.slice(endIdx + END_MARKER.length).replace(/^\r?\n/, "");
  }
  const outside = `${before.trimEnd()}\r\n${after.trim() ? `${after.trimEnd()}\r\n` : ""}`;

  const next =
    domains.length > 0
      ? `${outside}\r\n${START_MARKER}\r\n${domains.map((d) => `0.0.0.0 ${d}`).join("\r\n")}\r\n${END_MARKER}\r\n`
      : outside;

  if (next === original) return false;
  fs.writeFileSync(HOSTS_PATH, next, "utf8");
  return true;
}

// Windows caches resolved names (including negative/blocked results), so a hosts-file
// change — most importantly an unblock, e.g. an approved access exception — wouldn't take
// effect until that cache expired. Best-effort: a failed flush just means the old answer
// lingers a little longer, not a failed sync.
async function flushDnsCache(): Promise<void> {
  await execFileAsync("ipconfig.exe", ["/flushdns"]).catch((err) => console.error("DNS cache flush failed", err));
}

const CHROME_URL_BLOCKLIST_KEY = "HKLM\\SOFTWARE\\Policies\\Google\\Chrome\\URLBlocklist";
const EDGE_URL_BLOCKLIST_KEY = "HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\URLBlocklist";

// Chrome's/Edge's URLBlocklist policy keys are treated as exclusively owned by this tool
// (rewritten from scratch every sync) rather than tagged-and-merged like SRP's Disallowed
// list — unlike SRP's Paths key, this key has no room for a per-entry ownership marker and
// in practice is set by exactly one central management tool, never hand-authored alongside it.
//
// Uses reg.exe rather than a PowerShell script (as this used to) — functionally identical,
// but a bare "reg add /v /t REG_SZ /d /f" is about as unremarkable as Windows admin tooling
// gets, where "powershell.exe -ExecutionPolicy Bypass -Command <inline script>" is one of
// the most heavily-scored living-off-the-land patterns in every major AV/EDR product's
// built-in detections — customers can't be asked to turn EDR off for this tool to work, so
// avoid tripping it in the first place for an action this routine. Each domain is passed as
// its own execFile argv entry (no shell:true), so unlike the old psEscape() approach there's
// no manual string-escaping to get right — Windows never re-parses these as shell text.
async function setUrlBlocklist(basePath: string, domains: string[]): Promise<void> {
  await execFileAsync("reg.exe", ["add", basePath, "/f"]);
  // /va (all values, not subkeys) — clears anything this tool previously wrote so a shrinking
  // domain list doesn't leave stale entries behind. Errors when the key already has zero
  // values (nothing to delete), which isn't a real failure, so it's swallowed here rather
  // than propagated like every other step in this function.
  await execFileAsync("reg.exe", ["delete", basePath, "/va", "/f"]).catch(() => {});
  for (let i = 0; i < domains.length; i++) {
    await execFileAsync("reg.exe", ["add", basePath, "/v", String(i + 1), "/t", "REG_SZ", "/d", domains[i], "/f"]);
  }
}

async function applyBrowserPolicy(domains: string[]): Promise<void> {
  await setUrlBlocklist(CHROME_URL_BLOCKLIST_KEY, domains);
  await setUrlBlocklist(EDGE_URL_BLOCKLIST_KEY, domains);
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
    if (applyHostsBlock(assigned.domains)) await flushDnsCache();
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
