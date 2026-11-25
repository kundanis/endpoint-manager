import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";

// Simulates Windows agents (0.2.39) against an Endpoint IQ server: the same requests at the same
// intervals, measured. Test agents are enrolled with the customer's enrollment token, named
// LOADTEST-0001..., and remove themselves at the end through the agent's own "uninstalled" call,
// which deletes the endpoint and everything it reported (and frees its licence seat).

export const AGENT_VERSION = "0.2.39";
const SEC = 1000;

export interface Options {
  server: string;
  token?: string;
  steps: number[]; // endpoints at each step, ascending
  stepMinutes: number;
  rampSeconds: number;
  pollSeconds: number;
  reports: boolean;
  insecure: boolean;
  enrollParallel: number;
  stateFile: string;
  keepAgents: boolean;
  log: (line: string) => void;
}

// ---- HTTP -----------------------------------------------------------------------------------

export interface Reply {
  status: number; // 0 = no answer (refused, timed out, reset, certificate)
  body: unknown;
  error?: string;
  bytesIn: number;
  bytesOut: number;
}

export class Http {
  private url: URL;
  private isHttps: boolean;
  private agent: http.Agent;
  newConnections = 0;

  constructor(server: string, insecure: boolean, maxSockets: number) {
    this.url = new URL(server);
    this.isHttps = this.url.protocol === "https:";
    this.agent = this.isHttps
      ? new https.Agent({ keepAlive: true, maxSockets, rejectUnauthorized: !insecure })
      : new http.Agent({ keepAlive: true, maxSockets });
  }

  request(method: string, path: string, headers: Record<string, string>, body?: unknown, timeoutMs = 15_000): Promise<Reply> {
    return new Promise((resolve) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = (this.isHttps ? https : http).request(
        {
          protocol: this.url.protocol,
          hostname: this.url.hostname,
          port: this.url.port || (this.isHttps ? 443 : 80),
          path,
          method,
          agent: this.agent,
          timeout: timeoutMs,
          headers: {
            ...headers,
            "User-Agent": "EndpointIQ-LoadTest",
            "X-EM-Nonce": crypto.randomBytes(16).toString("hex"),
            ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks);
            const text = raw.toString("utf8");
            let parsed: unknown = null;
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch {
              parsed = text.slice(0, 300);
            }
            resolve({ status: res.statusCode ?? 0, body: parsed, bytesIn: raw.length, bytesOut: payload?.length ?? 0 });
          });
          res.on("error", (e) => resolve({ status: 0, body: null, error: e.message, bytesIn: 0, bytesOut: payload?.length ?? 0 }));
        },
      );
      req.on("socket", (s: import("node:net").Socket & { emSeen?: boolean }) => {
        if (!s.emSeen) {
          s.emSeen = true;
          this.newConnections++;
        }
      });
      req.on("timeout", () => req.destroy(new Error("timed out after " + timeoutMs / 1000 + " s")));
      req.on("error", (e: NodeJS.ErrnoException) => resolve({ status: 0, body: null, error: e.code ?? e.message, bytesIn: 0, bytesOut: payload?.length ?? 0 }));
      if (payload) req.write(payload);
      req.end();
    });
  }

  close() {
    this.agent.destroy();
  }
}

// ---- Measurements ---------------------------------------------------------------------------

const RESERVOIR = 20_000;

export class Bucket {
  count = 0;
  errors = 0;
  timeouts = 0;
  bytesIn = 0;
  bytesOut = 0;
  statuses = new Map<string, number>();
  errorSamples = new Map<string, number>();
  samples: number[] = [];
  private seen = 0;

  add(ms: number, r: Reply) {
    this.count++;
    this.bytesIn += r.bytesIn;
    this.bytesOut += r.bytesOut;
    const key = r.status === 0 ? `no answer (${r.error ?? "error"})` : String(r.status);
    this.statuses.set(key, (this.statuses.get(key) ?? 0) + 1);
    if (r.status === 0) this.timeouts++;
    if (r.status === 0 || r.status >= 400) {
      this.errors++;
      if (r.status >= 400) {
        const msg = `HTTP ${r.status}: ${typeof r.body === "object" && r.body && "error" in r.body ? String((r.body as { error: unknown }).error).slice(0, 160) : String(r.body ?? "").slice(0, 160)}`;
        if (this.errorSamples.size < 20 || this.errorSamples.has(msg)) this.errorSamples.set(msg, (this.errorSamples.get(msg) ?? 0) + 1);
      }
    }
    this.seen++;
    if (this.samples.length < RESERVOIR) this.samples.push(ms);
    else {
      const j = Math.floor(Math.random() * this.seen);
      if (j < RESERVOIR) this.samples[j] = ms;
    }
  }
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export interface LatencySummary {
  requests: number;
  perSecond: number;
  errors: number;
  timeouts: number;
  errorRate: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  kbInPerSecond: number;
  kbOutPerSecond: number;
}

export function summarize(buckets: Bucket[], seconds: number): LatencySummary {
  const samples = buckets.flatMap((b) => b.samples).sort((a, b) => a - b);
  const requests = buckets.reduce((n, b) => n + b.count, 0);
  const errors = buckets.reduce((n, b) => n + b.errors, 0);
  const s = Math.max(seconds, 0.001);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    requests,
    perSecond: r1(requests / s),
    errors,
    timeouts: buckets.reduce((n, b) => n + b.timeouts, 0),
    errorRate: requests ? Math.round((10000 * errors) / requests) / 100 : 0,
    p50: Math.round(percentile(samples, 50)),
    p90: Math.round(percentile(samples, 90)),
    p95: Math.round(percentile(samples, 95)),
    p99: Math.round(percentile(samples, 99)),
    max: Math.round(samples[samples.length - 1] ?? 0),
    mean: samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0,
    kbInPerSecond: r1(buckets.reduce((n, b) => n + b.bytesIn, 0) / 1024 / s),
    kbOutPerSecond: r1(buckets.reduce((n, b) => n + b.bytesOut, 0) / 1024 / s),
  };
}

export interface RouteRow extends LatencySummary {
  route: string;
  statuses: Record<string, number>;
}

export function routeRows(map: Map<string, Bucket>, seconds: number): RouteRow[] {
  return [...map.entries()]
    .map(([route, b]) => ({ route, ...summarize([b], seconds), statuses: Object.fromEntries(b.statuses) }))
    .sort((a, b) => b.requests - a.requests);
}

// ---- Server figures (GET /api/agent/server-load, server 1.0.36+) -------------------------------

export interface ServerLoadSample {
  sampledAt: string;
  windowSeconds: number;
  host: { platform: string; cpuCount: number; cpuPercent: number | null; memoryTotalMb: number; memoryUsedMb: number; loadAverage: number[] };
  process: { cpuPercent: number | null; rssMb: number; heapUsedMb: number; eventLoopDelayMeanMs: number | null; eventLoopDelayP99Ms: number | null; uptimeSeconds: number; nodeVersion: string };
  requests: { perSecond: number | null; inFlight: number };
  database: { pingMs: number | null; edition: string | null; dataMb: number | null; logMb: number | null };
  agents: { total: number | null };
}

// ---- Enrollment and clean-up ---------------------------------------------------------------

export interface Identity {
  n: number;
  hostname: string;
  agentId: string;
  apiKey: string;
}

interface StateFile {
  server: string;
  agents: Identity[];
}

export function readState(file: string): StateFile | null {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as StateFile;
    return Array.isArray(s.agents) ? s : null;
  } catch {
    return null;
  }
}

function writeState(file: string, server: string, agents: Identity[]) {
  if (agents.length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.writeFileSync(file, JSON.stringify({ server, agents }, null, 2), { mode: 0o600 });
}

function macFor(n: number): string {
  // Locally administered addresses (02:...): can never match a real network card.
  return ["02", "4c", "54", (n >> 16) & 255, (n >> 8) & 255, n & 255].map((p) => (typeof p === "string" ? p : p.toString(16).padStart(2, "0"))).join(":");
}

export interface EnrollmentResult {
  enrolled: number;
  reused: number;
  seconds: number;
  msPerEnrollment: number;
  problem: string | null;
}

export async function enrollAgents(opts: Options, client: Http, count: number): Promise<{ agents: Identity[]; result: EnrollmentResult }> {
  const state = readState(opts.stateFile);
  const have = state && state.server === opts.server ? state.agents : [];
  const known = new Set(have.map((a) => a.n));
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !known.has(n));
  const list = [...have];
  const started = Date.now();
  let enrolled = 0;
  let next = 0;
  let problem: string | null = null;
  let totalMs = 0;
  if (missing.length > 0) {
    if (!opts.token) throw new Error(`${missing.length} test endpoint(s) need enrolling - an enrollment token is required.`);
    opts.log(`Enrolling ${missing.length} test endpoint(s), ${opts.enrollParallel} at a time...`);
  }
  const worker = async () => {
    while (!problem && next < missing.length) {
      const n = missing[next++];
      const hostname = `LOADTEST-${String(n).padStart(4, "0")}`;
      const t0 = performance.now();
      const r = await client.request("POST", "/api/agent/enroll", {}, {
        enrollmentToken: opts.token,
        hostname,
        osPlatform: "win32",
        osVersion: "10.0.26100",
        osArch: "x64",
        agentVersion: AGENT_VERSION,
        serialNumber: `LOADTEST-${n}`,
        macAddress: macFor(n),
      });
      totalMs += performance.now() - t0;
      if (r.status === 201) {
        const b = r.body as { agentId: string; apiKey: string };
        list.push({ n, hostname, agentId: b.agentId, apiKey: b.apiKey });
        enrolled++;
        if (enrolled % 25 === 0) writeState(opts.stateFile, opts.server, list);
        if (enrolled % 100 === 0 || enrolled === missing.length) opts.log(`  enrolled ${enrolled}/${missing.length}`);
      } else {
        const why = typeof r.body === "object" && r.body && "error" in r.body ? String((r.body as { error: unknown }).error) : r.error ?? "";
        problem =
          r.status === 429
            ? `The server's enrollment limit was reached after ${enrolled} endpoint(s). It allows AGENT_ENROLL_RATE_LIMIT enrollments per 15 minutes from one address (default 20). Raise it in the server's .env for the test (server 1.0.36+), or test with the endpoints already enrolled.`
            : r.status === 403
              ? `The server refused enrollment: ${why}. The test needs as many free licences as test endpoints.`
              : r.status === 401
                ? `The enrollment token was refused (${why}). Create a token with enough uses on Enrollment Tokens.`
                : `Enrollment failed: ${r.status ? "HTTP " + r.status : "no answer"} ${why}`;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.enrollParallel) }, worker));
  writeState(opts.stateFile, opts.server, list);
  const seconds = (Date.now() - started) / 1000;
  return {
    agents: list.filter((a) => a.n <= count).sort((a, b) => a.n - b.n),
    result: { enrolled, reused: have.filter((a) => a.n <= count).length, seconds: Math.round(seconds), msPerEnrollment: enrolled ? Math.round(totalMs / enrolled) : 0, problem },
  };
}

// Removes test endpoints through the agent's own "uninstalled" call: the server deletes the
// endpoint with everything it reported and frees its licence seat.
export async function removeAgents(server: string, stateFile: string, client: Http, agents: Identity[], log: (s: string) => void): Promise<{ removed: number; failed: number }> {
  const left = new Map(agents.map((a) => [a.n, a]));
  let removed = 0;
  let failed = 0;
  let next = 0;
  const queue = [...agents];
  const worker = async () => {
    while (next < queue.length) {
      const a = queue[next++];
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const r = await client.request("POST", "/api/agent/uninstalled", { "X-Agent-Id": a.agentId, "X-Agent-Key": a.apiKey });
        // 401 = the server no longer knows it (already removed)
        ok = r.status === 204 || r.status === 200 || r.status === 401;
      }
      if (ok) {
        removed++;
        left.delete(a.n);
      } else failed++;
      if ((removed + failed) % 200 === 0) writeState(stateFile, server, [...left.values()]);
    }
  };
  await Promise.all(Array.from({ length: 25 }, worker));
  const others = (readState(stateFile)?.agents ?? []).filter((a) => !agents.some((b) => b.n === a.n));
  writeState(stateFile, server, [...others, ...left.values()]);
  log(`Removed ${removed} test endpoint(s)${failed ? `, ${failed} could not be removed (run the tool again to retry)` : ""}.`);
  return { removed, failed };
}

// ---- The run --------------------------------------------------------------------------------

export interface TimelinePoint {
  t: number; // seconds since start
  step: number;
  agents: number;
  perSecond: number;
  issuedPerSecond: number;
  p50: number;
  p95: number;
  p99: number;
  errors: number;
  timeouts: number;
  inFlight: number;
  generatorCpuPercent: number;
  generatorLagP99Ms: number;
  server: ServerLoadSample | null;
}

export interface StepResult {
  step: number;
  agents: number;
  measuredSeconds: number;
  expectedPerSecond: number;
  issuedPerSecond: number;
  overall: LatencySummary;
  routes: RouteRow[];
  maxInFlight: number;
  server: {
    samples: number;
    hostCpuAvg: number | null;
    hostCpuMax: number | null;
    processCpuAvg: number | null;
    processCpuMax: number | null;
    memoryUsedMaxMb: number | null;
    processRssMaxMb: number | null;
    loopLagP99Max: number | null;
    dbPingAvg: number | null;
    dbPingMax: number | null;
    serverPerSecondAvg: number | null;
  } | null;
  generator: { cpuMax: number; lagP99Max: number };
}

export interface RunResult {
  startedAt: string;
  finishedAt: string;
  stoppedEarly: boolean;
  seconds: number;
  steps: StepResult[];
  timeline: TimelinePoint[];
  total: { overall: LatencySummary; routes: RouteRow[]; errorSamples: Record<string, number> };
  serverMetricsAvailable: boolean;
  serverFirst: ServerLoadSample | null;
  serverLast: ServerLoadSample | null;
  newConnections: number;
}

interface SimAgent extends Identity {
  ip: string;
  mac: string;
  user: string;
  timers: NodeJS.Timeout[];
}

// Requests per second one agent makes without any policy assigned (sync results come on top
// when policies are assigned). Used to show whether the tool kept up.
export function baseRatePerAgent(pollSeconds: number, reports: boolean): number {
  return 1 / pollSeconds + 8 / 20 + 1 / 30 + 3 / 60 + 2 / 300 + (reports ? 1 / 300 : 0);
}

export async function runLoad(opts: Options, client: Http, agents: Identity[], stop: { requested: boolean }): Promise<RunResult> {
  const sims: SimAgent[] = agents.map((a) => ({
    ...a,
    ip: `10.${100 + ((a.n >> 16) & 63)}.${(a.n >> 8) & 255}.${a.n & 255}`,
    mac: macFor(a.n),
    user: `LOADTEST\\user${String(a.n).padStart(4, "0")}`,
    timers: [],
  }));

  const total = new Map<string, Bucket>();
  let stepRoutes: Map<string, Bucket> | null = null;
  let windowBucket = new Bucket();
  let issued = 0;
  let completed = 0;
  let windowIssued = 0;
  let stepIssued = 0;
  let stepMaxInFlight = 0;

  const call = async (agent: SimAgent, method: string, path: string, route: string, body?: unknown): Promise<Reply> => {
    issued++;
    windowIssued++;
    if (stepRoutes) stepIssued++;
    const t0 = performance.now();
    const r = await client.request(method, path, { "X-Agent-Id": agent.agentId, "X-Agent-Key": agent.apiKey }, body);
    const ms = performance.now() - t0;
    completed++;
    for (const m of stepRoutes ? [total, stepRoutes] : [total]) {
      let b = m.get(route);
      if (!b) m.set(route, (b = new Bucket()));
      b.add(ms, r);
    }
    windowBucket.add(ms, r);
    return r;
  };

  const hasPolicies = (body: unknown) => {
    const ids = (body as { policyIds?: unknown[] } | null)?.policyIds;
    return Array.isArray(ids) && ids.length > 0;
  };
  const policyIds = (body: unknown) => (body as { policyIds: string[] }).policyIds;

  const every = (a: SimAgent, ms: number, fn: () => Promise<void>) => {
    const tick = () => {
      if (!stop.requested) fn().catch(() => undefined);
    };
    a.timers.push(
      setTimeout(() => {
        tick();
        a.timers.push(setInterval(tick, ms));
      }, Math.random() * ms),
    );
  };

  const start = (a: SimAgent) => {
    every(a, opts.pollSeconds * SEC, async () => {
      await call(a, "POST", "/api/agent/checkin", "Check-in", { ipAddress: a.ip, macAddress: a.mac, agentVersion: AGENT_VERSION, signedInUsers: [a.user] });
    });
    every(a, 20 * SEC, async () => {
      await call(a, "GET", "/api/agent/app-control/assigned", "App Control: policy");
      await call(a, "POST", "/api/agent/app-control/scan-result", "App Control: sync result", { status: "APPLIED", errorMessage: null, events: [] });
    });
    every(a, 20 * SEC, async () => {
      const r = await call(a, "GET", "/api/agent/web-block/assigned", "Web Control: policy");
      if (hasPolicies(r.body)) await call(a, "POST", "/api/agent/web-block/sync-result", "Web Control: sync result", { policyIds: policyIds(r.body), status: "SUCCESS", errorMessage: null });
    });
    every(a, 20 * SEC, async () => {
      const r = await call(a, "GET", "/api/agent/command-block/assigned", "Command Control: policy");
      const rules = (r.body as { rules?: unknown[] } | null)?.rules;
      if (Array.isArray(rules) && rules.length > 0) await call(a, "POST", "/api/agent/command-block/scan-result", "Command Control: sync result", { status: "SUCCESS", errorMessage: null });
    });
    every(a, 20 * SEC, async () => {
      const r = await call(a, "GET", "/api/agent/ip-block/assigned", "IP Control: policy");
      if (hasPolicies(r.body)) await call(a, "POST", "/api/agent/ip-block/sync-result", "IP Control: sync result", { policyIds: policyIds(r.body), status: "SUCCESS", errorMessage: null });
    });
    every(a, 20 * SEC, async () => {
      const r = await call(a, "GET", "/api/agent/usb-control/assigned", "USB Control: policy");
      if (hasPolicies(r.body)) await call(a, "POST", "/api/agent/usb-control/sync-result", "USB Control: sync result", { policyIds: policyIds(r.body), status: "SUCCESS", errorMessage: null });
    });
    every(a, 20 * SEC, async () => {
      const r = await call(a, "GET", "/api/agent/screenshot-block/assigned", "Screenshot Control: policy");
      if (hasPolicies(r.body)) await call(a, "POST", "/api/agent/screenshot-block/report", "Screenshot Control: sync result", { policyIds: policyIds(r.body), status: "SUCCESS", errorMessage: null, events: [] });
    });
    every(a, 20 * SEC, async () => {
      await call(a, "GET", "/api/agent/dlp/assigned", "DLP: policy");
    });
    every(a, 30 * SEC, async () => {
      await call(a, "GET", "/api/agent/edr/enabled", "EDR: status");
    });
    every(a, 60 * SEC, async () => {
      await call(a, "GET", "/api/agent/consent", "User consent");
    });
    every(a, 60 * SEC, async () => {
      await call(a, "GET", "/api/agent/screen-capture/assigned", "Screen capture: policy");
    });
    every(a, 60 * SEC, async () => {
      await call(a, "GET", "/api/agent/data-movement/assigned", "Data movement: policy");
    });
    every(a, 300 * SEC, async () => {
      await call(a, "GET", "/api/agent/ai-guard/assigned", "AI Guard: policy");
    });
    every(a, 300 * SEC, async () => {
      await call(a, "GET", "/api/agent/threat-protection/assigned", "Threat Protection: policy");
    });
    if (opts.reports) {
      // Time per application (tray app report). Removed with the endpoint at the end.
      every(a, 300 * SEC, async () => {
        await call(a, "POST", "/api/agent/user-productivity/app-usage", "Productivity: app usage report", {
          username: a.user,
          items: [
            { kind: "APP", key: "loadtest-app.exe", label: "Load test application", seconds: 240 },
            { kind: "WEB", key: "loadtest.invalid", label: "loadtest.invalid", seconds: 60 },
          ],
        });
      });
    }
  };

  // Server figures through the first test agent.
  const probe = sims[0];
  let serverMetricsAvailable = true;
  const readServer = async (): Promise<ServerLoadSample | null> => {
    if (!serverMetricsAvailable || !probe) return null;
    const r = await client.request("GET", "/api/agent/server-load", { "X-Agent-Id": probe.agentId, "X-Agent-Key": probe.apiKey }, undefined, 10_000);
    if (r.status === 404) {
      serverMetricsAvailable = false;
      opts.log("This server version doesn't report its CPU/memory/database figures (needs 1.0.36+) - measuring response times only.");
      return null;
    }
    return r.status === 200 ? (r.body as ServerLoadSample) : null;
  };

  const serverFirst = await readServer();
  const startedAt = new Date();
  const t0 = Date.now();
  const timeline: TimelinePoint[] = [];
  const stepServer: ServerLoadSample[] = [];
  const stepGen = { cpuMax: 0, lagP99Max: 0 };

  // Load generator health: if this PC is the bottleneck, the results understate the server.
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  let lastCpu = process.cpuUsage();
  let lastTick = Date.now();
  let currentStep = 0;
  let running = 0;
  let lastServer: ServerLoadSample | null = serverFirst;

  const sampleTimeline = async () => {
    const now = Date.now();
    const secs = (now - lastTick) / 1000;
    const cpu = process.cpuUsage();
    const genCpu = Math.round((cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000 / (secs * 10));
    const genLag = Math.max(0, Math.round(lag.percentile(99) / 1e6 - 10)); // minus the sampling interval
    lag.reset();
    lastCpu = cpu;
    lastTick = now;
    const s = summarize([windowBucket], secs);
    const issuedPs = Math.round((windowIssued / secs) * 10) / 10;
    windowBucket = new Bucket();
    windowIssued = 0;
    const server = await readServer();
    if (server) lastServer = server;
    if (stepRoutes) {
      if (server) stepServer.push(server);
      stepGen.cpuMax = Math.max(stepGen.cpuMax, genCpu);
      stepGen.lagP99Max = Math.max(stepGen.lagP99Max, genLag);
    }
    const point: TimelinePoint = {
      t: Math.round((now - t0) / 1000),
      step: currentStep,
      agents: running,
      perSecond: s.perSecond,
      issuedPerSecond: issuedPs,
      p50: s.p50,
      p95: s.p95,
      p99: s.p99,
      errors: s.errors,
      timeouts: s.timeouts,
      inFlight: issued - completed,
      generatorCpuPercent: genCpu,
      generatorLagP99Ms: genLag,
      server,
    };
    timeline.push(point);
    if (stepRoutes) stepMaxInFlight = Math.max(stepMaxInFlight, point.inFlight);
    const srv = server ? `  server CPU ${server.host.cpuPercent ?? "-"}%  app ${server.process.cpuPercent ?? "-"}%  DB ${server.database.pingMs ?? "-"} ms` : "";
    opts.log(
      `[${fmtClock(point.t)}] ${running} endpoints  ${s.perSecond} req/s  p95 ${s.p95} ms  p99 ${s.p99} ms  errors ${s.errors}  in flight ${point.inFlight}${srv}`,
    );
  };

  let sampling = false;
  const ticker = setInterval(() => {
    if (sampling) return;
    sampling = true;
    sampleTimeline().finally(() => (sampling = false));
  }, 10 * SEC);

  const wait = async (ms: number) => {
    const until = Date.now() + ms;
    while (!stop.requested && Date.now() < until) await new Promise((r) => setTimeout(r, Math.min(500, until - Date.now())));
  };

  const steps: StepResult[] = [];
  for (let i = 0; i < opts.steps.length && !stop.requested; i++) {
    currentStep = i + 1;
    const target = Math.min(opts.steps[i], sims.length);
    const from = running;
    opts.log(`Step ${currentStep}/${opts.steps.length}: ${target} endpoints (starting ${target - from} more over ${opts.rampSeconds} s)`);
    for (let k = from; k < target; k++) {
      const a = sims[k];
      setTimeout(() => {
        if (!stop.requested) {
          start(a);
          running++;
        }
      }, ((k - from) / Math.max(1, target - from)) * opts.rampSeconds * SEC);
    }
    await wait(opts.rampSeconds * SEC + 5 * SEC);
    if (stop.requested) break;
    // Measure the steady state only.
    stepRoutes = new Map();
    stepIssued = 0;
    stepMaxInFlight = issued - completed;
    stepServer.length = 0;
    stepGen.cpuMax = 0;
    stepGen.lagP99Max = 0;
    const m0 = Date.now();
    await wait(opts.stepMinutes * 60 * SEC);
    const measured = (Date.now() - m0) / 1000;
    const routes = stepRoutes;
    stepRoutes = null;
    if (measured < 20) break;
    steps.push({
      step: currentStep,
      agents: target,
      measuredSeconds: Math.round(measured),
      expectedPerSecond: Math.round(target * baseRatePerAgent(opts.pollSeconds, opts.reports) * 10) / 10,
      issuedPerSecond: Math.round((stepIssued / measured) * 10) / 10,
      overall: summarize([...routes.values()], measured),
      routes: routeRows(routes, measured),
      maxInFlight: stepMaxInFlight,
      server: summarizeServer(stepServer),
      generator: { ...stepGen },
    });
    const st = steps[steps.length - 1];
    opts.log(`Step ${currentStep} done: ${st.overall.perSecond} req/s, p95 ${st.overall.p95} ms, errors ${st.overall.errorRate}%`);
  }

  clearInterval(ticker);
  for (const a of sims) a.timers.forEach((t) => clearTimeout(t));
  lag.disable();
  // Let requests already sent finish (up to the 15 s timeout).
  const drainUntil = Date.now() + 16 * SEC;
  while (issued > completed && Date.now() < drainUntil) await new Promise((r) => setTimeout(r, 200));

  const seconds = (Date.now() - t0) / 1000;
  const errorSamples: Record<string, number> = {};
  for (const b of total.values()) for (const [k, v] of b.errorSamples) errorSamples[k] = (errorSamples[k] ?? 0) + v;
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    stoppedEarly: stop.requested,
    seconds: Math.round(seconds),
    steps,
    timeline,
    total: { overall: summarize([...total.values()], seconds), routes: routeRows(total, seconds), errorSamples },
    serverMetricsAvailable,
    serverFirst,
    serverLast: lastServer,
    newConnections: client.newConnections,
  };
}

function summarizeServer(samples: ServerLoadSample[]): StepResult["server"] {
  if (samples.length === 0) return null;
  const nums = (f: (s: ServerLoadSample) => number | null) => samples.map(f).filter((v): v is number => typeof v === "number");
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  const max = (a: number[]) => (a.length ? Math.max(...a) : null);
  return {
    samples: samples.length,
    hostCpuAvg: avg(nums((s) => s.host.cpuPercent)),
    hostCpuMax: max(nums((s) => s.host.cpuPercent)),
    processCpuAvg: avg(nums((s) => s.process.cpuPercent)),
    processCpuMax: max(nums((s) => s.process.cpuPercent)),
    memoryUsedMaxMb: max(nums((s) => s.host.memoryUsedMb)),
    processRssMaxMb: max(nums((s) => s.process.rssMb)),
    loopLagP99Max: max(nums((s) => s.process.eventLoopDelayP99Ms)),
    dbPingAvg: avg(nums((s) => s.database.pingMs)),
    dbPingMax: max(nums((s) => s.database.pingMs)),
    serverPerSecondAvg: avg(nums((s) => s.requests.perSecond)),
  };
}

export function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

export function generatorInfo() {
  return { hostname: os.hostname(), platform: `${os.platform()} ${os.release()}`, cpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? "", memoryMb: Math.round(os.totalmem() / 1024 / 1024), node: process.version };
}
