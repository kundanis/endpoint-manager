import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import type { AxiosInstance } from "axios";
import type { DeploymentStatusPayload, DeploymentTaskWire } from "@em/shared";
import { agentConfig } from "./config";

const downloadsDir = () => path.join(agentConfig.stateDir, "downloads");

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

const EXTENSION_BY_TYPE: Record<string, string> = { PKG: ".pkg", SH: ".sh" };

async function downloadPackage(client: AxiosInstance, task: DeploymentTaskWire): Promise<string> {
  fs.mkdirSync(downloadsDir(), { recursive: true });
  const ext = EXTENSION_BY_TYPE[task.installerType] ?? "";
  const destPath = path.join(downloadsDir(), `${task.packageId}${ext}`);

  const response = await client.get(`/api/agent/packages/${task.packageId}/download`, { responseType: "stream" });
  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on("finish", () => resolve());
    writer.on("error", reject);
  });
  return destPath;
}

function run(bin: string, args: string[]): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(bin, args);
    child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
    child.on("error", (err) => resolve({ exitCode: null, output: err.message }));
    child.on("close", (code) => resolve({ exitCode: code, output }));
  });
}

// PKG: Apple's own `installer` (runs as root under launchd, so no prompt). Extra arguments
// from the package's "silent args" field are appended (e.g. "-applyChoiceChangesXML x.xml").
// SH: a self-installing script, run with the package's arguments. Windows/Linux installer
// types sent to a Mac by mistake fail clearly.
function installCommand(filePath: string, task: DeploymentTaskWire): { bin: string; args: string[] } | null {
  const extraArgs = task.silentArgs.trim() ? task.silentArgs.trim().split(/\s+/) : [];
  switch (task.installerType) {
    case "PKG":
      return { bin: "/usr/sbin/installer", args: ["-pkg", filePath, "-target", "/", ...extraArgs] };
    case "SH":
      fs.chmodSync(filePath, 0o755);
      return { bin: "/bin/bash", args: [filePath, ...extraArgs] };
    default:
      return null;
  }
}

export async function processDeployment(
  client: AxiosInstance,
  task: DeploymentTaskWire,
  reportStatus: (payload: DeploymentStatusPayload) => Promise<void>,
): Promise<void> {
  try {
    if (!(task.installerType in EXTENSION_BY_TYPE)) {
      await reportStatus({ status: "FAILED", message: `Installer type ${task.installerType} is not supported on macOS (use PKG or SH)` });
      return;
    }

    await reportStatus({ status: "DOWNLOADING" });
    const filePath = await downloadPackage(client, task);

    const actualSha256 = await sha256File(filePath);
    if (actualSha256 !== task.sha256) {
      await reportStatus({ status: "FAILED", message: "SHA-256 mismatch after download — possible corruption or tampering" });
      return;
    }

    await reportStatus({ status: "INSTALLING" });
    const { bin, args } = installCommand(filePath, task)!;
    const { exitCode, output } = await run(bin, args);

    if (exitCode === 0) {
      await reportStatus({ status: "SUCCESS", exitCode });
    } else {
      const tail = output.trim().split("\n").slice(-3).join(" ");
      await reportStatus({ status: "FAILED", exitCode, message: `Installer exited with code ${exitCode}${tail ? `: ${tail}` : ""}` });
    }
  } catch (err) {
    await reportStatus({ status: "FAILED", message: err instanceof Error ? err.message : String(err) });
  }
}
