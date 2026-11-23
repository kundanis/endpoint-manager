import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import type { AxiosInstance } from "axios";
import type { DeploymentStatusPayload, DeploymentTaskWire } from "@em/shared";
import { agentConfig } from "./config";
import { ensureSecureDir } from "./secureFs";

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
  // SYSTEM runs what lands here: only SYSTEM and administrators may write to the folder.
  await ensureSecureDir(downloadsDir(), { resetChildren: true });
  const ext = task.installerType === "MSI" ? ".msi" : ".exe";
  const destPath = path.join(downloadsDir(), `${path.basename(String(task.packageId))}${ext}`);

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

// Splits an installer's arguments the way a Windows command line would: on spaces, except inside
// double quotes ("C:\Program Files\App" stays one argument, without its quotes). Unquoted text
// splits exactly as before, on runs of white space.
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  let has = false;
  for (const ch of text) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      has = true;
    } else if (!inQuotes && /\s/.test(ch)) {
      if (has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

function runInstaller(filePath: string, task: DeploymentTaskWire): Promise<{ exitCode: number | null }> {
  return new Promise((resolve) => {
    const silentArgs = splitArgs(task.silentArgs ?? "");

    // Never through a shell: the arguments come from the server, and cmd.exe would run anything
    // after a "&" or "|" in them as SYSTEM. Each argument is passed to the installer as it is.
    const child =
      task.installerType === "MSI"
        ? spawn("msiexec.exe", ["/i", filePath, "/quiet", "/norestart", ...silentArgs], { windowsHide: true })
        : spawn(filePath, silentArgs, { windowsHide: true });

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
