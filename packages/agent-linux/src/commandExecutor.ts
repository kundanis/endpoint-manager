import { spawn } from "node:child_process";
import type { CommandTaskResultPayload, CommandTaskWire } from "@em/shared";
import { MAX_COMMAND_OUTPUT_BYTES } from "@em/shared";

class BoundedBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  private truncated = false;

  append(chunk: Buffer): void {
    if (this.truncated) return;
    const remaining = MAX_COMMAND_OUTPUT_BYTES - this.size;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    const toAppend = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    this.chunks.push(toAppend);
    this.size += toAppend.length;
    if (chunk.length > remaining) this.truncated = true;
  }

  toString(): string {
    const text = Buffer.concat(this.chunks).toString("utf-8");
    return this.truncated ? `${text}\n...[truncated]` : text;
  }
}

// Runs an admin-issued script via spawn (not exec, so output streams rather than
// buffering unbounded in one shot). Trusts script content — the security boundary here
// is admin auth + HTTPS + per-agent token scoping, not command allow-listing. A
// powershell/cmd task dispatched to a Linux agent (e.g. a mixed-OS group with the wrong
// shell picked) fails fast with a plain "spawn ENOENT" rather than silently no-oping,
// same as the reverse case on the Windows agent.
export function executeCommand(task: CommandTaskWire): Promise<CommandTaskResultPayload> {
  const startedAt = new Date().toISOString();
  const stdout = new BoundedBuffer();
  const stderr = new BoundedBuffer();

  return new Promise((resolve) => {
    const shellBinary = task.shell === "sh" ? "sh" : "bash";
    const child = spawn(shellBinary, ["-c", task.script]);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, task.timeoutSec * 1000);

    child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        status: "FAILED",
        exitCode: null,
        stdout: stdout.toString(),
        stderr: `${stderr.toString()}\n[agent error: ${err.message}]`,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        status: timedOut ? "TIMEOUT" : code === 0 ? "SUCCESS" : "FAILED",
        exitCode: code,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        startedAt,
        completedAt: new Date().toISOString(),
      });
    });
  });
}
