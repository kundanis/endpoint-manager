import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getServerUrl } from "./httpClient";

const execFileAsync = promisify(execFile);

// The Endpoint IQ Mail Guard browser extension (browser-extension/ at the repo root) takes the
// server address only from browser policy, so the endpoint user can't point it elsewhere. The
// agent writes that policy here, under HKLM where a standard user can't change it, for Chrome
// and Edge. The ID is fixed by the "key" in the extension's manifest.json.
export const MAIL_GUARD_EXTENSION_ID = "lkmoggokfmdgjjjbmfachhmjdpbebebc";

const POLICY_KEYS = [
  `HKLM\\SOFTWARE\\Policies\\Google\\Chrome\\3rdparty\\extensions\\${MAIL_GUARD_EXTENSION_ID}\\policy`,
  `HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\3rdparty\\extensions\\${MAIL_GUARD_EXTENSION_ID}\\policy`,
];
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Rewritten every check (idempotent), so it follows a failover to another server address and
// puts back a value an administrator removed.
async function writeServerUrl(): Promise<void> {
  const url = getServerUrl();
  for (const key of POLICY_KEYS) {
    await execFileAsync("reg.exe", ["add", key, "/v", "serverUrl", "/t", "REG_SZ", "/d", url, "/f"]);
  }
}

export function startMailGuardPolicy(): void {
  if (process.platform !== "win32") return;
  const run = () => writeServerUrl().catch((err) => console.error("Mail Guard policy write failed", err));
  void run();
  setInterval(run, CHECK_INTERVAL_MS);
}
