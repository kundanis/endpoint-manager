import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import dgram from "node:dgram";
import dns from "node:dns";
import fs from "node:fs/promises";
import { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import type { AxiosInstance } from "axios";
import type { DiscoveredHostResult, NetworkScanTaskResultPayload, NetworkScanTaskWire } from "@em/shared";
import { MIN_NETWORK_SCAN_PREFIX_LENGTH } from "@em/shared";

const execFileAsync = promisify(execFile);

// Ported from packages/server/src/services/networkScan.service.ts (the server-side scan
// path) — the same ping sweep / ARP / port probe / hostname resolution logic, run here so
// a VLAN's assigned agent can reach subnets the server itself can't. Kept as a separate
// copy rather than a shared @em/shared module: that package's compiled barrel is one flat
// `export *`, and pulling in a file that does Node child_process/socket I/O risks the same
// Vite/Rollup CJS-interop landmine that broke a prior runtime-constant import into console.

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

function expandCidr(cidr: string): string[] {
  const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!match) throw new Error(`Invalid CIDR notation: ${cidr}`);

  const [, base, prefixStr] = match;
  const prefix = Number(prefixStr);
  if (prefix < 0 || prefix > 32) throw new Error(`Invalid CIDR prefix: /${prefix}`);
  if (prefix < MIN_NETWORK_SCAN_PREFIX_LENGTH) {
    throw new Error(`CIDR range too large — must be /${MIN_NETWORK_SCAN_PREFIX_LENGTH} or smaller (max 1024 addresses)`);
  }

  const baseInt = ipToInt(base);
  const hostBits = 32 - prefix;
  const size = 2 ** hostBits;
  const networkInt = (baseInt & (0xffffffff << hostBits)) >>> 0;

  if (hostBits <= 1) {
    return Array.from({ length: size }, (_, i) => intToIp(networkInt + i));
  }

  const usableCount = size - 2;
  return Array.from({ length: usableCount }, (_, i) => intToIp(networkInt + 1 + i));
}

function toArray<T>(value: T[] | T | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function pingSweep(ips: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (process.platform !== "win32" || ips.length === 0) return map;

  const inputFile = path.join(os.tmpdir(), `em-vlan-scan-${randomUUID()}.txt`);
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
    console.error("VLAN scan: ping sweep failed", err);
  } finally {
    await fs.unlink(inputFile).catch(() => {});
  }

  return map;
}

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
    console.error("VLAN scan: ARP table lookup failed", err);
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

function buildNbnsNodeStatusQuery(): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(Math.floor(Math.random() * 0x10000), 0);
  header.writeUInt16BE(0x0000, 2);
  header.writeUInt16BE(0x0001, 4);
  header.writeUInt16BE(0x0000, 6);
  header.writeUInt16BE(0x0000, 8);
  header.writeUInt16BE(0x0000, 10);

  const rawName = Buffer.alloc(16, 0x00);
  rawName[0] = 0x2a;
  const encodedName = Buffer.alloc(32);
  for (let i = 0; i < 16; i++) {
    encodedName[i * 2] = 0x41 + ((rawName[i] >> 4) & 0x0f);
    encodedName[i * 2 + 1] = 0x41 + (rawName[i] & 0x0f);
  }

  const question = Buffer.concat([
    Buffer.from([0x20]),
    encodedName,
    Buffer.from([0x00]),
    Buffer.from([0x00, 0x21]),
    Buffer.from([0x00, 0x01]),
  ]);

  return Buffer.concat([header, question]);
}

function parseNbnsNodeStatusResponse(buf: Buffer): string | null {
  try {
    let offset = 12;
    if ((buf[offset] & 0xc0) === 0xc0) {
      offset += 2;
    } else {
      offset += 1 + buf[offset] + 1;
    }
    offset += 2 + 2 + 4;
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

// Never throws — any failure (bad CIDR, sweep error) is caught and turned into a FAILED
// result that still gets posted, so a run can never get silently stuck at RUNNING.
export async function runVlanNetworkScan(client: AxiosInstance, task: NetworkScanTaskWire): Promise<void> {
  let payload: NetworkScanTaskResultPayload;

  try {
    const ips = expandCidr(task.cidr);

    const pingResults = await pingSweep(ips);
    const responders = ips
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

    const hosts: DiscoveredHostResult[] = enrichedHosts.map((h) => ({
      ipAddress: h.ipAddress,
      macAddress: arpTable.get(h.ipAddress) ?? null,
      hostname: h.hostname,
      openPorts: h.openPorts,
      responseTimeMs: h.responseTimeMs,
    }));

    payload = {
      status: "SUCCESS",
      hostsScanned: ips.length,
      hosts,
      errorMessage: null,
      completedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`VLAN network scan task ${task.id} failed`, err);
    payload = {
      status: "FAILED",
      hostsScanned: 0,
      hosts: [],
      errorMessage: err instanceof Error ? err.message : String(err),
      completedAt: new Date().toISOString(),
    };
  }

  try {
    await client.post(`/api/agent/network-scans/tasks/${task.id}/result`, payload);
    console.log(`Reported VLAN network scan task ${task.id}: ${payload.status}`);
  } catch (err) {
    console.error(`Failed to report VLAN network scan task ${task.id} result`, err);
  }
}
