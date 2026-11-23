import fs from "node:fs";
import path from "node:path";
import type { AxiosInstance } from "axios";
import type { AssignedCommandBlockResponse, CommandBlockEventPayload, CommandBlockSyncResultPayload } from "@em/shared";

// Command blocking on Linux. The server sends the command patterns of the protections assigned to
// this device (always Block). Four times a second the agent reads the process list from /proc;
// a new process whose full command line matches is killed at once and reported to the policy's
// Events tab. A command that finishes in less time than that can slip through.
//
// Never touched: PID 1, the agent itself and everything it started (deployments, scripts), and
// the agent's own service process (its bundled node running app/dist/index.js - identified by
// the real executable path, never by command-line text, which any user can make say anything).
// At most 30 kills a minute, as a backstop.

const SCAN_MS = 250;
const SYNC_MS = 20_000;
const MAX_KILLS_PER_MINUTE = 30;

interface Rule {
  ruleId: string;
  ruleType: string;
  pattern: string;
  re: RegExp | null;
}

interface Proc {
  pid: number;
  ppid: number;
  key: string; // pid + start time, so a reused pid counts as a new process
  name: string;
  commandLine: string;
}

let rules: Rule[] = [];
let rulesChanged = false;
const seen = new Set<string>();
const events: CommandBlockEventPayload[] = [];
let kills: number[] = [];
let lastError: string | null = null;

// app/dist/../.. = the install root (/opt/endpointpro-agent).
const INSTALL_DIR = (() => {
  const dir = path.join(__dirname, "..", "..");
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
})();
const AGENT_ENTRY = path.join(INSTALL_DIR, "app", "dist", "index.js");

// The agent's own service process (e.g. a second instance during a restart): the kernel's
// executable path is under the install folder AND it runs nothing but the agent entry point.
// The bundled node is a general interpreter, so "exe under the install dir" alone is not
// enough - `node -e ...` or `node evil.js` from there must still be blockable.
function isAgentServiceProcess(pid: number): boolean {
  try {
    const exe = fs.readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, "");
    if (!exe.startsWith(`${INSTALL_DIR}/`) || path.resolve(exe) !== exe) return false;
    const argv = fs.readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean);
    const args = argv.slice(1).filter((a) => a !== "--use-system-ca");
    return args.length === 1 && path.resolve(INSTALL_DIR, args[0]) === AGENT_ENTRY;
  } catch {
    return false;
  }
}

function readProcesses(): Proc[] {
  const out: Proc[] = [];
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
      // "pid (comm) state ppid ... starttime(22nd field)" - comm may contain spaces/parentheses.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const ppid = Number(fields[1]);
      const start = fields[19];
      const raw = fs.readFileSync(`/proc/${entry}/cmdline`);
      if (raw.length === 0) continue; // kernel thread
      const argv = raw.toString("utf8").split("\0").filter(Boolean);
      out.push({ pid: Number(entry), ppid, key: `${entry}:${start}`, name: (argv[0] ?? "").split("/").pop() ?? "", commandLine: argv.join(" ") });
    } catch {
      // exited while being read
    }
  }
  return out;
}

function matchRule(p: Proc): Rule | null {
  for (const r of rules) {
    if (r.ruleType === "COMMAND_PATTERN" && r.re?.test(p.commandLine)) return r;
    if (r.ruleType === "EXACT_COMMAND_LINE" && p.commandLine.trim().toLowerCase() === r.pattern.trim().toLowerCase()) return r;
    if (r.ruleType === "PROCESS_NAME" && p.name.toLowerCase() === r.pattern.toLowerCase()) return r;
  }
  return null;
}

function scan(): void {
  if (rules.length === 0) return;
  let procs: Proc[];
  try {
    procs = readProcesses();
    lastError = null;
  } catch (err) {
    lastError = `Couldn't read the process list: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }

  // The agent and its descendants.
  const parentOf = new Map(procs.map((p) => [p.pid, p.ppid]));
  const ownTree = (pid: number) => {
    for (let cur = pid, depth = 0; cur > 0 && depth < 64; cur = parentOf.get(cur) ?? 0, depth++) if (cur === process.pid) return true;
    return false;
  };

  const recheckAll = rulesChanged;
  rulesChanged = false;
  const now = Date.now();
  kills = kills.filter((t) => now - t < 60_000);
  const alive = new Set<string>();
  for (const p of procs) {
    alive.add(p.key);
    if (seen.has(p.key) && !recheckAll) continue;
    seen.add(p.key);
    if (p.pid <= 1 || ownTree(p.pid)) continue;
    const rule = matchRule(p);
    if (!rule || isAgentServiceProcess(p.pid)) continue;
    let closed = false;
    if (kills.length < MAX_KILLS_PER_MINUTE) {
      try {
        process.kill(p.pid, "SIGKILL");
        closed = true;
        kills.push(now);
      } catch {
        // already gone
      }
    }
    if (events.length < 1000) {
      events.push({
        ruleId: rule.ruleId,
        matchedCommandLine: p.commandLine.slice(0, 2000),
        processName: p.name.slice(0, 300) || null,
        action: closed ? "BLOCKED" : "ALERTED",
        occurredAt: new Date(now).toISOString(),
      });
    }
  }
  for (const k of seen) if (!alive.has(k)) seen.delete(k);
}

async function sync(client: AxiosInstance): Promise<void> {
  try {
    const { data } = await client.get<AssignedCommandBlockResponse>("/api/agent/command-block/assigned");
    const next = data.rules.map((r) => {
      let re: RegExp | null = null;
      if (r.ruleType === "COMMAND_PATTERN") {
        try {
          re = new RegExp(r.pattern, "i");
          if (re.test("")) re = null; // would match everything
        } catch {
          re = null;
        }
      }
      return { ruleId: r.ruleId, ruleType: r.ruleType, pattern: r.pattern, re };
    });
    if (JSON.stringify(next.map((r) => [r.ruleId, r.pattern])) !== JSON.stringify(rules.map((r) => [r.ruleId, r.pattern]))) {
      rules = next;
      rulesChanged = true; // check what is already running against the new rules
    }
    if (rules.length > 0) {
      const payload: CommandBlockSyncResultPayload = lastError ? { status: "FAILED", errorMessage: lastError.slice(0, 1000) } : { status: "SUCCESS", errorMessage: null };
      await client.post("/api/agent/command-block/scan-result", payload);
    }
  } catch (err) {
    console.error("Command Block: sync failed", err);
  }

  const batch = events.splice(0, 200);
  if (batch.length > 0) {
    try {
      await client.post("/api/agent/command-block/events", { events: batch });
      console.log(`Command Block: reported ${batch.length} blocked command(s)`);
    } catch (err) {
      console.error("Command Block: couldn't report events", err);
      events.unshift(...batch);
    }
  }
}

export function startCommandGuard(client: AxiosInstance): void {
  if (process.platform !== "linux") return;
  void sync(client);
  setInterval(() => void sync(client), SYNC_MS);
  setInterval(scan, SCAN_MS);
}
