import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// app/dist/../.. = the install root (/opt/endpointpro-agent).
export function getInstallDir(): string {
  return path.join(__dirname, "..", "..");
}

// Earlier self-updates extracted a tarball built on Windows as root while keeping its
// owners, so the install tree (and the install dir itself, from the "./" entry) could end up
// owned by an arbitrary local UID - whoever has that UID could swap the code root runs. Run
// at startup and after every self-update: if anything that matters isn't root-owned or is
// group/world-writable, give the whole tree back to root and strip those write bits.
export async function hardenInstallDir(force = false): Promise<void> {
  if (process.platform !== "linux" || process.getuid?.() !== 0) return;
  const installDir = getInstallDir();
  if (!fs.existsSync(path.join(installDir, "app", "dist", "index.js"))) return; // dev checkout

  const needsFix =
    force ||
    ["", "app", "app/dist", "app/node_modules", "runtime"].some((rel) => {
      try {
        const st = fs.lstatSync(path.join(installDir, rel));
        return st.uid !== 0 || st.gid !== 0 || (st.mode & 0o022) !== 0;
      } catch {
        return false; // missing (e.g. no runtime/ on old installs)
      }
    });
  if (!needsFix) return;

  try {
    // -h/-P: never follow a symlink out of the install tree.
    await execFileAsync("chown", ["-R", "-h", "0:0", installDir]);
    await execFileAsync("chmod", ["-R", "go-w", installDir]);
    const configPath = path.join(installDir, "app", "config.json");
    if (fs.existsSync(configPath)) fs.chmodSync(configPath, 0o600);
    const stateDir = path.join(installDir, "app", ".state");
    if (fs.existsSync(stateDir)) fs.chmodSync(stateDir, 0o700);
    console.log(`Reset ownership and permissions of ${installDir} to root`);
  } catch (err) {
    console.error(`Couldn't reset ownership of ${installDir}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
