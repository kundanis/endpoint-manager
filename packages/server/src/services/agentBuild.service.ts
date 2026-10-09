import fs from "node:fs";
import type { AgentBuildManifest } from "@em/shared";
import { agentBuildManifestSchema } from "@em/shared";
import { config } from "../config";

// Matches Agent.osPlatform verbatim (stored exactly as process.platform reported it at
// enrollment — see enrollment.service.ts) — only these two are meaningfully supported by
// any packaging pipeline today. An agent enrolled from any other platform simply never has
// a build available to it (getLatestAgentBuild returns null), which degrades to "no update
// available" rather than an error.
export type AgentPlatform = "win32" | "linux";

function manifestPathFor(platform: AgentPlatform): string {
  return platform === "linux" ? config.agentManifestPathLinux : config.agentManifestPath;
}

function installerPathFor(platform: AgentPlatform): string {
  return platform === "linux" ? config.agentInstallerTarballPathLinux : config.agentInstallerZipPath;
}

// Read fresh off disk on every call rather than cached in memory or the DB - this file
// only ever changes when a new deployment/update package gets staged onto THIS server
// (which already means a process restart via update.ps1/setup.ps1), so there is no
// staleness window worth optimizing away, and "always reflects what's actually on disk
// right now" is worth more than the few milliseconds a cache would save.
export function getLatestAgentBuild(platform: AgentPlatform): AgentBuildManifest | null {
  const manifestPath = manifestPathFor(platform);
  const installerPath = installerPathFor(platform);
  if (!fs.existsSync(manifestPath) || !fs.existsSync(installerPath)) return null;

  try {
    // Windows PowerShell 5.1's `Set-Content -Encoding UTF8` (used by package-installer.ps1
    // to write the Windows manifest) writes a leading BOM, which JSON.parse rejects - same
    // issue already documented and worked around for the agent's own config.json (see
    // packages/agent/src/config.ts's readInstallConfig). The Linux manifest is written by a
    // plain bash heredoc and never has one, but stripping it unconditionally is harmless.
    const rawWithBom = fs.readFileSync(manifestPath, "utf8");
    const raw = rawWithBom.charCodeAt(0) === 0xfeff ? rawWithBom.slice(1) : rawWithBom;
    return agentBuildManifestSchema.parse(JSON.parse(raw));
  } catch {
    // A malformed/half-written manifest (e.g. caught mid-copy during a package deploy)
    // should degrade to "no update available" rather than 500 every agent-list/dispatch
    // request until someone notices and fixes the file.
    return null;
  }
}
