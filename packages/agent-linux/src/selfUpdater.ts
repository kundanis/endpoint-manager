import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AgentUpdateStatusPayload, AgentUpdateTaskWire } from "@em/shared";
import { agentConfig } from "./config";

const execFileAsync = promisify(execFile);
const SERVICE_NAME = "endpointpro-agent.service";

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// __dirname/../.. from the compiled dist/ location (app/dist/../.. = the install root,
// sibling of node/) — same derivation and layout convention as the Windows agent, so
// config.ts's relative-path tricks work identically on both.
function getInstallDir(): string {
  return path.join(__dirname, "..", "..");
}

async function downloadUpdatePackage(client: AxiosInstance, task: AgentUpdateTaskWire): Promise<string> {
  const downloadsDir = path.join(agentConfig.stateDir, "downloads");
  fs.mkdirSync(downloadsDir, { recursive: true });
  const destPath = path.join(downloadsDir, `agent-update-${task.id}.tar.gz`);

  const response = await client.get("/api/agent/self-update/package", { responseType: "stream" });
  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on("finish", () => resolve());
    writer.on("error", reject);
  });
  return destPath;
}

// No detached-helper-task self-survival trick needed here, unlike the Windows agent's
// buildSelfUpdateScript — the two things that made that necessary on Windows simply don't
// apply on Linux:
//   1. Linux lets you unlink/overwrite a file a running process still has open (the running
//      process keeps its old inode; the path just starts pointing at the new file for
//      anyone who opens it next) — so extracting the new build directly over this very
//      process's own dist/ and node_modules/ while it's still running is completely safe.
//   2. `systemctl restart <own-unit>` is a standard, well-known idiom for a systemd service
//      to restart itself: the request is handled by systemd (PID 1), a wholly separate,
//      unrelated process — not by a parent watching this one — so it's fine for this
//      process to be killed mid-call. No independent "outlives its own task" scheduling is
//      required the way it was for Windows' Scheduled Task-based teardown.
// config.json / .state/state.json are never part of this tarball (see package-installer.sh),
// so extracting over the install root can't touch identity/enrollment either way.
export async function processAgentUpdate(
  client: AxiosInstance,
  task: AgentUpdateTaskWire,
  reportStatus: (payload: AgentUpdateStatusPayload) => Promise<void>,
): Promise<void> {
  if (process.platform !== "linux") {
    await reportStatus({ status: "FAILED", message: "Self-update is only supported on Linux" });
    return;
  }

  const installDir = getInstallDir();
  // Unlike the Windows agent, there's no bundled node/ sibling to check for here — this
  // agent relies on the target's own system Node (see install.sh), not a portable runtime
  // shipped alongside it. Checking for this very file (the packaged app/dist/index.js this
  // process is running from) is a weaker but still meaningful "am I actually a packaged
  // install, not a dev checkout" sanity check — it resolves to something under the repo's
  // packages/ dir in local dev (tsx watch src/index.ts), never a real dist/index.js there.
  if (!fs.existsSync(path.join(installDir, "app", "dist", "index.js"))) {
    await reportStatus({ status: "FAILED", message: "Not a packaged install — self-update is unavailable in this environment" });
    return;
  }

  try {
    await reportStatus({ status: "DOWNLOADING" });
    const tarballPath = await downloadUpdatePackage(client, task);

    const actualSha256 = await sha256File(tarballPath);
    if (actualSha256 !== task.sha256) {
      fs.unlinkSync(tarballPath);
      await reportStatus({ status: "FAILED", message: "SHA-256 mismatch after download — possible corruption or tampering" });
      return;
    }

    await reportStatus({ status: "APPLYING" });

    try {
      await execFileAsync("tar", ["-xzf", tarballPath, "-C", installDir]);
    } catch (err) {
      // Extraction failing partway through leaves whatever files it got to already
      // overwritten — a real risk, but the currently-running process (this one) keeps
      // running unaffected either way since Linux doesn't invalidate its already-open file
      // handles, so at worst this endpoint is left un-updated and reporting FAILED, not
      // crashed or half-broken.
      await reportStatus({ status: "FAILED", message: `tar extraction failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    fs.unlinkSync(tarballPath);

    // Report SUCCESS before triggering the restart — once systemctl asks systemd to stop
    // this unit, this process could be sent SIGTERM at any moment, so anything that still
    // needs this process's own network stack/credentials has to happen first.
    await reportStatus({ status: "SUCCESS" });

    // Fire-and-forget and detached: this process may be killed before systemctl's own CLI
    // invocation would otherwise have returned, which is expected and fine — the restart
    // request has already been handed off to systemd by that point.
    const restart = spawn("systemctl", ["restart", SERVICE_NAME], { detached: true, stdio: "ignore" });
    restart.unref();

    console.log(`Self-update to ${task.targetVersion} applied — restarting ${SERVICE_NAME} now.`);
  } catch (err) {
    await reportStatus({ status: "FAILED", message: err instanceof Error ? err.message : String(err) });
  }
}
