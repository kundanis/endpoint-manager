import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import type { UpdateAgentConnectionSettingsRequest } from "@em/shared";
import { config } from "../config";
import { prisma } from "../db";

const SINGLETON_ID = "singleton";

// Appended after the setup exe's own bytes: [payload][int32 LE length][16-byte magic], where
// payload is UTF-8 "<url1>,<url2>,...\n<token>" (plain text so the .NET Framework stub needs
// no JSON library). Windows ignores trailing data after a PE image, and SetupStub.cs reads it
// back from its own file - so one prebuilt exe can carry per-download settings without the
// server ever recompiling it.
const SETUP_CONFIG_MAGIC = Buffer.from("EPAGENTSETUPCFG1", "ascii");

export interface AgentConnectionSettingsView {
  localUrl: string | null;
  webUrl: string | null;
  publicUrl: string | null;
  // Auto-detected LAN address, shown as the default when localUrl hasn't been saved yet.
  detectedLocalUrl: string | null;
  configured: boolean;
}

function normalize(url: string | null | undefined): string | null {
  const trimmed = url?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : null;
}

// Plain HTTP on PORT whenever TLS either isn't configured or has its own TLS_PORT (see
// index.ts) - that's the listener LAN agents have always used.
function localScheme(): "http" | "https" {
  return config.tlsPfxPath && config.tlsPfxPassphrase && !config.tlsPort ? "https" : "http";
}

function getServerLanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

function detectLocalUrl(): string | null {
  const [address] = getServerLanAddresses();
  return address ? `${localScheme()}://${address}:${config.port}` : null;
}

export async function getAgentConnectionSettings(): Promise<AgentConnectionSettingsView> {
  const row = await prisma.agentConnectionSettings.findUnique({ where: { id: SINGLETON_ID } });
  return {
    localUrl: row?.localUrl ?? null,
    webUrl: row?.webUrl ?? null,
    publicUrl: row?.publicUrl ?? null,
    detectedLocalUrl: detectLocalUrl(),
    configured: !!row,
  };
}

export async function setAgentConnectionSettings(input: UpdateAgentConnectionSettingsRequest): Promise<AgentConnectionSettingsView> {
  const data = {
    localUrl: normalize(input.localUrl),
    webUrl: normalize(input.webUrl),
    publicUrl: normalize(input.publicUrl),
  };
  await prisma.agentConnectionSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  });
  checkinCache = null;
  return getAgentConnectionSettings();
}

// The order agents try addresses in: LAN first (fastest, and the only one that works if the
// firewall doesn't hairpin NAT), then the HTTPS web URL (its certificate validates against
// the domain name), then the raw public IP as a last resort. Duplicates removed.
export async function getAgentServerUrls(settings?: AgentConnectionSettingsView): Promise<string[]> {
  settings ??= await getAgentConnectionSettings();
  const ordered = [settings.localUrl ?? settings.detectedLocalUrl, settings.webUrl, settings.publicUrl];
  return Array.from(new Set(ordered.filter((u): u is string => !!u)));
}

// Only sent to agents once an admin has saved settings - until then an agent keeps the list
// it was installed with rather than being overwritten with a guess. Cached briefly since every
// check-in from every agent asks for it; saving settings clears the cache immediately.
const CHECKIN_CACHE_MS = 30_000;
let checkinCache: { value: string[] | undefined; expiresAt: number } | null = null;

export async function getServerUrlsForCheckin(): Promise<string[] | undefined> {
  if (checkinCache && checkinCache.expiresAt > Date.now()) return checkinCache.value;
  const settings = await getAgentConnectionSettings();
  const urls = settings.configured ? await getAgentServerUrls(settings) : [];
  const value = urls.length > 0 ? urls : undefined;
  checkinCache = { value, expiresAt: Date.now() + CHECKIN_CACHE_MS };
  return value;
}

export class AgentInstallerMissingError extends Error {}

// enrollmentToken empty = the generic installer download: it still carries the server
// addresses, so setup only prompts for the token.
export async function buildConfiguredSetupExe(enrollmentToken = ""): Promise<Buffer> {
  if (!fs.existsSync(config.agentInstallerPath)) {
    throw new AgentInstallerMissingError(
      "No agent installer has been published on this server yet. Build one with " +
        "'npm run package -w @em/agent' and place EndpointProAgentSetup.exe in the configured AGENT_INSTALLER_DIR.",
    );
  }
  const serverUrls = await getAgentServerUrls();
  if (serverUrls.length === 0) {
    throw new Error("No server address is configured or detectable - set the agent connection settings first.");
  }
  const exe = await fs.promises.readFile(config.agentInstallerPath);
  const payload = Buffer.from(`${serverUrls.join(",")}\n${enrollmentToken}`, "utf8");
  const length = Buffer.alloc(4);
  length.writeInt32LE(payload.length, 0);
  return Buffer.concat([exe, payload, length, SETUP_CONFIG_MAGIC]);
}

// Public resolvers as well as this server's own DNS: with split DNS (the usual setup when the
// web URL is also used inside the office) this server resolves the web URL to its internal
// address, but an endpoint out on the internet resolves it to the public IP - and that's the
// address a quarantined WAN endpoint has to be allowed to reach.
const publicResolver = new dns.Resolver({ timeout: 3_000, tries: 1 });
publicResolver.setServers(["8.8.8.8", "1.1.1.1"]);

async function resolveIpv4(host: string): Promise<string[]> {
  if (net.isIPv4(host)) return [host];
  const results = await Promise.allSettled([dns.resolve4(host), publicResolver.resolve4(host)]);
  return Array.from(new Set(results.flatMap((r) => (r.status === "fulfilled" ? r.value : []))));
}

function portOf(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

// Every (address, port) pair a quarantined endpoint must still be allowed to reach so it can
// keep checking in and later receive its Release command - the server's own LAN addresses on
// the local port, plus the public IP and web URL for endpoints that are out on the internet.
// The web URL's host is resolved via both this server's DNS and public DNS (see
// resolveIpv4), and the public IP, if set, is also paired with the web port.
export async function getAgentFirewallExceptions(): Promise<{ address: string; port: number }[]> {
  const settings = await getAgentConnectionSettings();
  const pairs: { address: string; port: number }[] = [];
  const localPort = settings.localUrl ? portOf(new URL(settings.localUrl)) : config.port;
  for (const address of getServerLanAddresses()) pairs.push({ address, port: localPort });

  const publicUrl = settings.publicUrl ? new URL(settings.publicUrl) : null;
  const webUrl = settings.webUrl ? new URL(settings.webUrl) : null;
  const publicIps = publicUrl ? await resolveIpv4(publicUrl.hostname) : [];
  for (const address of publicIps) pairs.push({ address, port: portOf(publicUrl!) });
  if (webUrl) {
    // A LAN endpoint that fell back to the web URL reaches this server's own address on the web port.
    for (const address of getServerLanAddresses()) pairs.push({ address, port: portOf(webUrl) });
    for (const address of await resolveIpv4(webUrl.hostname)) pairs.push({ address, port: portOf(webUrl) });
    for (const address of publicIps) pairs.push({ address, port: portOf(webUrl) });
  }

  const seen = new Set<string>();
  return pairs.filter((p) => {
    const key = `${p.address}:${p.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
