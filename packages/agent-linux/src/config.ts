import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULT_PATCH_SCAN_INTERVAL_MS } from "@em/shared";

// Written once by install.sh at the install root (a sibling of dist/ and .state/, same as
// stateDir's own default below) — env vars still win when set, so the local
// `npm run dev` workflow is completely unaffected by this. Mirrors the Windows agent's
// config.json convention exactly (see packages/agent/src/config.ts's readInstallConfig) —
// same JSON shape, just laid out under a Linux install root instead of a Windows one.
interface InstallConfig {
  serverUrl?: string;
  // Every address the server can be reached on, in failover order (see httpClient.ts) -
  // same contract as the Windows agent's config.ts. serverUrl above is kept pointed at
  // whichever of these last worked, for uninstall.sh which reads a single URL.
  serverUrls?: string[] | string;
  enrollmentToken?: string;
}

const configPath = process.env.UEM_CONFIG_FILE ?? path.join(__dirname, "..", "config.json");

function readInstallConfig(): InstallConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

const installConfig = readInstallConfig();

// Merges into config.json on disk, keeping the enrollment token and anything else already
// there. Skipped when the server URL comes from the environment (local `npm run dev`) or
// there's no config.json at all.
export function updateInstallConfig(patch: Partial<InstallConfig>): void {
  if (process.env.UEM_SERVER_URL || !fs.existsSync(configPath)) return;
  try {
    fs.writeFileSync(configPath, JSON.stringify({ ...readInstallConfig(), ...patch }, null, 2), { encoding: "utf8", mode: 0o600 });
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

// A self-signed dev/test certificate the agent should trust in addition to the OS's public
// CA store — same narrow "trust one specific cert" pattern as the Windows agent's
// UEM_SERVER_CA_PATH (see docs/tls-setup.md).
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
    throw new Error("Missing enrollment token: set UEM_ENROLLMENT_TOKEN or provide it via config.json");
  }
  return token;
}

// Single source of truth for "what version am I" — package.json, not a hardcoded string,
// so a version bump can never drift out of sync with what package-installer.sh actually
// shipped (same fix already applied to the Windows agent for the same reason — see
// packages/agent/src/config.ts's readAgentVersion). Resolves to this package's own
// package.json in dev (__dirname is src/) and to the minimal package.json
// package-installer.sh stages alongside dist/ in a packaged install.
function readAgentVersion(): string {
  const pkgJsonPath = path.join(__dirname, "..", "package.json");
  try {
    const version = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")).version;
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
};
