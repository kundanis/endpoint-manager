import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import dgram from "node:dgram";
import dns from "node:dns";
import fs from "node:fs/promises";
import { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import type { DiscoveredHostResult, NetworkScanTaskResultPayload } from "@em/shared";
import { MIN_NETWORK_SCAN_PREFIX_LENGTH } from "@em/shared";
import { prisma } from "../db";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);

export class ScanAlreadyRunningError extends Error {
  constructor(public readonly runId: string) {
    super("A network scan is already running");
  }
}

export class InvalidCidrError extends Error {}
export class NetworkScanTaskNotOwnedError extends Error {}

const MIN_PREFIX_LENGTH = MIN_NETWORK_SCAN_PREFIX_LENGTH;
const HOST_CONCURRENCY = 40;
const PING_TIMEOUT_MS = 300;
const PING_SWEEP_TIMEOUT_MS = 20_000;
const PORT_PROBE_TIMEOUT_MS = 300;
const COMMON_PORTS = [22, 80, 135, 139, 443, 445, 3389];
const NBNS_PORT = 137;
const NBNS_TIMEOUT_MS = 300;

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function expandCidr(cidr: string): string[] {
  const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!match) throw new InvalidCidrError(`Invalid CIDR notation: ${cidr}`);

  const [, base, prefixStr] = match;
  const prefix = Number(prefixStr);
  if (prefix < 0 || prefix > 32) throw new InvalidCidrError(`Invalid CIDR prefix: /${prefix}`);
  if (prefix < MIN_PREFIX_LENGTH) {
    throw new InvalidCidrError(`CIDR range too large — must be /${MIN_PREFIX_LENGTH} or smaller (max 1024 addresses)`);
  }

  const baseInt = ipToInt(base);
  const hostBits = 32 - prefix;
  const size = 2 ** hostBits;
  const networkInt = (baseInt & (0xffffffff << hostBits)) >>> 0;

  if (hostBits <= 1) {
    // /31 or /32 — no separate network/broadcast address, every address is usable
    return Array.from({ length: size }, (_, i) => intToIp(networkInt + i));
  }

  const usableCount = size - 2; // exclude network + broadcast address
  return Array.from({ length: usableCount }, (_, i) => intToIp(networkInt + 1 + i));
}

export function getSuggestedCidr(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        const parts = iface.address.split(".");
        return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      }
    }
  }
  return "192.168.1.0/24";
}

function toArray<T>(value: T[] | T | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// One PowerShell process for the whole subnet, using .NET's async Ping so hundreds of
// hosts are probed concurrently within that single process — spawning a ping.exe child
// process per host instead (the first version of this) starved the Node event loop and
// slowed down every other request on the server while a scan was running. The IP list is
// passed via a temp file rather than inline in the script to stay well under the Windows
// command-line length limit for a full /22 (up to ~1000 addresses).
async function pingSweep(ips: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (process.platform !== "win32" || ips.length === 0) return map;

  const inputFile = path.join(os.tmpdir(), `em-network-scan-${randomUUID()}.txt`);
  await fs.writeFile(inputFile, ips.join("\n"), "utf8");

  try {
    const script = `
$ips = Get-Content -LiteralPath '${inputFile}'
$pings = $ips | ForEach-Object {
  [PSCustomObject]@{ IP = [string]$_; Task = (New-Object System.Net.NetworkInformation.Ping).SendPingAsync([string]$_, ${PING_TIMEOUT_MS}) }
}
$results = foreach ($p in $pings) {
  try {
    $reply = $p.Task.GetAwaiter().GetResult()
    if ($reply.Status -eq 'Success') {
      [PSCustomObject]@{ IPAddress = $p.IP; RoundtripTime = [int]$reply.RoundtripTime }
    }
  } catch {}
}
@($results) | ConvertTo-Json -Compress
`;

    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { maxBuffer: 10 * 1024 * 1024, timeout: PING_SWEEP_TIMEOUT_MS },
    );

    const trimmed = stdout.trim();
    const parsed: { IPAddress: string; RoundtripTime: number } | Array<{ IPAddress: string; RoundtripTime: number }> =
      trimmed ? JSON.parse(trimmed) : [];

    for (const row of toArray(parsed)) {
      if (row?.IPAddress) map.set(row.IPAddress, row.RoundtripTime);
    }
  } catch (err) {
    logger.error({ err }, "Ping sweep failed");
  } finally {
    await fs.unlink(inputFile).catch(() => {});
  }

  return map;
}

// Single Get-NetNeighbor call for the whole subnet, run once per scan after the ping sweep
// has populated the ARP cache — much cheaper than resolving MACs one host at a time.
async function getArpTable(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (process.platform !== "win32") return map;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.State -ne 'Unreachable' } | Select-Object IPAddress,LinkLayerAddress | ConvertTo-Json -Compress",
      ],
      { maxBuffer: 5 * 1024 * 1024, timeout: 10_000 },
    );

    const trimmed = stdout.trim();
    const parsed: { IPAddress: string; LinkLayerAddress: string | null } | Array<{ IPAddress: string; LinkLayerAddress: string | null }> =
      trimmed ? JSON.parse(trimmed) : [];

    for (const row of toArray(parsed)) {
      if (row?.IPAddress && row.LinkLayerAddress) {
        map.set(row.IPAddress, row.LinkLayerAddress.toUpperCase());
      }
    }
  } catch (err) {
    logger.error({ err }, "ARP table lookup failed");
  }

  return map;
}

function probePort(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, ip);
  });
}

async function probeCommonPorts(ip: string): Promise<number[]> {
  const results = await Promise.all(
    COMMON_PORTS.map(async (port) => ((await probePort(ip, port)) ? port : null)),
  );
  return results.filter((p): p is number => p !== null);
}

async function reverseDns(ip: string): Promise<string | null> {
  try {
    const names = await dns.promises.reverse(ip);
    return names[0] ?? null;
  } catch {
    return null;
  }
}

// Most LANs have no internal DNS PTR records for workstations, so reverseDns() alone comes
// back empty for nearly everything — this is the same NetBIOS Name Service (NBNS, UDP/137)
// query `nbtstat -A` sends, which Windows machines answer even with zero DNS configured.
// Implemented as a raw UDP query (not a shell-out) so per-host resolution doesn't reintroduce
// the process-spawn-storm problem the ping sweep had.
function buildNbnsNodeStatusQuery(): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(Math.floor(Math.random() * 0x10000), 0); // transaction id
  header.writeUInt16BE(0x0000, 2); // flags: standard query
  header.writeUInt16BE(0x0001, 4); // qdcount
  header.writeUInt16BE(0x0000, 6); // ancount
  header.writeUInt16BE(0x0000, 8); // nscount
  header.writeUInt16BE(0x0000, 10); // arcount

  // Wildcard name "*" padded with NUL to 16 bytes, then NetBIOS first-level encoded to 32 bytes.
  const rawName = Buffer.alloc(16, 0x00);
  rawName[0] = 0x2a; // '*'
  const encodedName = Buffer.alloc(32);
  for (let i = 0; i < 16; i++) {
    encodedName[i * 2] = 0x41 + ((rawName[i] >> 4) & 0x0f);
    encodedName[i * 2 + 1] = 0x41 + (rawName[i] & 0x0f);
  }

  const question = Buffer.concat([
    Buffer.from([0x20]), // encoded name length (32)
    encodedName,
    Buffer.from([0x00]), // name terminator
    Buffer.from([0x00, 0x21]), // QTYPE = NBSTAT
    Buffer.from([0x00, 0x01]), // QCLASS = IN
  ]);

  return Buffer.concat([header, question]);
}

function parseNbnsNodeStatusResponse(buf: Buffer): string | null {
  try {
    let offset = 12; // past the header
    if ((buf[offset] & 0xc0) === 0xc0) {
      offset += 2; // DNS-style compression pointer instead of a literal name
    } else {
      offset += 1 + buf[offset] + 1; // length byte + encoded name + terminator
    }
    offset += 2 + 2 + 4; // TYPE + CLASS + TTL
    const rdLength = buf.readUInt16BE(offset);
    offset += 2;
    if (rdLength < 1) return null;

    const numNames = buf[offset];
    let p = offset + 1;
    for (let i = 0; i < numNames; i++) {
      const nameBytes = buf.subarray(p, p + 15);
      const suffix = buf[p + 15];
      const flags = buf.readUInt16BE(p + 16);
      p += 18;
      const isGroupName = (flags & 0x8000) !== 0;
      if (suffix === 0x00 && !isGroupName) {
        return nameBytes.toString("ascii").trim() || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function queryNetBiosName(ip: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let done = false;
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), NBNS_TIMEOUT_MS);
    socket.once("message", (msg) => finish(parseNbnsNodeStatusResponse(msg)));
    socket.once("error", () => finish(null));
    socket.send(buildNbnsNodeStatusQuery(), NBNS_PORT, ip, (err) => {
      if (err) finish(null);
    });
  });
}

async function resolveHostname(ip: string): Promise<string | null> {
  const netBiosName = await queryNetBiosName(ip);
  return netBiosName ?? reverseDns(ip);
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface HostProbeResult {
  ipAddress: string;
  responseTimeMs: number;
}

// Resolves a batch of possibly-stale agent ids to their current hostname — used for
// NetworkScanRun.agentId and NetworkVlan.assignedAgentId, both plain (non-FK) columns since
// a live relation here would give SQL Server multiple cascade paths into DiscoveredHost
// (see schema.prisma comments). Missing ids are simply absent from the returned map — same
// "(deleted X)" fallback idiom as resolveGroupNames() elsewhere in this codebase.
export async function resolveAgentHostnames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (uniqueIds.length === 0) return new Map();
  const agents = await prisma.agent.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, hostname: true } });
  return new Map(agents.map((a) => [a.id, a.hostname]));
}

// Shared by both the server-side scan path (runNetworkScan) and the agent-dispatch result
// path (recordNetworkScanTaskResult) — guarantees identical finalization regardless of
// which mode produced the host list.
async function finalizeSuccessfulRun(scanRunId: string, hostsScannedCount: number, hosts: DiscoveredHostResult[]): Promise<void> {
  const matchedAgents =
    hosts.length > 0
      ? await prisma.agent.findMany({
          where: { ipAddress: { in: hosts.map((h) => h.ipAddress) } },
          select: { id: true, ipAddress: true },
        })
      : [];
  const agentIdByIp = new Map(matchedAgents.map((a) => [a.ipAddress as string, a.id]));

  if (hosts.length > 0) {
    await prisma.discoveredHost.createMany({
      data: hosts.map((h) => ({
        scanRunId,
        ipAddress: h.ipAddress,
        macAddress: h.macAddress,
        hostname: h.hostname,
        openPorts: JSON.stringify(h.openPorts),
        responseTimeMs: h.responseTimeMs,
        matchedAgentId: agentIdByIp.get(h.ipAddress) ?? null,
      })),
    });
  }

  await prisma.networkScanRun.update({
    where: { id: scanRunId },
    data: {
      status: "SUCCESS",
      hostsScanned: hostsScannedCount,
      hostsFound: hosts.length,
      completedAt: new Date(),
    },
  });
}

async function finalizeFailedRun(scanRunId: string, errorMessage: string): Promise<void> {
  await prisma.networkScanRun.update({
    where: { id: scanRunId },
    data: { status: "FAILED", errorMessage, completedAt: new Date() },
  });
}

// Exported so networkVlan.service.ts's triggerVlanScan() can reuse this exact,
// already-working server-side path for VLANs with no assigned agent, unmodified.
export async function runNetworkScan(scanRunId: string, cidr: string): Promise<void> {
  try {
    const ips = expandCidr(cidr);

    const pingResults = await pingSweep(ips);
    const responders: HostProbeResult[] = ips
      .filter((ip) => pingResults.has(ip))
      .map((ip) => ({ ipAddress: ip, responseTimeMs: pingResults.get(ip)! }));

    const [arpTable, enrichedHosts] = await Promise.all([
      getArpTable(),
      runWithConcurrency(responders, HOST_CONCURRENCY, async (host) => {
        const [openPorts, hostname] = await Promise.all([
          probeCommonPorts(host.ipAddress),
          resolveHostname(host.ipAddress),
        ]);
        return { ...host, openPorts, hostname };
      }),
    ]);

    const hostsWithMac: DiscoveredHostResult[] = enrichedHosts.map((h) => ({
      ipAddress: h.ipAddress,
      macAddress: arpTable.get(h.ipAddress) ?? null,
      hostname: h.hostname,
      openPorts: h.openPorts,
      responseTimeMs: h.responseTimeMs,
    }));

    await finalizeSuccessfulRun(scanRunId, ips.length, hostsWithMac);
  } catch (err) {
    logger.error({ err, scanRunId }, "Network scan failed");
    await finalizeFailedRun(scanRunId, err instanceof Error ? err.message : String(err));
  }
}

// Agent-dispatched counterpart to runNetworkScan() — called when the agent posts its
// result back. Never expected to be called for a run that isn't actually assigned to this
// agent; ownership is checked via the run's own agentId (set at trigger time), not the
// ephemeral NetworkScanTask row, since that's the durable historical fact.
export async function recordNetworkScanTaskResult(
  taskId: string,
  agentId: string,
  payload: NetworkScanTaskResultPayload,
): Promise<void> {
  const task = await prisma.networkScanTask.findUnique({ where: { id: taskId }, include: { scanRun: true } });
  if (!task || task.scanRun.agentId !== agentId) {
    throw new NetworkScanTaskNotOwnedError("Network scan task not found for this agent");
  }

  if (payload.status === "SUCCESS") {
    await finalizeSuccessfulRun(task.scanRunId, payload.hostsScanned, payload.hosts);
  } else {
    await finalizeFailedRun(task.scanRunId, payload.errorMessage ?? "Scan failed on agent");
  }

  await prisma.networkScanTask.update({
    where: { id: taskId },
    data: { status: payload.status, completedAt: new Date(payload.completedAt) },
  });
}

// Legacy/ad-hoc entry point: a raw manual CIDR, always server-side (agentId stays null).
// Kept for any existing scripted/API use — the console now drives scans through VLANs
// (networkVlan.service.ts's triggerVlanScan), which sources cidr from a saved VLAN instead.
export async function startScan(cidr: string | undefined, adminId: string): Promise<{ id: string }> {
  const existingRunning = await prisma.networkScanRun.findFirst({
    where: { status: { in: ["PENDING", "RUNNING"] }, agentId: null },
  });
  if (existingRunning) {
    throw new ScanAlreadyRunningError(existingRunning.id);
  }

  const resolvedCidr = cidr?.trim() || getSuggestedCidr();
  expandCidr(resolvedCidr); // validates + enforces the size guard before creating the run row

  const run = await prisma.networkScanRun.create({
    data: { cidr: resolvedCidr, triggeredByAdminId: adminId, agentId: null },
  });

  // Detached — a /22 scan can take several seconds, must not risk an HTTP timeout.
  // The console polls scan-run status instead of awaiting this request.
  void runNetworkScan(run.id, resolvedCidr);

  return { id: run.id };
}

function serializeRun(r: {
  id: string;
  cidr: string;
  status: string;
  hostsScanned: number;
  hostsFound: number;
  startedAt: Date;
  completedAt: Date | null;
  vlanId: string | null;
  vlanNameSnapshot: string | null;
  agentId: string | null;
  vlan?: { name: string } | null;
}) {
  return {
    id: r.id,
    cidr: r.cidr,
    status: r.status,
    hostsScanned: r.hostsScanned,
    hostsFound: r.hostsFound,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    vlanId: r.vlanId,
    vlanName: r.vlan?.name ?? r.vlanNameSnapshot ?? null,
    agentId: r.agentId,
  };
}

// filter.vlanId: omit for all runs (today's behavior), a string to scope to one VLAN, or
// `null` explicitly to list only legacy/manual runs that predate this feature (vlanId IS NULL).
export async function listScanRuns(filter?: { vlanId?: string | null }) {
  const runs = await prisma.networkScanRun.findMany({
    where: filter && "vlanId" in filter ? { vlanId: filter.vlanId } : undefined,
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { vlan: { select: { name: true } } },
  });
  const hostnameByAgentId = await resolveAgentHostnames(runs.map((r) => r.agentId));

  return runs.map((r) => ({
    ...serializeRun(r),
    agentHostname: r.agentId ? (hostnameByAgentId.get(r.agentId) ?? "(agent deleted)") : null,
  }));
}

export async function getScanRun(id: string) {
  const run = await prisma.networkScanRun.findUnique({
    where: { id },
    include: {
      vlan: { select: { name: true } },
      hosts: {
        include: {
          matchedAgent: { select: { id: true, hostname: true, inventory: { select: { lastLoggedOnUser: true } } } },
        },
      },
    },
  });
  if (!run) return null;

  const hostnameByAgentId = await resolveAgentHostnames([run.agentId]);

  return {
    ...serializeRun(run),
    agentHostname: run.agentId ? (hostnameByAgentId.get(run.agentId) ?? "(agent deleted)") : null,
    errorMessage: run.errorMessage,
    hosts: run.hosts
      .map((h) => ({
        id: h.id,
        ipAddress: h.ipAddress,
        macAddress: h.macAddress,
        hostname: h.hostname,
        openPorts: JSON.parse(h.openPorts) as number[],
        responseTimeMs: h.responseTimeMs,
        matchedAgent: h.matchedAgent
          ? {
              id: h.matchedAgent.id,
              hostname: h.matchedAgent.hostname,
              // Only ever sourced from an enrolled agent's own inventory report — never
              // queried remotely from an unmanaged host, which would need credentials.
              lastLoggedOnUser: h.matchedAgent.inventory?.lastLoggedOnUser ?? null,
            }
          : null,
      }))
      .sort((a, b) => ipToInt(a.ipAddress) - ipToInt(b.ipAddress)),
  };
}
