import fs from "node:fs";
import path from "node:path";
import util from "node:util";

// The agent runs as a SYSTEM scheduled task, so its console output went nowhere and a
// failure (e.g. an empty software list) left no trace on the endpoint. This mirrors
// console.log/warn/error into app\logs\agent.log (readable by administrators only, like the
// rest of the install folder), keeping one previous file once it passes MAX_BYTES.
//
// Only for the packaged agent (running from dist\) - `npm run dev` keeps plain console output.

const MAX_BYTES = 5 * 1024 * 1024;

export function startFileLog(): void {
  if (path.basename(__dirname) !== "dist" || process.env.UEM_LOG_FILE === "off") return;

  const dir = process.env.UEM_LOG_DIR ?? path.join(__dirname, "..", "logs");
  const file = path.join(dir, "agent.log");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return; // no log file is better than an agent that can't start
  }

  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    size = 0;
  }

  function write(level: string, args: unknown[]) {
    const line = `${new Date().toISOString()} ${level} ${util.format(...args)}\n`;
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
  }

  for (const [method, level] of [
    ["log", "INFO "],
    ["info", "INFO "],
    ["warn", "WARN "],
    ["error", "ERROR"],
  ] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      write(level, args);
    };
  }
}
