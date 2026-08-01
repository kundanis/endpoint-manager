import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  DEFAULT_APP_CONTROL_SCAN_INTERVAL_MS,
  DEFAULT_COMMAND_BLOCK_SCAN_INTERVAL_MS,
  DEFAULT_DATA_DISCOVERY_SCAN_INTERVAL_MS,
  DEFAULT_DATA_MOVEMENT_SCAN_INTERVAL_MS,
  DEFAULT_DLP_EVENT_FLUSH_INTERVAL_MS,
  DEFAULT_DLP_POLICY_SYNC_INTERVAL_MS,
  DEFAULT_EDR_SCAN_INTERVAL_MS,
  DEFAULT_IP_BLOCK_SCAN_INTERVAL_MS,
  DEFAULT_USB_CONTROL_SCAN_INTERVAL_MS,
  DEFAULT_WATCHDOG_CHECK_INTERVAL_MS,
  DEFAULT_PATCH_SCAN_INTERVAL_MS,
  DEFAULT_SECURITY_CONFIG_SCAN_INTERVAL_MS,
  DEFAULT_USER_PRODUCTIVITY_SCAN_INTERVAL_MS,
  DEFAULT_WEB_BLOCK_SCAN_INTERVAL_MS,
  DEFAULT_ZERO_TRUST_SCAN_INTERVAL_MS,
} from "@em/shared";

// Written once by Install.bat/install.ps1 at the install root (a sibling of dist/ and
// .state/, same as stateDir's own default below) — env vars still win when set, so the
// local `npm run dev` workflow is completely unaffected by this.
function readInstallConfig(): { serverUrl?: string; enrollmentToken?: string } {
  const configPath = process.env.UEM_CONFIG_FILE ?? path.join(__dirname, "..", "config.json");
  try {
    // Windows PowerShell 5.1's `Set-Content -Encoding UTF8` (used by install.ps1) writes
    // a leading BOM, which JSON.parse rejects — strip it defensively rather than rely on
    // the writer never doing that.
    const rawWithBom = fs.readFileSync(configPath, "utf8");
    const raw = rawWithBom.charCodeAt(0) === 0xfeff ? rawWithBom.slice(1) : rawWithBom;
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const installConfig = readInstallConfig();

// A self-signed dev/test certificate the agent should trust in addition to the OS's
// public CA store — narrower than disabling TLS verification entirely, since only THIS
// specific certificate is trusted, not any certificate presented by any host. A real
// deployment's publicly-trusted certificate needs no entry here at all (see docs/tls-setup.md).
function readServerCaPem(): Buffer | undefined {
  const caPath = process.env.UEM_SERVER_CA_PATH ?? path.join(__dirname, "..", "certs-trust", "dev-server-public.pem");
  try {
    return fs.readFileSync(caPath);
  } catch {
    return undefined;
  }
}

function requireEnrollmentToken(): string {
  const token = process.env.UEM_ENROLLMENT_TOKEN ?? installConfig.enrollmentToken;
  if (!token) {
    throw new Error(
      "Missing enrollment token: set UEM_ENROLLMENT_TOKEN or provide it via config.json",
    );
  }
  return token;
}

export const agentConfig = {
  serverUrl: (process.env.UEM_SERVER_URL ?? installConfig.serverUrl ?? "http://localhost:4000").replace(/\/$/, ""),
  serverCaPem: readServerCaPem(),
  getEnrollmentToken: requireEnrollmentToken,
  stateDir: process.env.UEM_STATE_DIR ?? path.join(__dirname, "..", ".state"),
  agentVersion: "0.1.0",
  hostname: os.hostname(),
  inventoryRefreshMs: 10 * 60 * 1000,
  patchScanIntervalMs: DEFAULT_PATCH_SCAN_INTERVAL_MS,
  securityConfigScanIntervalMs: DEFAULT_SECURITY_CONFIG_SCAN_INTERVAL_MS,
  zeroTrustScanIntervalMs: DEFAULT_ZERO_TRUST_SCAN_INTERVAL_MS,
  dataDiscoveryScanIntervalMs: DEFAULT_DATA_DISCOVERY_SCAN_INTERVAL_MS,
  dataMovementScanIntervalMs: DEFAULT_DATA_MOVEMENT_SCAN_INTERVAL_MS,
  dlpPolicySyncIntervalMs: DEFAULT_DLP_POLICY_SYNC_INTERVAL_MS,
  dlpEventFlushIntervalMs: DEFAULT_DLP_EVENT_FLUSH_INTERVAL_MS,
  appControlScanIntervalMs: DEFAULT_APP_CONTROL_SCAN_INTERVAL_MS,
  webBlockScanIntervalMs: DEFAULT_WEB_BLOCK_SCAN_INTERVAL_MS,
  commandBlockScanIntervalMs: DEFAULT_COMMAND_BLOCK_SCAN_INTERVAL_MS,
  ipBlockScanIntervalMs: DEFAULT_IP_BLOCK_SCAN_INTERVAL_MS,
  usbControlScanIntervalMs: DEFAULT_USB_CONTROL_SCAN_INTERVAL_MS,
  watchdogCheckIntervalMs: DEFAULT_WATCHDOG_CHECK_INTERVAL_MS,
  userProductivityScanIntervalMs: DEFAULT_USER_PRODUCTIVITY_SCAN_INTERVAL_MS,
  edrScanIntervalMs: DEFAULT_EDR_SCAN_INTERVAL_MS,
};
