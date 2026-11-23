import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AgentUpdateStatusPayload, AgentUpdateTaskWire } from "@em/shared";
import { agentConfig } from "./config";
import { hardenInstall } from "./installHardening";

const execFileAsync = promisify(execFile);
export const LAUNCHD_LABEL = "com.endpointone.agent";

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// app/dist/../.. = the install root (/Library/EndpointProAgent), sibling of node/.
function getInstallDir(): string {
  return path.join(__dirname, "..", "..");
}

// Removes the folders a previous self-update swapped out. Called once at startup, by which
// point the old process that was still using them has exited.
export function cleanupPreviousVersion(): void {
  const installDir = getInstallDir();
  if (fs.existsSync(path.join(installDir, "app", "dist", "index.js"))) hardenInstall(installDir);
  for (const leftover of ["app.prev", "node.prev"]) {
    try {
      fs.rmSync(path.join(installDir, leftover), { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
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

// The new build is unpacked beside the live install and swapped in by rename (see below),
// then launchd restarts the daemon. `launchctl kickstart -k` is handled by launchd itself
// (PID 1), so it completes even though it kills this process. The tarball never contains
// config.json or .state/ (see package-installer.mjs), so identity and enrollment are
// untouched.
export async function processAgentUpdate(
  client: AxiosInstance,
  task: AgentUpdateTaskWire,
  reportStatus: (payload: AgentUpdateStatusPayload) => Promise<void>,
): Promise<void> {
  if (process.platform !== "darwin") {
    await reportStatus({ status: "FAILED", message: "This is the macOS agent; self-update only runs on macOS" });
    return;
  }

  const installDir = getInstallDir();
  if (!fs.existsSync(path.join(installDir, "app", "dist", "index.js")) || !fs.existsSync(path.join(installDir, "node"))) {
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
    // Unpack beside the live install (same volume, so the swap below is a rename), never over
    // it: rewriting the running, code-signed node binary in place can get it killed by macOS,
    // and a half-copied app/ would leave a broken agent. The package carries node for both
    // architectures; only this Mac's is used (install.sh makes the same choice).
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const staging = path.join(installDir, `.update-${task.id}`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
      // Root extracting: never take owners/modes from the archive (it is built with uid 0 and
      // fixed modes, but don't rely on that); the bits that matter are set explicitly.
      await execFileAsync("/usr/bin/tar", ["--no-same-owner", "--no-same-permissions", "-xzf", tarballPath, "-C", staging]);
      const newApp = path.join(staging, "app");
      const newNode = path.join(staging, "runtime", `node-darwin-${arch}`);
      if (!fs.existsSync(path.join(newApp, "dist", "index.js")) || !fs.existsSync(path.join(newNode, "bin", "node"))) {
        throw new Error("update package is missing app/ or the node runtime for this Mac");
      }
      fs.chmodSync(path.join(newNode, "bin", "node"), 0o755);
      // install.sh keeps app/ (config.json, .state/) private to root; keep it that way.
      fs.chmodSync(newApp, 0o700);

      // Carry this install's identity (config.json, .state/) and any trusted server CA
      // (certs-trust/, from install.sh --ca-cert) into the new app/ - the package never
      // contains them.
      const liveApp = path.join(installDir, "app");
      const liveNode = path.join(installDir, "node");
      for (const keep of ["config.json", ".state", "certs-trust"]) {
        const from = path.join(liveApp, keep);
        if (fs.existsSync(from)) await execFileAsync("/bin/cp", ["-Rp", from, path.join(newApp, keep)]);
      }

      // Swap by rename. The running process keeps its already-open files; the old folders are
      // removed on the next start (cleanupPreviousVersion).
      fs.rmSync(`${liveApp}.prev`, { recursive: true, force: true });
      fs.rmSync(`${liveNode}.prev`, { recursive: true, force: true });
      fs.renameSync(liveApp, `${liveApp}.prev`);
      fs.renameSync(newApp, liveApp);
      fs.renameSync(liveNode, `${liveNode}.prev`);
      fs.renameSync(newNode, liveNode);
    } catch (err) {
      await reportStatus({ status: "FAILED", message: `Applying the update failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(tarballPath, { force: true });
    }

    // Report before restarting - once launchd restarts the daemon this process is gone.
    await reportStatus({ status: "SUCCESS" });
    const restart = spawn("/bin/launchctl", ["kickstart", "-k", `system/${LAUNCHD_LABEL}`], { detached: true, stdio: "ignore" });
    restart.unref();
    console.log(`Self-update to ${task.targetVersion} applied — restarting ${LAUNCHD_LABEL}.`);
  } catch (err) {
    await reportStatus({ status: "FAILED", message: err instanceof Error ? err.message : String(err) });
  }
}
