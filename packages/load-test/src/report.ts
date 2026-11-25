import type { EnrollmentResult, RunResult, ServerLoadSample, StepResult, TimelinePoint } from "./engine";
import { fmtClock } from "./engine";

// ---- Checks ---------------------------------------------------------------------------------

export type Level = "pass" | "warn" | "fail";

export interface Check {
  name: string;
  value: string;
  target: string;
  level: Level;
  note?: string;
}

export const LIMITS = {
  p95Warn: 500,
  p95Fail: 1000,
  p99Fail: 3000,
  errorWarn: 0.5,
  errorFail: 1,
  keptUpFail: 95, // % of issued requests per second actually answered per second
  hostCpuWarn: 70,
  hostCpuFail: 85,
  appCpuWarn: 70, // % of one core (the app runs on one thread)
  appCpuFail: 90,
  loopLagWarn: 100,
  loopLagFail: 250,
  dbPingWarn: 20,
  dbPingFail: 100,
  generatorCpu: 85,
  generatorLag: 200,
};

function level(value: number, warn: number, fail: number): Level {
  return value >= fail ? "fail" : value >= warn ? "warn" : "pass";
}

export function stepChecks(s: StepResult): Check[] {
  const checks: Check[] = [];
  const o = s.overall;
  checks.push({ name: "Response time (95th percentile)", value: `${o.p95} ms`, target: `under ${LIMITS.p95Warn} ms (fail at ${LIMITS.p95Fail} ms)`, level: level(o.p95, LIMITS.p95Warn, LIMITS.p95Fail) });
  checks.push({ name: "Response time (99th percentile)", value: `${o.p99} ms`, target: `under ${LIMITS.p99Fail} ms`, level: o.p99 >= LIMITS.p99Fail ? "fail" : "pass" });
  checks.push({ name: "Errors and timeouts", value: `${o.errorRate}% (${o.errors})`, target: `under ${LIMITS.errorWarn}% (fail at ${LIMITS.errorFail}%)`, level: level(o.errorRate, LIMITS.errorWarn, LIMITS.errorFail) });
  const keptUp = s.issuedPerSecond > 0 ? Math.round((100 * o.perSecond) / s.issuedPerSecond) : 100;
  checks.push({ name: "Server kept up with requests", value: `${keptUp}% answered (${o.perSecond} of ${s.issuedPerSecond} req/s)`, target: `at least ${LIMITS.keptUpFail}%`, level: keptUp < LIMITS.keptUpFail ? "fail" : "pass" });
  if (s.server) {
    if (s.server.hostCpuAvg !== null)
      checks.push({ name: "Server CPU (whole machine, average)", value: `${s.server.hostCpuAvg}% (max ${s.server.hostCpuMax}%)`, target: `under ${LIMITS.hostCpuWarn}% (fail at ${LIMITS.hostCpuFail}%)`, level: level(s.server.hostCpuAvg, LIMITS.hostCpuWarn, LIMITS.hostCpuFail), note: "Includes SQL Server when it runs on the same machine." });
    if (s.server.processCpuAvg !== null)
      checks.push({ name: "Endpoint IQ app CPU (average)", value: `${s.server.processCpuAvg}% of one core (max ${s.server.processCpuMax}%)`, target: `under ${LIMITS.appCpuWarn}% (fail at ${LIMITS.appCpuFail}%)`, level: level(s.server.processCpuAvg, LIMITS.appCpuWarn, LIMITS.appCpuFail), note: "The app handles requests on one thread, so 100% of one core is its ceiling whatever the core count." });
    if (s.server.loopLagP99Max !== null)
      checks.push({ name: "App responsiveness (event-loop delay, worst)", value: `${s.server.loopLagP99Max} ms`, target: `under ${LIMITS.loopLagWarn} ms (fail at ${LIMITS.loopLagFail} ms)`, level: level(s.server.loopLagP99Max, LIMITS.loopLagWarn, LIMITS.loopLagFail) });
    if (s.server.dbPingAvg !== null)
      checks.push({ name: "Database response (simple query, average)", value: `${s.server.dbPingAvg} ms (max ${s.server.dbPingMax} ms)`, target: `under ${LIMITS.dbPingWarn} ms (fail at ${LIMITS.dbPingFail} ms)`, level: level(s.server.dbPingAvg, LIMITS.dbPingWarn, LIMITS.dbPingFail) });
  }
  return checks;
}

export function worst(levels: Level[]): Level {
  return levels.includes("fail") ? "fail" : levels.includes("warn") ? "warn" : "pass";
}

export function generatorLimited(s: StepResult): boolean {
  return s.generator.cpuMax >= LIMITS.generatorCpu || s.generator.lagP99Max >= LIMITS.generatorLag;
}

export interface Verdict {
  level: Level;
  headline: string;
  detail: string;
  passedEndpoints: number | null;
  estimatedCapacity: number | null;
}

export function verdict(run: RunResult): Verdict {
  if (run.steps.length === 0) return { level: "fail", headline: "No step completed", detail: "The test stopped before a step could be measured.", passedEndpoints: null, estimatedCapacity: null };
  const results = run.steps.map((s) => ({ s, level: worst(stepChecks(s).map((c) => c.level)) }));
  const passed = results.filter((r) => r.level !== "fail");
  const last = results[results.length - 1];
  const best = passed.length ? passed[passed.length - 1].s : null;
  // Rough headroom from the busiest resource of the best step (linear, capped at 3x).
  let estimate: number | null = null;
  if (best?.server) {
    const ratios: number[] = [];
    if (best.server.hostCpuAvg) ratios.push(LIMITS.hostCpuWarn / best.server.hostCpuAvg);
    if (best.server.processCpuAvg) ratios.push(LIMITS.appCpuWarn / best.server.processCpuAvg);
    if (ratios.length) estimate = Math.round((best.agents * Math.min(3, Math.max(1, Math.min(...ratios)))) / 50) * 50;
  }
  if (last.level === "pass")
    return { level: "pass", headline: `Handles ${last.s.agents} endpoints comfortably`, detail: "Every check passed at the highest load tested.", passedEndpoints: last.s.agents, estimatedCapacity: estimate };
  if (last.level === "warn")
    return { level: "warn", headline: `Handles ${last.s.agents} endpoints, close to its limit`, detail: "No check failed at the highest load, but some are near their limits - see the warnings below.", passedEndpoints: last.s.agents, estimatedCapacity: estimate };
  if (best)
    return { level: "warn", headline: `Handles ${best.agents} endpoints; struggles at ${last.s.agents}`, detail: `Checks failed at ${last.s.agents} endpoints - see the failed checks for which resource ran out.`, passedEndpoints: best.agents, estimatedCapacity: null };
  return { level: "fail", headline: `Struggles at ${run.steps[0].agents} endpoints`, detail: "Checks failed even at the lowest load tested - see the failed checks.", passedEndpoints: null, estimatedCapacity: null };
}

// ---- HTML -----------------------------------------------------------------------------------

export interface ReportInput {
  tool: string;
  settings: { server: string; steps: number[]; stepMinutes: number; rampSeconds: number; pollSeconds: number; reports: boolean; insecure: boolean };
  generator: { hostname: string; platform: string; cpuCount: number; cpuModel: string; memoryMb: number; node: string };
  enrollment: EnrollmentResult;
  run: RunResult;
  cleanup: { removed: number; failed: number; kept: boolean };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const LEVEL_LABEL: Record<Level, string> = { pass: "Pass", warn: "Warning", fail: "Fail" };
const LEVEL_ICON: Record<Level, string> = { pass: "✓", warn: "!", fail: "✕" };
const badge = (l: Level, text = LEVEL_LABEL[l]) => `<span class="badge ${l}"><span aria-hidden="true">${LEVEL_ICON[l]}</span> ${esc(text)}</span>`;
const dash = (v: unknown, unit = "") => (v === null || v === undefined ? "–" : `${v}${unit}`);

interface Series {
  title: string;
  unit: string;
  value: (p: TimelinePoint) => number | null;
  limit?: number;
}

function chart(id: string, s: Series, points: TimelinePoint[], stepStarts: { t: number; label: string }[]): string {
  const data = points.map((p) => ({ t: p.t, v: s.value(p) })).filter((d): d is { t: number; v: number } => typeof d.v === "number");
  if (data.length < 2) return `<figure class="chart"><figcaption>${esc(s.title)}</figcaption><p class="muted">No data.</p></figure>`;
  const W = 560;
  const H = 180;
  const L = 48;
  const R = 12;
  const T = 14;
  const B = 26;
  const tMax = Math.max(...data.map((d) => d.t));
  const vMaxRaw = Math.max(...data.map((d) => d.v), s.limit ?? 0, 1);
  const step = niceStep(vMaxRaw / 4);
  const vMax = Math.ceil(vMaxRaw / step) * step;
  const x = (t: number) => L + (t / Math.max(tMax, 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / vMax) * (H - T - B);
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join("");
  const grid: string[] = [];
  for (let v = 0; v <= vMax + 1e-9; v += step) {
    grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${fmtNum(v)}</text>`);
  }
  const ticks: string[] = [];
  const tStep = niceStep(tMax / 5, 60);
  for (let t = 0; t <= tMax; t += tStep) ticks.push(`<text x="${x(t)}" y="${H - 8}" class="tick" text-anchor="middle">${fmtClock(t)}</text>`);
  const steps = stepStarts
    .filter((st) => st.t > 0 && st.t < tMax)
    .map((st) => `<line x1="${x(st.t)}" x2="${x(st.t)}" y1="${T}" y2="${H - B}" class="stepline"/><text x="${x(st.t) + 3}" y="${T + 9}" class="steplabel">${esc(st.label)}</text>`)
    .join("");
  const limit = s.limit !== undefined ? `<line x1="${L}" x2="${W - R}" y1="${y(s.limit)}" y2="${y(s.limit)}" class="limit"/><text x="${W - R}" y="${y(s.limit) - 4}" class="limitlabel" text-anchor="end">limit ${fmtNum(s.limit)}${esc(s.unit)}</text>` : "";
  const json = esc(JSON.stringify(data.map((d) => [d.t, d.v])));
  return `<figure class="chart" data-chart="${id}" data-points="${json}" data-unit="${esc(s.unit)}" data-l="${L}" data-r="${R}" data-w="${W}" data-tmax="${tMax}" data-vmax="${vMax}" data-t="${T}" data-b="${B}" data-h="${H}">
<figcaption>${esc(s.title)}</figcaption>
<div class="plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.title)} over the test">${grid.join("")}${ticks.join("")}<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="axis"/>${steps}${limit}<path d="${path}" class="line"/><line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/><circle class="dot" r="4" visibility="hidden"/></svg><div class="tip" hidden></div></div></figure>`;
}

function niceStep(raw: number, min = 0): number {
  const r = Math.max(raw, min, 1e-9);
  const p = Math.pow(10, Math.floor(Math.log10(r)));
  const n = r / p;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return Math.max(nice * p, min);
}

function fmtNum(v: number): string {
  return Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10);
}

function serverBlock(label: string, s: ServerLoadSample | null): string {
  if (!s) return "";
  return `<tr><th>${esc(label)}</th><td>${esc(s.host.platform)}</td><td>${s.host.cpuCount}</td><td>${s.host.memoryTotalMb.toLocaleString()} MB</td><td>${esc(s.database.edition ?? "–")}</td><td>${dash(s.database.dataMb?.toLocaleString(), " MB")} / ${dash(s.database.logMb?.toLocaleString(), " MB")}</td><td>${dash(s.agents.total)}</td></tr>`;
}

export function renderHtml(r: ReportInput): string {
  const v = verdict(r.run);
  const stepStarts = r.run.steps.length ? r.run.timeline.filter((p, i, a) => i === 0 || p.step !== a[i - 1].step).map((p) => ({ t: p.t, label: `Step ${p.step}` })) : [];
  const anyGenLimited = r.run.steps.some(generatorLimited);
  const server = r.run.serverLast ?? r.run.serverFirst;
  const express = server?.database.edition?.toLowerCase().includes("express");

  const stepRows = r.run.steps
    .map((s) => {
      const lvl = worst(stepChecks(s).map((c) => c.level));
      return `<tr><td>${s.step}</td><td class="num">${s.agents.toLocaleString()}</td><td>${badge(lvl)}</td><td class="num">${s.issuedPerSecond}</td><td class="num">${s.overall.perSecond}</td><td class="num">${s.overall.p50}</td><td class="num">${s.overall.p95}</td><td class="num">${s.overall.p99}</td><td class="num">${s.overall.max}</td><td class="num">${s.overall.errorRate}%</td><td class="num">${s.overall.timeouts}</td><td class="num">${s.maxInFlight}</td><td class="num">${dash(s.server?.hostCpuAvg, "%")}</td><td class="num">${dash(s.server?.processCpuAvg, "%")}</td><td class="num">${dash(s.server?.loopLagP99Max, " ms")}</td><td class="num">${dash(s.server?.dbPingAvg, " ms")}</td><td class="num">${dash(s.server?.memoryUsedMaxMb?.toLocaleString(), " MB")}</td><td class="num">${dash(s.server?.processRssMaxMb, " MB")}</td></tr>`;
    })
    .join("");

  const checks = r.run.steps
    .map((s) => {
      const list = stepChecks(s);
      return `<details ${s === r.run.steps[r.run.steps.length - 1] ? "open" : ""}><summary>Step ${s.step} · ${s.agents.toLocaleString()} endpoints ${badge(worst(list.map((c) => c.level)))}${generatorLimited(s) ? ` ${badge("warn", "Test PC was busy")}` : ""}</summary>
<table><thead><tr><th>Check</th><th>Result</th><th>Measured</th><th>Target</th></tr></thead><tbody>${list.map((c) => `<tr><td>${esc(c.name)}${c.note ? `<div class="muted small">${esc(c.note)}</div>` : ""}</td><td>${badge(c.level)}</td><td>${esc(c.value)}</td><td class="muted">${esc(c.target)}</td></tr>`).join("")}</tbody></table></details>`;
    })
    .join("");

  const lastStep = r.run.steps[r.run.steps.length - 1];
  const routeTable = (rows: StepResult["routes"]) =>
    `<table><thead><tr><th>Request</th><th class="num">Requests</th><th class="num">Per second</th><th class="num">Errors</th><th class="num">p50 ms</th><th class="num">p95 ms</th><th class="num">p99 ms</th><th class="num">Max ms</th><th>Answers</th></tr></thead><tbody>${rows
      .map((x) => `<tr><td>${esc(x.route)}</td><td class="num">${x.requests.toLocaleString()}</td><td class="num">${x.perSecond}</td><td class="num">${x.errors}</td><td class="num">${x.p50}</td><td class="num">${x.p95}</td><td class="num">${x.p99}</td><td class="num">${x.max}</td><td class="small">${esc(Object.entries(x.statuses).map(([k, n]) => `${k}: ${n.toLocaleString()}`).join(", "))}</td></tr>`)
      .join("")}</tbody></table>`;

  const series: Series[] = [
    { title: "Requests answered per second", unit: "", value: (p) => p.perSecond },
    { title: "Response time, 95th percentile (ms)", unit: " ms", value: (p) => p.p95, limit: LIMITS.p95Fail },
    { title: "Errors and timeouts per 10 s", unit: "", value: (p) => p.errors },
    { title: "Requests waiting for an answer", unit: "", value: (p) => p.inFlight },
    { title: "Test endpoints running", unit: "", value: (p) => p.agents },
  ];
  if (r.run.serverMetricsAvailable) {
    series.push(
      { title: "Server CPU, whole machine (%)", unit: "%", value: (p) => p.server?.host.cpuPercent ?? null, limit: LIMITS.hostCpuFail },
      { title: "Endpoint IQ app CPU (% of one core)", unit: "%", value: (p) => p.server?.process.cpuPercent ?? null, limit: LIMITS.appCpuFail },
      { title: "App event-loop delay, 99th percentile (ms)", unit: " ms", value: (p) => p.server?.process.eventLoopDelayP99Ms ?? null, limit: LIMITS.loopLagFail },
      { title: "Database response (ms)", unit: " ms", value: (p) => p.server?.database.pingMs ?? null, limit: LIMITS.dbPingFail },
      { title: "Server memory in use (MB)", unit: " MB", value: (p) => p.server?.host.memoryUsedMb ?? null },
    );
  }
  series.push({ title: "Test PC: tool CPU (% of one core)", unit: "%", value: (p) => p.generatorCpuPercent, limit: LIMITS.generatorCpu });

  const errs = Object.entries(r.run.total.errorSamples).sort((a, b) => b[1] - a[1]);
  const o = r.run.total.overall;
  const peak = Math.max(0, ...r.run.timeline.map((p) => p.perSecond));
  const dbGrowth = r.run.serverFirst?.database.dataMb != null && r.run.serverLast?.database.dataMb != null ? r.run.serverLast.database.dataMb - r.run.serverFirst.database.dataMb : null;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Load Test Report</title>
<style>
:root{--bg:#f6f7f9;--surface:#fff;--ink:#1b1f24;--ink2:#4a5360;--muted:#6b7480;--line:#e3e6ea;--accent:#2563c9;--pass:#1d7a3e;--pass-bg:#e5f4ea;--warn:#8a5a00;--warn-bg:#fdf1d6;--fail:#b3261e;--fail-bg:#fbe4e2;--limit:#b3261e;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111418;--surface:#1a1e24;--ink:#e8ebef;--ink2:#b9c0c9;--muted:#8d96a1;--line:#2c323a;--accent:#7aa7f0;--pass:#6fd18f;--pass-bg:#1b3325;--warn:#f0c060;--warn-bg:#3a2f14;--fail:#f28b82;--fail-bg:#3d1e1c;--limit:#f28b82;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#111418;--surface:#1a1e24;--ink:#e8ebef;--ink2:#b9c0c9;--muted:#8d96a1;--line:#2c323a;--accent:#7aa7f0;--pass:#6fd18f;--pass-bg:#1b3325;--warn:#f0c060;--warn-bg:#3a2f14;--fail:#f28b82;--fail-bg:#3d1e1c;--limit:#f28b82;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 48px}h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 12px}
.muted{color:var(--muted)}.small{font-size:12px}.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px}
.verdict{display:flex;gap:16px;align-items:flex-start;margin-top:16px}.verdict h2{margin:0 0 4px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:16px}.tile .label{color:var(--muted);font-size:12px}.tile .value{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}
.badge{display:inline-flex;gap:4px;align-items:center;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}.badge.pass{color:var(--pass);background:var(--pass-bg)}.badge.warn{color:var(--warn);background:var(--warn-bg)}.badge.fail{color:var(--fail);background:var(--fail-bg)}
.big .badge{font-size:15px;padding:4px 12px}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;background:var(--surface)}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--ink2);font-weight:600;font-size:12px}.num{text-align:right;font-variant-numeric:tabular-nums}
details{background:var(--surface);border:1px solid var(--line);border-radius:10px;margin-bottom:8px}details summary{cursor:pointer;padding:10px 14px;font-weight:600}details table{border-top:1px solid var(--line)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}.chart{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px}.chart figcaption{font-weight:600;font-size:13px;margin-bottom:4px}
.plot{position:relative}svg{width:100%;height:auto;display:block}.grid{stroke:var(--line);stroke-width:1}.axis{stroke:var(--muted);stroke-width:1}.tick{fill:var(--muted);font-size:10px}
.line{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round}.limit{stroke:var(--limit);stroke-dasharray:4 4;stroke-width:1}.limitlabel{fill:var(--limit);font-size:10px}
.stepline{stroke:var(--muted);stroke-dasharray:2 3}.steplabel{fill:var(--muted);font-size:10px}.cross{stroke:var(--muted)}.dot{fill:var(--accent);stroke:var(--surface);stroke-width:2}
.tip{position:absolute;top:0;pointer-events:none;background:var(--ink);color:var(--surface);font-size:12px;padding:3px 8px;border-radius:6px;white-space:nowrap;transform:translateX(-50%)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{color:var(--muted)}dd{margin:0}
.note{border-left:3px solid var(--warn);padding:8px 12px;background:var(--warn-bg);border-radius:4px;margin:12px 0}
</style></head><body><main>
<h1>Endpoint IQ Load Test</h1>
<div class="muted">${esc(r.settings.server)} · ${esc(new Date(r.run.startedAt).toLocaleString())} · ${esc(r.tool)}</div>

<div class="card verdict"><div class="big">${badge(v.level)}</div><div><h2>${esc(v.headline)}</h2><div>${esc(v.detail)}</div>${v.estimatedCapacity && v.passedEndpoints && v.estimatedCapacity > v.passedEndpoints ? `<div class="muted small" style="margin-top:6px">Rough estimate from server CPU headroom: about ${v.estimatedCapacity.toLocaleString()} endpoints before CPU reaches ${LIMITS.hostCpuWarn}%. Confirm by testing at that size - other limits (database, disk) may come first.</div>` : ""}</div></div>
${r.run.stoppedEarly ? `<div class="note">The test was stopped early - only completed steps are judged.</div>` : ""}
${anyGenLimited ? `<div class="note">The PC running this tool was very busy during some steps, so it may not have been able to send the full load. Run the tool on a more powerful PC (or close other programs) to test higher loads reliably.</div>` : ""}
${express ? `<div class="note">The database runs <b>SQL Server Express</b>, which is limited to 10 GB per database, about 1.4 GB of memory and 4 cores. Use SQL Server Standard for large fleets.</div>` : ""}
${!r.run.serverMetricsAvailable ? `<div class="note">This server version doesn't report its CPU, memory and database figures (Endpoint IQ 1.0.36 or later does), so only response times are judged.</div>` : ""}

<div class="tiles">
<div class="card tile"><div class="label">Most endpoints tested</div><div class="value">${(lastStep?.agents ?? 0).toLocaleString()}</div></div>
<div class="card tile"><div class="label">Peak requests per second</div><div class="value">${fmtNum(peak)}</div></div>
<div class="card tile"><div class="label">Response time p95 (last step)</div><div class="value">${lastStep ? lastStep.overall.p95 + " ms" : "–"}</div></div>
<div class="card tile"><div class="label">Errors (whole test)</div><div class="value">${o.errorRate}%</div></div>
<div class="card tile"><div class="label">Server CPU avg (last step)</div><div class="value">${dash(lastStep?.server?.hostCpuAvg, "%")}</div></div>
<div class="card tile"><div class="label">Database response (last step)</div><div class="value">${dash(lastStep?.server?.dbPingAvg, " ms")}</div></div>
</div>

<h2>Steps</h2>
<div class="scroll"><table><thead><tr><th>Step</th><th class="num">Endpoints</th><th>Result</th><th class="num">Sent/s</th><th class="num">Answered/s</th><th class="num">p50 ms</th><th class="num">p95 ms</th><th class="num">p99 ms</th><th class="num">Max ms</th><th class="num">Errors</th><th class="num">Timeouts</th><th class="num">Waiting (max)</th><th class="num">Server CPU</th><th class="num">App CPU</th><th class="num">Loop delay</th><th class="num">DB response</th><th class="num">Server memory</th><th class="num">App memory</th></tr></thead><tbody>${stepRows || `<tr><td colspan="18" class="muted">No step completed.</td></tr>`}</tbody></table></div>
<p class="muted small">Measured after each step's ramp-up. Sent/s is what the test endpoints asked for; Answered/s below it means requests were queuing. Without policies assigned, an endpoint makes about ${(lastStep ? lastStep.expectedPerSecond / Math.max(1, lastStep.agents) : 0.53).toFixed(2)} requests per second; assigned policies add their sync results.</p>

<h2>Checks</h2>
${checks || `<p class="muted">No step completed.</p>`}

<h2>Over Time</h2>
<div class="charts">${series.map((s, i) => chart("c" + i, s, r.run.timeline, stepStarts)).join("")}</div>

<h2>Requests by Type${lastStep ? ` (Step ${lastStep.step}, ${lastStep.agents.toLocaleString()} Endpoints)` : ""}</h2>
<div class="scroll">${lastStep ? routeTable(lastStep.routes) : routeTable(r.run.total.routes)}</div>

<h2>Whole Test</h2>
<div class="scroll">${routeTable(r.run.total.routes)}</div>
<div class="card" style="margin-top:12px"><dl>
<dt>Requests</dt><dd>${o.requests.toLocaleString()} in ${fmtClock(r.run.seconds)} (min:s)</dd>
<dt>Response times</dt><dd>mean ${o.mean} ms · p50 ${o.p50} · p90 ${o.p90} · p95 ${o.p95} · p99 ${o.p99} · max ${o.max} ms</dd>
<dt>Errors / timeouts</dt><dd>${o.errors.toLocaleString()} (${o.errorRate}%) / ${o.timeouts.toLocaleString()}</dd>
<dt>Network</dt><dd>${o.kbInPerSecond} KB/s received · ${o.kbOutPerSecond} KB/s sent (average) · ${r.run.newConnections.toLocaleString()} connections opened</dd>
${dbGrowth !== null ? `<dt>Database growth</dt><dd>${dbGrowth} MB during the test (removed with the test endpoints afterwards)</dd>` : ""}
</dl></div>
${errs.length ? `<h2>Error Messages</h2><div class="scroll"><table><thead><tr><th>Message</th><th class="num">Count</th></tr></thead><tbody>${errs.map(([m, n]) => `<tr><td>${esc(m)}</td><td class="num">${n.toLocaleString()}</td></tr>`).join("")}</tbody></table></div>` : ""}

<h2>Server</h2>
${server ? `<div class="scroll"><table><thead><tr><th></th><th>Platform</th><th class="num">CPUs</th><th>Memory</th><th>SQL Server edition</th><th>Database data / log</th><th>Endpoints in database</th></tr></thead><tbody>${serverBlock("Before the test", r.run.serverFirst)}${serverBlock("At the end", r.run.serverLast)}</tbody></table></div><p class="muted small">Inside Docker, CPU and memory are the whole machine's. Endpoint IQ ${esc(server.process.nodeVersion)} runtime, up ${Math.round(server.process.uptimeSeconds / 3600)} h.</p>` : `<p class="muted">Not reported by this server version.</p>`}

<h2>Test Settings</h2>
<div class="card"><dl>
<dt>Server</dt><dd>${esc(r.settings.server)}${r.settings.insecure ? " (certificate not checked)" : ""}</dd>
<dt>Steps</dt><dd>${r.settings.steps.map((n) => n.toLocaleString()).join(" → ")} endpoints, ${r.settings.stepMinutes} min each after a ${r.settings.rampSeconds} s ramp-up</dd>
<dt>Simulated agent</dt><dd>Windows agent 0.2.39: check-in every ${r.settings.pollSeconds} s, policy sync every 20 s, EDR status every 30 s, consent / screen capture / data movement every minute, AI Guard and Threat Protection every 5 min${r.settings.reports ? ", application usage report every 5 min" : ""}.</dd>
<dt>Not simulated</dt><dd>Inventory, patch and vulnerability scans, security configuration, data discovery, events (blocks, DLP, screenshots), software deployments and agent updates. These are occasional, but large: stagger deployments and updates on big fleets.</dd>
<dt>Enrollment</dt><dd>${r.enrollment.enrolled} enrolled (${r.enrollment.msPerEnrollment} ms each), ${r.enrollment.reused} reused from an earlier run${r.enrollment.problem ? ` · ${esc(r.enrollment.problem)}` : ""}</dd>
<dt>Clean-up</dt><dd>${r.cleanup.kept ? "Test endpoints were kept (--keep)." : `${r.cleanup.removed} test endpoint(s) removed with everything they reported${r.cleanup.failed ? `; ${r.cleanup.failed} could not be removed - run the tool again to retry` : ""}.`}</dd>
<dt>Test PC</dt><dd>${esc(r.generator.hostname)} · ${esc(r.generator.platform)} · ${r.generator.cpuCount} × ${esc(r.generator.cpuModel)} · ${r.generator.memoryMb.toLocaleString()} MB · Node ${esc(r.generator.node)}</dd>
</dl></div>
</main>
<script>
document.querySelectorAll(".chart[data-points]").forEach(function (fig) {
  var pts = JSON.parse(fig.dataset.points), svg = fig.querySelector("svg"), tip = fig.querySelector(".tip");
  var cross = svg.querySelector(".cross"), dot = svg.querySelector(".dot");
  var L = +fig.dataset.l, R = +fig.dataset.r, W = +fig.dataset.w, T = +fig.dataset.t, B = +fig.dataset.b, H = +fig.dataset.h, tMax = +fig.dataset.tmax, vMax = +fig.dataset.vmax;
  function fx(t) { return L + (t / Math.max(tMax, 1)) * (W - L - R); }
  function fy(v) { return T + (1 - v / vMax) * (H - T - B); }
  function clock(s) { var m = Math.floor(s / 60); return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
  svg.addEventListener("mousemove", function (e) {
    var box = svg.getBoundingClientRect(), sx = ((e.clientX - box.left) / box.width) * W;
    var best = pts[0];
    pts.forEach(function (p) { if (Math.abs(fx(p[0]) - sx) < Math.abs(fx(best[0]) - sx)) best = p; });
    var x = fx(best[0]), y = fy(best[1]);
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("visibility", "visible");
    tip.hidden = false; tip.textContent = clock(best[0]) + "  " + best[1] + fig.dataset.unit;
    tip.style.left = (x / W) * box.width + "px";
  });
  svg.addEventListener("mouseleave", function () { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true; });
});
</script>
</body></html>`;
}

// ---- CSV ------------------------------------------------------------------------------------

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function timelineCsv(points: TimelinePoint[]): string {
  const head = ["seconds", "step", "endpoints", "answered_per_s", "sent_per_s", "p50_ms", "p95_ms", "p99_ms", "errors", "timeouts", "waiting", "tool_cpu_pct", "tool_loop_delay_ms", "server_cpu_pct", "app_cpu_pct", "app_loop_delay_p99_ms", "server_req_per_s", "db_ping_ms", "server_mem_used_mb", "app_rss_mb"];
  const rows = points.map((p) =>
    [p.t, p.step, p.agents, p.perSecond, p.issuedPerSecond, p.p50, p.p95, p.p99, p.errors, p.timeouts, p.inFlight, p.generatorCpuPercent, p.generatorLagP99Ms, p.server?.host.cpuPercent, p.server?.process.cpuPercent, p.server?.process.eventLoopDelayP99Ms, p.server?.requests.perSecond, p.server?.database.pingMs, p.server?.host.memoryUsedMb, p.server?.process.rssMb].map(csvCell).join(","),
  );
  return [head.join(","), ...rows].join("\r\n") + "\r\n";
}

export function stepsCsv(steps: StepResult[]): string {
  const head = ["step", "endpoints", "result", "request", "requests", "per_s", "errors", "timeouts", "p50_ms", "p90_ms", "p95_ms", "p99_ms", "max_ms"];
  const rows: string[] = [];
  for (const s of steps) {
    const res = worst(stepChecks(s).map((c) => c.level));
    rows.push([s.step, s.agents, res, "(all)", s.overall.requests, s.overall.perSecond, s.overall.errors, s.overall.timeouts, s.overall.p50, s.overall.p90, s.overall.p95, s.overall.p99, s.overall.max].map(csvCell).join(","));
    for (const x of s.routes) rows.push([s.step, s.agents, "", x.route, x.requests, x.perSecond, x.errors, x.timeouts, x.p50, x.p90, x.p95, x.p99, x.max].map(csvCell).join(","));
  }
  return [head.join(","), ...rows].join("\r\n") + "\r\n";
}
