import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import { baseRatePerAgent, enrollAgents, generatorInfo, Http, readState, removeAgents, runLoad, type Options } from "./engine";
import { renderHtml, stepsCsv, timelineCsv, verdict } from "./report";

declare const __TOOL_VERSION__: string;
const VERSION = typeof __TOOL_VERSION__ === "string" ? __TOOL_VERSION__ : "dev";
const TOOL = `Endpoint IQ Load Test ${VERSION}`;

const HELP = `${TOOL}

Simulates Endpoint IQ Windows agents against a server and reports how it copes: response times,
errors, throughput and (on server 1.0.36+) the server's CPU, memory and database response.

Run without options to be asked step by step. Options:
  --server URL          Server address agents use, e.g. https://endpointiq.example.com or http://10.0.0.5:4000
  --token TOKEN         Enrollment token (Enrollment Tokens page) with at least as many uses as endpoints
  --endpoints N         Simulated endpoints at the last step (default 500)
  --steps LIST          Endpoints per step, e.g. 250,500,1000,2000 (default: 25/50/75/100% of --endpoints)
  --minutes N           Minutes measured at each step (default 5)
  --ramp SECONDS        Ramp-up before each step is measured (default 60)
  --poll SECONDS        Agent check-in interval (default 30, the agent's default)
  --no-reports          Don't send application usage reports
  --insecure            Don't check the server's HTTPS certificate (self-signed certificates)
  --enroll-parallel N   Enrollments at a time (default 10)
  --out FOLDER          Where results are written (default: results next to the tool)
  --keep                Keep the test endpoints at the end (default: they are removed)
  --cleanup             Only remove test endpoints left from an earlier run
  --yes                 Don't ask for confirmation
`;

function parseArgs(argv: string[]): Map<string, string | true> {
  const out = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out.set(a.slice(2), next);
      i++;
    } else out.set(a.slice(2), true);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const str = (k: string) => (typeof args.get(k) === "string" ? (args.get(k) as string) : undefined);
const interactive = !args.has("server") && !args.has("cleanup");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const log = (s: string) => console.log(s);

async function ask(question: string, fallback?: string): Promise<string> {
  const a = (await rl.question(`${question}${fallback !== undefined ? ` [${fallback}]` : ""}: `)).trim();
  return a || fallback || "";
}

async function askYes(question: string, def: boolean): Promise<boolean> {
  const a = (await ask(`${question} (${def ? "Y/n" : "y/N"})`)).toLowerCase();
  return a ? a.startsWith("y") : def;
}

function positiveInt(v: string | undefined, name: string, def: number): number {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a whole number above 0`);
  return n;
}

function defaultSteps(endpoints: number): number[] {
  if (endpoints < 100) return [endpoints];
  return [...new Set([0.25, 0.5, 0.75, 1].map((f) => Math.max(1, Math.round((endpoints * f) / 10) * 10)))].map((n, i, a) => (i === a.length - 1 ? endpoints : n));
}

function toolDir(): string {
  // Next to the bundled script (the tool's folder), or the current folder in development.
  return process.argv[1] && fs.existsSync(process.argv[1]) ? path.dirname(path.resolve(process.argv[1])) : process.cwd();
}

function normalizeServer(s: string): string {
  let v = s.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  return v;
}

function openFile(file: string) {
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", file], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else if (process.platform === "darwin") spawn("open", [file], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // just print the path
  }
}

async function checkServer(server: string, insecure: boolean): Promise<{ ok: boolean; certProblem: boolean; message: string }> {
  const client = new Http(server, insecure, 4);
  const r = await client.request("GET", "/health", {}, undefined, 10_000);
  client.close();
  if (r.status === 200) return { ok: true, certProblem: false, message: "" };
  const certProblem = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(r.error ?? "");
  return { ok: false, certProblem, message: r.status ? `HTTP ${r.status}` : r.error ?? "no answer" };
}

async function main() {
  if (args.has("help") || args.has("h")) {
    console.log(HELP);
    return;
  }
  console.log(`\n${TOOL}\n${"=".repeat(TOOL.length)}\n`);
  const stateFile = path.join(toolDir(), ".load-test-endpoints.json");

  // Test endpoints left from an earlier run (stopped, closed or crashed): remove them first.
  const leftover = readState(stateFile);
  if (leftover && leftover.agents.length > 0) {
    console.log(`${leftover.agents.length} test endpoint(s) from an earlier run are still on ${leftover.server}.`);
    const remove = args.has("cleanup") || args.has("yes") || (await askYes("Remove them now?", true));
    if (remove) {
      const insecure = args.has("insecure") || (await checkServer(leftover.server, false)).certProblem;
      const client = new Http(leftover.server, insecure, 50);
      await removeAgents(leftover.server, stateFile, client, leftover.agents, log);
      client.close();
    }
    console.log("");
  } else if (args.has("cleanup")) {
    console.log("No test endpoints left from an earlier run.");
  }
  if (args.has("cleanup")) return;

  // ---- Settings ----
  let server = str("server");
  let insecure = args.has("insecure");
  if (interactive) {
    console.log("Run this from a PC other than the server, during quiet hours on a production server.\n");
    for (;;) {
      server = normalizeServer(await ask("Server address (the one agents use, e.g. https://endpointiq.company.com or http://10.0.0.5:4000)"));
      const check = await checkServer(server, insecure);
      if (check.ok) break;
      if (check.certProblem && !insecure) {
        if (await askYes("The server's HTTPS certificate isn't trusted by this PC (self-signed?). Continue without checking it?", false)) {
          insecure = true;
          if ((await checkServer(server, true)).ok) break;
        }
        continue;
      }
      console.log(`  The server didn't answer (${check.message}). Check the address and try again.`);
    }
  } else {
    if (!server) throw new Error("Give --server (see --help).");
    server = normalizeServer(server);
    const check = await checkServer(server, insecure);
    if (!check.ok) throw new Error(`The server didn't answer /health (${check.message})${check.certProblem ? " - add --insecure for a self-signed certificate" : ""}.`);
  }

  const endpoints = interactive ? positiveInt(await ask("How many endpoints to simulate", "500"), "Endpoints", 500) : positiveInt(str("endpoints"), "--endpoints", 500);
  let steps = str("steps")
    ? str("steps")!.split(",").map((s) => positiveInt(s.trim(), "--steps", 1))
    : interactive && endpoints >= 100 && !(await askYes(`Increase the load in steps (${defaultSteps(endpoints).join(" → ")}) to see where it starts to struggle?`, true))
      ? [endpoints]
      : defaultSteps(endpoints);
  steps = [...new Set(steps)].sort((a, b) => a - b);
  const maxEndpoints = steps[steps.length - 1];
  const stepMinutes = interactive ? positiveInt(await ask("Minutes to measure at each step", "5"), "Minutes", 5) : positiveInt(str("minutes"), "--minutes", 5);
  const reports = interactive ? await askYes("Include application usage reports (as from the tray app)?", true) : !args.has("no-reports");
  const have = readState(stateFile);
  const reusable = have && have.server === server ? have.agents.filter((a) => a.n <= maxEndpoints).length : 0;
  let token = str("token");
  if (!token && reusable < maxEndpoints) {
    if (!interactive) throw new Error("Give --token (an enrollment token with enough uses).");
    token = await ask(`Enrollment token (Endpoint Hub → Enrollment Tokens; needs ${maxEndpoints - reusable} uses)`);
  }

  const opts: Options = {
    server,
    token,
    steps,
    stepMinutes,
    rampSeconds: positiveInt(str("ramp"), "--ramp", 60),
    pollSeconds: positiveInt(str("poll"), "--poll", 30),
    reports,
    insecure,
    enrollParallel: positiveInt(str("enroll-parallel"), "--enroll-parallel", 10),
    stateFile,
    keepAgents: args.has("keep"),
    log,
  };

  const minutes = Math.ceil((steps.length * (opts.rampSeconds + 5 + stepMinutes * 60)) / 60);
  const peakRate = Math.round(maxEndpoints * baseRatePerAgent(opts.pollSeconds, reports));
  console.log(`
About to test ${server}${insecure ? " (certificate not checked)" : ""}
  Steps:     ${steps.join(" → ")} endpoints, ${stepMinutes} min each (about ${minutes} min in all, plus enrolling)
  Load:      up to about ${peakRate} requests per second (more when policies are assigned)

What this does on the server:
  - Adds up to ${maxEndpoints} test endpoints named LOADTEST-0001… They show in the console while
    the test runs, policies for "all endpoints" apply to them, and they use ${maxEndpoints} licences.
  - Uses ${Math.max(0, maxEndpoints - reusable)} uses of the enrollment token.${reusable ? ` (${reusable} test endpoints from before are reused.)` : ""}
  - ${opts.keepAgents ? "Keeps the test endpoints at the end (--keep)." : "Removes the test endpoints at the end, with everything they reported, freeing the licences.\n    If the tool is closed early, run it again to remove them."}
  - The server allows 20 new endpoints per 15 minutes from one address unless AGENT_ENROLL_RATE_LIMIT
    is raised in its .env (Endpoint IQ 1.0.36+).
`);
  if (!args.has("yes")) {
    const answer = await ask(`Type START to begin`);
    if (answer.toUpperCase() !== "START") {
      console.log("Cancelled - nothing was changed.");
      return;
    }
  }

  // ---- Run ----
  rl.close(); // readline would swallow Ctrl+C while open
  const client = new Http(server, insecure, maxEndpoints + 10);
  const stop = { requested: false };
  let interrupts = 0;
  process.on("SIGINT", () => {
    interrupts++;
    if (interrupts === 1) {
      stop.requested = true;
      console.log("\nStopping - finishing the report and removing the test endpoints (Ctrl+C again to quit at once)...");
    } else {
      console.log("Quit. Run the tool again to remove the test endpoints.");
      process.exit(130);
    }
  });

  const { agents, result: enrollment } = await enrollAgents(opts, client, maxEndpoints);
  if (enrollment.problem) console.log(`\n${enrollment.problem}`);
  if (agents.length === 0) {
    console.log("No test endpoints could be enrolled - nothing to test.");
    client.close();
    return;
  }
  if (agents.length < maxEndpoints) {
    opts.steps = steps.filter((n) => n < agents.length).concat(agents.length);
    opts.steps = [...new Set(opts.steps)];
    console.log(`Testing with the ${agents.length} endpoints enrolled: steps ${opts.steps.join(" → ")}.`);
  }

  console.log("\nRunning. Press Ctrl+C to stop early.\n");
  const run = await runLoad(opts, client, agents, stop);

  let cleanup = { removed: 0, failed: 0, kept: opts.keepAgents };
  if (!opts.keepAgents) {
    console.log("\nRemoving the test endpoints...");
    cleanup = { ...(await removeAgents(server, stateFile, client, agents, log)), kept: false };
  }
  client.close();

  // ---- Results ----
  const host = new URL(server).hostname.replace(/[^a-z0-9.-]/gi, "_");
  const d = new Date();
  const p2 = (x: number) => String(x).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
  const outDir = path.resolve(str("out") ?? path.join(toolDir(), "results"), `${stamp}_${host}`);
  fs.mkdirSync(outDir, { recursive: true });
  const input = {
    tool: TOOL,
    settings: { server, steps: opts.steps, stepMinutes, rampSeconds: opts.rampSeconds, pollSeconds: opts.pollSeconds, reports, insecure },
    generator: generatorInfo(),
    enrollment,
    run,
    cleanup,
  };
  const reportFile = path.join(outDir, "report.html");
  fs.writeFileSync(reportFile, renderHtml(input));
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ ...input, verdict: verdict(run) }, null, 2));
  fs.writeFileSync(path.join(outDir, "timeline.csv"), timelineCsv(run.timeline));
  fs.writeFileSync(path.join(outDir, "steps.csv"), stepsCsv(run.steps));

  const v = verdict(run);
  console.log(`\nResult: ${v.level.toUpperCase()} - ${v.headline}\n${v.detail}`);
  console.log(`\nReport: ${reportFile}\n(also results.json, timeline.csv and steps.csv in the same folder)`);
  if (interactive) openFile(reportFile);
}

main()
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    // Keep the window open when started by double-click.
    if (interactive && process.platform === "win32" && process.stdin.isTTY) {
      const done = readline.createInterface({ input: process.stdin, output: process.stdout });
      done.question("\nPress Enter to close.").then(() => {
        done.close();
        process.exit();
      });
    } else process.exit();
  });
