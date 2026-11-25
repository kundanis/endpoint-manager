import os from "node:os";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";

// How busy this server is, for the Endpoint IQ load test tool (packages/load-test): host CPU and
// memory (inside Docker these are the whole machine's, so SQL Server on the same host is
// included), this process's CPU, memory and event-loop delay, requests per second, and the
// database's response time and size. The sampler only runs while someone is reading it (it
// stops 10 minutes after the last read), so a normal deployment pays nothing for it.

const SAMPLE_MS = 5_000;
const IDLE_STOP_MS = 10 * 60_000;
const LOOP_RESOLUTION_MS = 10;

export interface ServerLoadSample {
  sampledAt: string;
  windowSeconds: number;
  host: { platform: string; cpuCount: number; cpuPercent: number | null; memoryTotalMb: number; memoryUsedMb: number; loadAverage: number[] };
  process: { cpuPercent: number | null; rssMb: number; heapUsedMb: number; eventLoopDelayMeanMs: number | null; eventLoopDelayP99Ms: number | null; uptimeSeconds: number; nodeVersion: string };
  requests: { perSecond: number | null; inFlight: number };
  database: { pingMs: number | null; edition: string | null; dataMb: number | null; logMb: number | null };
  agents: { total: number | null };
}

// ---- Request counter (always on: two integer updates per request) ----------------------------

let requestsDone = 0;
let inFlight = 0;

export function countRequests(_req: Request, res: Response, next: NextFunction) {
  inFlight++;
  let counted = false;
  const done = () => {
    if (counted) return;
    counted = true;
    inFlight--;
    requestsDone++;
  };
  res.on("finish", done);
  res.on("close", done);
  next();
}

// ---- Sampler ----------------------------------------------------------------------------------

function hostCpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
}

let timer: NodeJS.Timeout | null = null;
let lastRead = 0;
let loopDelay: IntervalHistogram | null = null;
let prev: { at: number; cpu: ReturnType<typeof hostCpuTimes>; proc: NodeJS.CpuUsage; requests: number } | null = null;
let latest: ServerLoadSample | null = null;
let edition: string | null | undefined;

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

async function databaseFigures() {
  let pingMs: number | null = null;
  let dataMb: number | null = null;
  let logMb: number | null = null;
  try {
    const started = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    pingMs = Math.round((performance.now() - started) * 10) / 10;
  } catch {
    pingMs = null;
  }
  try {
    if (edition === undefined) {
      const rows = await prisma.$queryRaw<{ edition: string }[]>`SELECT CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)) AS edition`;
      edition = rows[0]?.edition ?? null;
    }
  } catch {
    edition = null;
  }
  try {
    // size is in 8 KB pages; type 0 = data, 1 = log
    const rows = await prisma.$queryRaw<{ dataMb: number | null; logMb: number | null }[]>`
      SELECT CAST(SUM(CASE WHEN type = 0 THEN size ELSE 0 END) * 8 / 1024 AS INT) AS dataMb,
             CAST(SUM(CASE WHEN type = 1 THEN size ELSE 0 END) * 8 / 1024 AS INT) AS logMb
      FROM sys.database_files`;
    dataMb = rows[0]?.dataMb ?? null;
    logMb = rows[0]?.logMb ?? null;
  } catch {
    // not readable with this login - leave empty
  }
  return { pingMs, dataMb, logMb };
}

async function sample() {
  if (Date.now() - lastRead > IDLE_STOP_MS) return stop();
  const now = Date.now();
  const cpu = hostCpuTimes();
  const proc = process.cpuUsage();
  const before = prev;
  prev = { at: now, cpu, proc, requests: requestsDone };
  const [db, total] = await Promise.all([databaseFigures(), prisma.agent.count().catch(() => null)]);
  const seconds = before ? (now - before.at) / 1000 : 0;
  const memory = process.memoryUsage();
  const cpuTotal = before ? cpu.total - before.cpu.total : 0;
  latest = {
    sampledAt: new Date(now).toISOString(),
    windowSeconds: Math.round(seconds * 10) / 10,
    host: {
      platform: `${os.platform()} ${os.release()}`,
      cpuCount: os.cpus().length,
      cpuPercent: before && cpuTotal > 0 ? Math.round((100 * (cpuTotal - (cpu.idle - before.cpu.idle))) / cpuTotal) : null,
      memoryTotalMb: mb(os.totalmem()),
      memoryUsedMb: mb(os.totalmem() - os.freemem()),
      loadAverage: os.loadavg().map((l) => Math.round(l * 100) / 100),
    },
    process: {
      // Of one core: 100 = one core fully busy (Node runs the app on one thread).
      cpuPercent: before && seconds > 0 ? Math.round((proc.user - before.proc.user + proc.system - before.proc.system) / 1000 / (seconds * 10)) : null,
      rssMb: mb(memory.rss),
      heapUsedMb: mb(memory.heapUsed),
      // The histogram includes its own sampling interval: take it off.
      eventLoopDelayMeanMs: loopDelay ? Math.max(0, Math.round((loopDelay.mean / 1e6 - LOOP_RESOLUTION_MS) * 10) / 10) : null,
      eventLoopDelayP99Ms: loopDelay ? Math.max(0, Math.round((loopDelay.percentile(99) / 1e6 - LOOP_RESOLUTION_MS) * 10) / 10) : null,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
    },
    requests: { perSecond: before && seconds > 0 ? Math.round(((requestsDone - before.requests) / seconds) * 10) / 10 : null, inFlight },
    database: { pingMs: db.pingMs, edition: edition ?? null, dataMb: db.dataMb, logMb: db.logMb },
    agents: { total },
  };
  loopDelay?.reset();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  loopDelay?.disable();
  loopDelay = null;
  prev = null;
}

function ensureRunning() {
  lastRead = Date.now();
  if (timer) return;
  loopDelay = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  loopDelay.enable();
  timer = setInterval(() => void sample().catch(() => undefined), SAMPLE_MS);
  timer.unref();
}

// The latest sample (figures cover the last ~5 seconds). The first read starts the sampler, so it
// returns a partial sample; readers poll every 10 seconds or so.
export async function readServerLoad(): Promise<ServerLoadSample> {
  const first = !timer;
  ensureRunning();
  if (first || !latest) await sample();
  return latest!;
}
