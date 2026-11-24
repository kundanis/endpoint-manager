import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import {
  CHROME_STORE_UPDATE_URL,
  EDGE_STORE_UPDATE_URL,
  MAIL_GUARD_DEV_EXTENSION_ID,
  type MailGuardAgentSettings,
} from "@em/shared";
import { getServerUrl } from "./httpClient";

const execFileAsync = promisify(execFile);

// The Endpoint IQ Mail Guard browser extension (browser-extension/ at the repo root), in
// Chrome and Edge, through browser policy under HKLM (a standard user can't change it):
//  - its server address, for every ID the extension can have (store copies and the unpacked
//    test copy), so it always reports to this agent's server;
//  - this endpoint's id and Browser Guard key, for AI Guard prompt protection on AI websites;
//  - a force-install entry for the store copy while the server says an Email attachment
//    blocking policy or AI Guard prompt protection is in use (the browser then installs it and won't let the user remove or
//    disable it), removed again when none is.
// The force-install lists may hold other tools' entries: only values naming our ID are touched.

const BROWSERS = [
  { root: "HKLM\\SOFTWARE\\Policies\\Google\\Chrome", idOf: (s: MailGuardAgentSettings) => s.chromeExtensionId, updateUrl: CHROME_STORE_UPDATE_URL },
  { root: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge", idOf: (s: MailGuardAgentSettings) => s.edgeExtensionId, updateUrl: EDGE_STORE_UPDATE_URL },
];
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function readListValues(key: string): Promise<{ name: string; data: string }[]> {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", key]);
    return stdout
      .split(/\r?\n/)
      .map((line) => /^\s+(\S+)\s+REG_SZ\s+(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ name: m[1], data: m[2].trim() }));
  } catch {
    return []; // key doesn't exist yet
  }
}

async function setForceInstall(root: string, id: string, updateUrl: string, wanted: boolean): Promise<void> {
  const key = `${root}\\ExtensionInstallForcelist`;
  const values = await readListValues(key);
  const ours = values.filter((v) => v.data.toLowerCase().startsWith(`${id.toLowerCase()};`));
  if (wanted && ours.length === 0) {
    const next = values.reduce((max, v) => Math.max(max, Number(v.name) || 0), 0) + 1;
    await execFileAsync("reg.exe", ["add", key, "/v", String(next), "/t", "REG_SZ", "/d", `${id};${updateUrl}`, "/f"]);
  } else if (!wanted) {
    for (const v of ours) await execFileAsync("reg.exe", ["delete", key, "/v", v.name, "/f"]);
  }
}

async function apply(client: AxiosInstance, last: MailGuardAgentSettings | null): Promise<MailGuardAgentSettings | null> {
  // An unreachable server keeps the last known state rather than uninstalling the extension.
  const settings = await client
    .get<MailGuardAgentSettings>("/api/agent/mail-guard")
    .then((r) => r.data)
    .catch(() => last);

  const url = getServerUrl();
  const ids = new Set([MAIL_GUARD_DEV_EXTENSION_ID, settings?.chromeExtensionId, settings?.edgeExtensionId].filter((id): id is string => Boolean(id)));
  for (const browser of BROWSERS) {
    for (const id of ids) {
      const policyKey = `${browser.root}\\3rdparty\\extensions\\${id}\\policy`;
      await execFileAsync("reg.exe", ["add", policyKey, "/v", "serverUrl", "/t", "REG_SZ", "/d", url, "/f"]);
      // AI Guard prompt protection: who this endpoint is, for the extension's calls to
      // /api/ai-guard-ext (the key only covers those - see the server's aiGuardPrompt.service.ts).
      if (settings?.endpointId && settings.endpointKey) {
        await execFileAsync("reg.exe", ["add", policyKey, "/v", "endpointId", "/t", "REG_SZ", "/d", settings.endpointId, "/f"]);
        await execFileAsync("reg.exe", ["add", policyKey, "/v", "endpointKey", "/t", "REG_SZ", "/d", settings.endpointKey, "/f"]);
      }
    }
    const storeId = settings ? browser.idOf(settings) : "";
    if (storeId) await setForceInstall(browser.root, storeId, browser.updateUrl, settings!.install);
  }
  return settings;
}

export function startMailGuardPolicy(client: AxiosInstance): void {
  if (process.platform !== "win32") return;
  let last: MailGuardAgentSettings | null = null;
  const run = () =>
    apply(client, last)
      .then((s) => {
        last = s;
      })
      .catch((err) => console.error("Mail Guard policy write failed", err));
  void run();
  setInterval(run, CHECK_INTERVAL_MS);
}
