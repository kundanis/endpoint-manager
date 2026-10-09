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
interface InstallConfig {
  serverUrl?: string;
  // Every address the server can be reached on, in failover order (see httpClient.ts).
  // Written by install.ps1 and refreshed from the server on check-in; serverUrl above is
  // kept pointed at whichever of these last worked, for the PowerShell scripts that only
  // read a single URL (uninstall.ps1, the server-pushed uninstall script).
  serverUrls?: string[] | string;
  enrollmentToken?: string;
}

const configPath = process.env.UEM_CONFIG_FILE ?? path.join(__dirname, "..", "config.json");

function readInstallConfig(): InstallConfig {
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

// Merges into config.json on disk, keeping the enrollment token and anything else already
// there. Skipped when the server URL comes from the environment (local `npm run dev`) or
// there's no config.json at all - nothing to keep in sync in either case.
export function updateInstallConfig(patch: Partial<InstallConfig>): void {
  if (process.env.UEM_SERVER_URL || !fs.existsSync(configPath)) return;
  try {
    const next = { ...readInstallConfig(), ...patch };
    // No BOM - JSON.parse in readInstallConfig would otherwise need to strip it again.
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to update config.json", err);
  }
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function parseServerUrls(value: string[] | string | undefined): string[] {
  const list = Array.isArray(value) ? value : (value ?? "").split(",");
  return Array.from(new Set(list.map(normalizeUrl).filter(Boolean)));
}

// UEM_SERVER_URL (dev) pins a single address with no failover. Otherwise the installed list,
// falling back to the single serverUrl that pre-failover installs wrote.
function resolveServerUrls(): string[] {
  if (process.env.UEM_SERVER_URL) return [normalizeUrl(process.env.UEM_SERVER_URL)];
  const urls = parseServerUrls(installConfig.serverUrls);
  if (urls.length > 0) return urls;
  return [normalizeUrl(installConfig.serverUrl ?? "http://localhost:4000")];
}

const serverUrls = resolveServerUrls();
// Start on whichever address worked last time, if it's still in the list.
const lastWorkingUrl = installConfig.serverUrl ? normalizeUrl(installConfig.serverUrl) : undefined;
const initialServerUrl =
  !process.env.UEM_SERVER_URL && lastWorkingUrl && serverUrls.includes(lastWorkingUrl) ? lastWorkingUrl : serverUrls[0];

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

// Single source of truth for "what version am I" — package.json, not a second hardcoded
// string here, so a version bump can never drift between the two. Resolves to the real
// packages/agent/package.json in dev (__dirname is src/, so "../package.json" is this
// package's own file) and to the minimal package.json package-installer.ps1 stages
// alongside dist/ in a packaged install (same relative-path trick config.json/certs-trust
// already use above). Falls back rather than throwing — an agent that can't determine its
// own version should still run, just reporting itself as unknown instead of refusing to start.
function readAgentVersion(): string {
  const pkgJsonPath = path.join(__dirname, "..", "package.json");
  try {
    const raw = fs.readFileSync(pkgJsonPath, "utf8");
    const version = JSON.parse(raw).version;
    if (typeof version === "string" && version.length > 0) return version;
  } catch {
    // fall through
  }
  return "0.0.0-unknown";
}

export const agentConfig = {
  // Startup values only - the address in use changes at runtime as the agent fails over;
  // read it via getServerUrl() in httpClient.ts.
  serverUrls,
  initialServerUrl,
  serverCaPem: readServerCaPem(),
  getEnrollmentToken: requireEnrollmentToken,
  stateDir: process.env.UEM_STATE_DIR ?? path.join(__dirname, "..", ".state"),
  agentVersion: readAgentVersion(),
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
