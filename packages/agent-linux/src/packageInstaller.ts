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

const EXTENSION_BY_TYPE: Record<string, string> = { DEB: ".deb", RPM: ".rpm", SH: ".sh" };

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

function runShellCommand(command: string): Promise<{ exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command]);
    child.on("error", () => resolve({ exitCode: null }));
    child.on("close", (code) => resolve({ exitCode: code }));
  });
}

// A single quoted shell command string, not spawn(bin, args) directly, because DEB installs
// need a fallback step (`dpkg -i` alone leaves unmet dependencies unresolved — apt-get -f
// repairs them) chained with the same shell exit-code semantics an admin typing this by
// hand at a terminal would get.
function buildInstallCommand(filePath: string, task: DeploymentTaskWire): string {
  const quotedPath = `'${filePath.replace(/'/g, "'\\''")}'`;
  const extraArgs = task.silentArgs.trim();

  switch (task.installerType) {
    case "DEB":
      // apt-get -f install only runs (and only matters) if the first dpkg -i reported unmet
      // dependencies — running it unconditionally on success too is a harmless no-op.
      return `dpkg -i ${quotedPath}; apt-get -y -f install`;
    case "RPM":
      // -U (upgrade-or-install) rather than -i so re-pushing the same or a newer version of
      // an already-installed package doesn't fail with "package already installed".
      return `rpm -Uvh ${quotedPath}`;
    case "SH":
      return `chmod +x ${quotedPath} && ${quotedPath}${extraArgs ? ` ${extraArgs}` : ""}`;
    default:
      // EXE/MSI dispatched to a Linux agent by mistake (e.g. a mixed-OS group) — fail
      // clearly rather than attempting something meaningless.
      return `echo "Installer type ${task.installerType} is not supported on Linux" >&2; exit 1`;
  }
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
    const { exitCode } = await runShellCommand(buildInstallCommand(filePath, task));

    if (exitCode === 0) {
      await reportStatus({ status: "SUCCESS", exitCode });
    } else {
      await reportStatus({ status: "FAILED", exitCode, message: `Installer exited with code ${exitCode}` });
    }
  } catch (err) {
    await reportStatus({ status: "FAILED", message: err instanceof Error ? err.message : String(err) });
  }
}
