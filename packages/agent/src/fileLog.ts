import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { agentConfig } from "./config";
import { ensureRealDirSync, logDir } from "./secureFs";

// The agent runs as a SYSTEM scheduled task, so its console output went nowhere and a
// failure (e.g. an empty software list) left no trace on the endpoint. This mirrors
// console.log/warn/error into app\logs\agent.log (readable by administrators only, like the
// rest of the install folder - prepareAgentFolders in secureFs.ts puts those permissions back
// at every start), keeping one previous file once it passes MAX_BYTES.
//
// Only for the packaged agent (running from dist\) - `npm run dev` keeps plain console output.
// Every line, written to the file or the console, first goes through sanitizeLogArgs.

const MAX_BYTES = 5 * 1024 * 1024;

// Secret values seen at run time (the agent key, the enrollment token): never written out, even
// where they turn up somewhere the patterns below don't expect.
const secrets = new Set<string>();
export function addLogSecret(value: string | null | undefined): void {
  if (value && value.length >= 8) secrets.add(value);
}

// "X-Agent-Key: ...", 'x-agent-key': '...', "enrollmentToken":"..." and "apiKey":"..." (also inside
// JSON that is itself a JSON string, where the quotes are escaped).
const SECRET_PATTERNS = [/(x-agent-key\\?["']?\s*[:=]\s*\\?["']?)[^"'\s,}\\]+/gi, /((?:enrollmentToken|apiKey)\\?["']?\s*[:=]\s*\\?["']?)[^"'\s,}\\]+/gi];

export function redactSecrets(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p, "$1[redacted]");
  for (const s of secrets) out = out.split(s).join("[redacted]");
  return out;
}

type HttpErrorLike = {
  isAxiosError?: boolean;
  name?: string;
  message?: string;
  code?: string;
  config?: { method?: string; url?: string; baseURL?: string };
  request?: unknown;
  response?: { status?: number };
};

function isHttpError(value: unknown): value is HttpErrorLike {
  if (!value || typeof value !== "object") return false;
  const v = value as HttpErrorLike;
  return v.isAxiosError === true || (typeof v.config === "object" && v.config !== null && ("request" in v || "response" in v));
}

// An HTTP client error printed whole (util.inspect) includes the request's headers (the agent
// key), its body (the enrollment token) and the raw request text. Only what helps diagnose it is
// kept: message, method, the URL's path (no query string) and the server's status.
function describeHttpError(e: HttpErrorLike): string {
  const method = (e.config?.method ?? "").toUpperCase();
  let urlPath = "";
  try {
    urlPath = new URL(e.config?.url ?? "", e.config?.baseURL ?? "http://agent.invalid").pathname;
  } catch {
    urlPath = "";
  }
  const status = e.response?.status;
  const where = [method, urlPath].filter(Boolean).join(" ");
  return `${e.name ?? "Error"}: ${e.message ?? ""}${e.code ? ` [${e.code}]` : ""}${where ? ` (${where}${status ? ` -> ${status}` : ""})` : status ? ` (-> ${status})` : ""}`;
}

function sanitizeArg(arg: unknown, depth = 0): unknown {
  if (isHttpError(arg)) return describeHttpError(arg);
  if (arg instanceof Error) {
    // An error wrapping an HTTP error (cause) gets the same treatment for the cause.
    const cause = (arg as { cause?: unknown }).cause;
    if (cause !== undefined && depth < 3) return `${arg.stack ?? `${arg.name}: ${arg.message}`}\n  cause: ${util.format(sanitizeArg(cause, depth + 1))}`;
    return arg;
  }
  if (arg && typeof arg === "object" && depth < 2) {
    // A plain object holding an HTTP error ({ err }) - one level down is enough for how the
    // agent logs.
    const entries = Object.entries(arg as Record<string, unknown>);
    if (entries.some(([, v]) => isHttpError(v))) return Object.fromEntries(entries.map(([k, v]) => [k, sanitizeArg(v, depth + 1)]));
  }
  return arg;
}

// The arguments as one line of text, safe to write anywhere.
export function sanitizeLogArgs(args: unknown[]): string {
  return redactSecrets(util.format(...args.map((a) => sanitizeArg(a))));
}

let wrapped = false;

// Every console line is cleaned of secrets - also when there is no log file (`npm run dev`, or
// output a service wrapper captures).
function wrapConsole(write: ((level: string, line: string) => void) | null): void {
  if (wrapped) return;
  wrapped = true;
  for (const [method, level] of [
    ["log", "INFO "],
    ["info", "INFO "],
    ["warn", "WARN "],
    ["error", "ERROR"],
  ] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const line = sanitizeLogArgs(args);
      original(line);
      write?.(level, line);
    };
  }
}

export function startFileLog(): void {
  try {
    addLogSecret(agentConfig.getEnrollmentToken());
  } catch {
    // none configured (an enrolled agent needs none)
  }
  if (path.basename(__dirname) !== "dist" || process.env.UEM_LOG_FILE === "off") {
    wrapConsole(null);
    return;
  }

  const dir = logDir();
  const file = path.join(dir, "agent.log");
  try {
    // A link put in place of the log folder would make SYSTEM write wherever it points.
    ensureRealDirSync(dir);
  } catch {
    wrapConsole(null);
    return; // no log file is better than an agent that can't start
  }

  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    size = 0;
  }

  wrapConsole((level, text) => {
    const line = `${new Date().toISOString()} ${level} ${text}\n`;
    try {
      if (size + line.length > MAX_BYTES) {
        fs.rmSync(`${file}.1`, { force: true });
        fs.renameSync(file, `${file}.1`);
        size = 0;
      }
      fs.appendFileSync(file, line);
      size += Buffer.byteLength(line);
    } catch {
      // Disk full / file locked - keep running without the log line.
    }
  });
}
