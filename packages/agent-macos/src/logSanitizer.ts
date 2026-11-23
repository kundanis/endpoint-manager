import util from "node:util";

// Keeps secrets out of the agent's logs (journald on Linux, the launchd log file here). Most failures
// are logged as console.error("...", err) with an AxiosError, and printing one dumps
// err.config.headers (X-Agent-Key), err.config.data (the enrollment token) and the raw
// request headers. Installed once at startup (index.ts): every console call is formatted
// here, AxiosErrors shrink to message + method + path + status, and anything that still
// looks like a key or token is masked.

const REDACTED = "[redacted]";

// key/token name, then optional quotes (plain, escaped or single) around ":" or "=", then the
// value up to the next quote, whitespace, comma, brace or "&".
const SECRET_PATTERNS: RegExp[] = [
  /(x-agent-key[\\"']*\s*[:=]\s*[\\"']*)[^\\"'\s,}&]+/gi,
  /(enrollment[-_]?token[\\"']*\s*[:=]\s*[\\"']*)[^\\"'\s,}&]+/gi,
  /(--enrollment-token\s+[\\"']*)[^\\"'\s]+/gi,
  /(api[-_]?key[\\"']*\s*[:=]\s*[\\"']*)[^\\"'\s,}&]+/gi,
  /(authorization[\\"']*\s*[:=]\s*[\\"']*(?:bearer\s+)?)[^\\"'\s,}&]+/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, `$1${REDACTED}`);
  return out;
}

interface AxiosErrorLike {
  message?: string;
  code?: string;
  config?: { method?: string; url?: string; baseURL?: string };
  response?: { status?: number };
}

function isAxiosErrorLike(value: unknown): value is AxiosErrorLike {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.isAxiosError === true || ("config" in v && "request" in v);
}

// Path only: the query string could carry something sensitive too.
function requestPath(config: AxiosErrorLike["config"]): string {
  if (!config?.url) return "";
  try {
    return new URL(config.url, config.baseURL || "http://agent.invalid").pathname;
  } catch {
    return config.url.split("?")[0];
  }
}

export function summarizeAxiosError(err: AxiosErrorLike): string {
  const parts = [err.message || "Request failed"];
  if (err.code) parts.push(`[${err.code}]`);
  const method = err.config?.method?.toUpperCase();
  const pathname = requestPath(err.config);
  if (method || pathname) parts.push(`(${[method, pathname].filter(Boolean).join(" ")})`);
  if (err.response?.status) parts.push(`HTTP ${err.response.status}`);
  return redactSecrets(parts.join(" "));
}

function sanitizeArg(arg: unknown): unknown {
  if (isAxiosErrorLike(arg)) return summarizeAxiosError(arg);
  // An Error wrapping an AxiosError (err.cause) - keep the outer message, summarize the cause.
  if (arg instanceof Error && isAxiosErrorLike((arg as { cause?: unknown }).cause)) {
    return `${arg.message} (cause: ${summarizeAxiosError((arg as { cause: AxiosErrorLike }).cause)})`;
  }
  return arg;
}

export function formatLogLine(args: unknown[]): string {
  return redactSecrets(util.format(...args.map(sanitizeArg)));
}

let installed = false;

export function installLogSanitizer(): void {
  if (installed) return;
  installed = true;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => original(formatLogLine(args));
  }
}
