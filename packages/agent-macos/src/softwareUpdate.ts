import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// One update offered by Apple's `softwareupdate -l`.
export interface MacUpdate {
  label: string; // what `softwareupdate -i` takes
  title: string;
  version: string | null;
  sizeBytes: number | null;
  recommended: boolean;
  restartRequired: boolean;
}

// macOS 10.15+ format, one pair of lines per update:
//   * Label: macOS Sonoma 14.6-23G80
//   	Title: macOS Sonoma 14.6, Version: 14.6, Size: 1234567KiB, Recommended: YES, Action: restart,
// "Size" is KiB ("1234567KiB") on current releases and "K" on older ones.
const LABEL_LINE = /^\s*\*\s*Label:\s*(.+?)\s*$/;
const DETAIL_LINE = /^\s*Title:\s*(.+?),\s*Version:\s*([^,]*),\s*Size:\s*(\d+)\s*K(?:iB)?,\s*Recommended:\s*(YES|NO),\s*(?:Action:\s*(\w+),?)?/i;

// Pure, exported for tests.
export function parseSoftwareUpdateList(output: string): MacUpdate[] {
  const lines = output.split(/\r?\n/);
  const updates: MacUpdate[] = [];
  for (let i = 0; i < lines.length; i++) {
    const label = LABEL_LINE.exec(lines[i])?.[1];
    if (!label) continue;
    const detail = DETAIL_LINE.exec(lines[i + 1] ?? "");
    if (detail) {
      const [, title, version, sizeKib, recommended, action] = detail;
      updates.push({
        label,
        title: title.trim(),
        version: version.trim() || null,
        sizeBytes: Number(sizeKib) * 1024,
        recommended: recommended.toUpperCase() === "YES",
        restartRequired: (action ?? "").toLowerCase() === "restart",
      });
      i++;
    } else {
      updates.push({ label, title: label, version: null, sizeBytes: null, recommended: false, restartRequired: false });
    }
  }
  return updates;
}

// Security content is called out in the label/title by Apple ("Security Update",
// "Rapid Security Response", "Background Security Improvement"); full OS point releases also
// carry security fixes, so a recommended macOS update counts too.
export function severityOf(update: MacUpdate): string | null {
  const text = `${update.label} ${update.title}`;
  if (/security|rapid security response/i.test(text)) return "HIGH";
  if (update.recommended && /^macOS\b/i.test(update.title)) return "HIGH";
  return null;
}

// Checks Apple's catalog and lists what applies to this Mac. Exit code 0 both with and
// without updates ("No new software available." goes to stderr).
export async function listSoftwareUpdates(): Promise<MacUpdate[]> {
  const { stdout, stderr } = await execFileAsync("softwareupdate", ["--list"], { timeout: 10 * 60 * 1000 });
  return parseSoftwareUpdateList(`${stdout}\n${stderr}`);
}
