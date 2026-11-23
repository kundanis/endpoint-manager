import fs from "node:fs";
import path from "node:path";

// launchd writes this daemon's stdout/stderr to agent.log here (see the plist). install.sh
// creates the folder 0700 and the file 0600 now; installs made before that left the folder
// 0755 and the file world-readable, so this repairs them at every start (as root).
export const LOG_DIR = "/Library/Logs/EndpointProAgent";
const LOG_FILE = path.join(LOG_DIR, "agent.log");

export function hardenInstall(installDir: string): void {
  if (process.platform !== "darwin" || process.getuid?.() !== 0) return;
  const fixes: [string, number][] = [
    [LOG_DIR, 0o700],
    [LOG_FILE, 0o600],
    // A self-update swaps in an app/ unpacked with the tarball's 0755; it holds config.json.
    [path.join(installDir, "app"), 0o700],
    [path.join(installDir, "app", "config.json"), 0o600],
  ];
  for (const [target, mode] of fixes) {
    try {
      const st = fs.lstatSync(target);
      if (st.isSymbolicLink()) continue;
      if (st.uid !== 0) fs.chownSync(target, 0, 0); // root:wheel
      if ((st.mode & 0o777) !== mode) fs.chmodSync(target, mode);
    } catch {
      // missing (dev checkout, no log yet) - nothing to fix
    }
  }
}
