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

function runProcess(bin: string, args: string[]): Promise<{ exitCode: number | null; errorCode?: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args);
    child.on("error", (err: NodeJS.ErrnoException) => resolve({ exitCode: null, errorCode: err.code }));
    child.on("close", (code) => resolve({ exitCode: code }));
  });
}

// Splits the package's "silent args" the way a POSIX shell would split words - whitespace,
// '...' literal, "..." with \" \ \$ \` escapes, \x outside quotes - but with no expansion,
// substitution, redirection or chaining: each word becomes exactly one argv entry.
export function splitArgs(input: string): string[] {
  const args: string[] = [];
  let cur = "";
  let inWord = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new Error("Unterminated ' in installer arguments");
      cur += input.slice(i + 1, end);
      i = end;
      inWord = true;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < input.length && input[j] !== '"'; j++) {
        if (input[j] === "\\" && j + 1 < input.length && '"\$`'.includes(input[j + 1])) j++;
        cur += input[j];
      }
      if (j >= input.length) throw new Error('Unterminated " in installer arguments');
      i = j;
      inWord = true;
    } else if (c === "\\" && i + 1 < input.length) {
      cur += input[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) args.push(cur);
      cur = "";
      inWord = false;
    } else {
      cur += c;
      inWord = true;
    }
  }
  if (inWord) args.push(cur);
  return args;
}

// Runs the installer as argv arrays (no shell), so nothing in the file name or the package's
// silent args can be interpreted as shell syntax by root.
async function runInstaller(filePath: string, task: DeploymentTaskWire): Promise<{ exitCode: number | null; message?: string }> {
  switch (task.installerType) {
    case "DEB": {
      // apt-get -f install only matters if dpkg -i reported unmet dependencies - running it
      // unconditionally is a harmless no-op, and (as with the old `dpkg -i x; apt-get -y -f
      // install`) its exit code is the result.
      await runProcess("dpkg", ["-i", filePath]);
      return runProcess("apt-get", ["-y", "-f", "install"]);
    }
    case "RPM":
      // -U (upgrade-or-install) rather than -i so re-pushing the same or a newer version of
      // an already-installed package doesn't fail with "package already installed".
      return runProcess("rpm", ["-Uvh", filePath]);
    case "SH": {
      const extraArgs = splitArgs(task.silentArgs.trim());
      fs.chmodSync(filePath, 0o755);
      const result = await runProcess(filePath, extraArgs);
      // No #! line: run it with sh, as the shell used to.
      if (result.errorCode === "ENOEXEC") return runProcess("sh", [filePath, ...extraArgs]);
      return result;
    }
    default:
      // EXE/MSI dispatched to a Linux agent by mistake (e.g. a mixed-OS group) — fail
      // clearly rather than attempting something meaningless.
      return { exitCode: null, message: `Installer type ${task.installerType} is not supported on Linux` };
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
    const { exitCode, message } = await runInstaller(filePath, task);

    if (exitCode === 0) {
      await reportStatus({ status: "SUCCESS", exitCode });
    } else {
      await reportStatus({ status: "FAILED", exitCode, message: message ?? `Installer exited with code ${exitCode}` });
    }
  } catch (err) {
    await reportStatus({ status: "FAILED", message: err instanceof Error ? err.message : String(err) });
  }
}
