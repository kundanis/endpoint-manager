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

async function downloadPackage(client: AxiosInstance, task: DeploymentTaskWire): Promise<string> {
  fs.mkdirSync(downloadsDir(), { recursive: true });
  const ext = task.installerType === "MSI" ? ".msi" : ".exe";
  const destPath = path.join(downloadsDir(), `${task.packageId}${ext}`);

  const response = await client.get(`/api/agent/packages/${task.packageId}/download`, {
    responseType: "stream",
  });

  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on("finish", () => resolve());
    writer.on("error", reject);
  });

  return destPath;
}

function runInstaller(filePath: string, task: DeploymentTaskWire): Promise<{ exitCode: number | null }> {
  return new Promise((resolve) => {
    const silentArgs = task.silentArgs.trim().length > 0 ? task.silentArgs.trim().split(/\s+/) : [];

    // shell:true for the EXE case because spawn without a shell doesn't reliably
    // parse a quoted argument string the way a normal command line would.
    const child =
      task.installerType === "MSI"
        ? spawn("msiexec.exe", ["/i", filePath, "/quiet", "/norestart", ...silentArgs])
        : spawn(filePath, silentArgs, { shell: true });

    child.on("error", () => resolve({ exitCode: null }));
    child.on("close", (code) => resolve({ exitCode: code }));
  });
}

export async function processDeployment(
  client: AxiosInstance,
  task: DeploymentTaskWire,
  reportStatus: (payload: DeploymentStatusPayload) => Promise<void>,
): Promise<void> {
  try {
    await reportStatus({ status: "DOWNLOADING" });
    const filePath = await downloadPackage(client, task);

    const actualSha256 = await sha256File(filePath);
    if (actualSha256 !== task.sha256) {
      await reportStatus({
        status: "FAILED",
        message: "SHA-256 mismatch after download — possible corruption or tampering",
      });
      return;
    }

    await reportStatus({ status: "INSTALLING" });
    const { exitCode } = await runInstaller(filePath, task);

    if (exitCode === 0) {
      await reportStatus({ status: "SUCCESS", exitCode });
    } else {
      await reportStatus({ status: "FAILED", exitCode, message: `Installer exited with code ${exitCode}` });
    }
  } catch (err) {
    await reportStatus({ status: "FAILED", message: err instanceof Error ? err.message : String(err) });
  }
}
