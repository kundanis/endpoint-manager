import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PatchInstallResultPayload, PatchTaskWire } from "@em/shared";
import { detectPackageManager, installUpdateCommand, scanForUpgrades } from "./packageManager";
import { buildUpdateId } from "./patchScanner";

const execFileAsync = promisify(execFile);
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000; // downloads + install can genuinely take a while

// WUA's own OperationResultCode values, reused verbatim (see patch.schema.ts's
// patchInstallResultItemSchema comment) so patch.service.ts's existing
// WUA_SUCCESS_CODES-based "reflect successful installs immediately" logic works completely
// unchanged for Linux results too — 2=Succeeded, 4=Failed.
const RESULT_SUCCEEDED = 2;
const RESULT_FAILED = 4;

// Both Debian and RPM version strings can themselves contain a colon (an epoch prefix,
// e.g. "1:3.0.7-27.el9_3" or "1:3.0.2-0ubuntu1.7") - a naive 4-way split(":") would chop
// that apart and reject an otherwise-valid updateId as malformed. manager and packageName
// never contain colons in either package-manager's own naming rules, so only the version
// needs to tolerate embedded ones - rejoin everything after the 3rd colon.
function parseUpdateId(updateId: string): { manager: string; packageName: string; newVersion: string } | null {
  const parts = updateId.split(":");
  if (parts.length < 4 || parts[0] !== "linux") return null;
  const [, manager, packageName, ...versionParts] = parts;
  return { manager, packageName, newVersion: versionParts.join(":") };
}

export async function installPatches(task: PatchTaskWire): Promise<PatchInstallResultPayload> {
  const startedAt = new Date().toISOString();

  const manager = await detectPackageManager();
  if (!manager) {
    return {
      status: "FAILED",
      rebootRequired: false,
      results: task.updateIds.map((updateId) => ({ updateId, resultCode: RESULT_FAILED, hresult: null })),
      message: "No supported package manager (apt/dnf/yum) found on this endpoint",
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  // Only act on IDs that actually belong to THIS endpoint's own package manager — an ID
  // built for a different manager (shouldn't normally happen; see comment in
  // packageManager.ts) is reported not-found rather than attempted, mirroring the Windows
  // agent's own handling of a no-longer-offered updateId.
  const targets: { updateId: string; packageName: string }[] = [];
  const notFound: string[] = [];
  for (const updateId of task.updateIds) {
    const parsed = parseUpdateId(updateId);
    if (!parsed || parsed.manager !== manager) {
      notFound.push(updateId);
      continue;
    }
    targets.push({ updateId, packageName: parsed.packageName });
  }

  if (targets.length === 0) {
    return {
      status: "NOTHING_TO_INSTALL",
      rebootRequired: false,
      results: [],
      message: notFound.length > 0 ? `Update(s) no longer offered: ${notFound.join(", ")}` : null,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  try {
    const { bin, args } = installUpdateCommand(
      manager,
      targets.map((t) => t.packageName),
    );
    // apt-get/dnf/yum all run fully non-interactively as root under systemd (no TTY to
    // prompt on) — DEBIAN_FRONTEND=noninteractive additionally suppresses apt's occasional
    // "restart services?" / config-file-conflict prompts that would otherwise hang forever
    // with no TTY to answer them.
    await execFileAsync(bin, args, { timeout: INSTALL_TIMEOUT_MS, env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" } });
  } catch (err) {
    // The batch command itself failed outright (e.g. lock held by another process, network
    // down mid-download) — every targeted package is presumed failed rather than guessing
    // per-package from a mixed stdout/stderr transaction log.
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "FAILED",
      rebootRequired: false,
      results: targets.map((t) => ({ updateId: t.updateId, resultCode: RESULT_FAILED, hresult: null })),
      message,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  // apt-get/dnf/yum report one overall exit code for a whole batch, not per-package
  // granularity — re-scanning and checking which targeted packages are STILL upgradable is
  // the only reliable way to tell which ones actually landed.
  let stillUpgradable = new Set<string>();
  try {
    const rescanned = await scanForUpgrades(manager);
    stillUpgradable = new Set(rescanned.map((u) => u.packageName));
  } catch {
    // Rescan failing doesn't mean the install failed — fall back to assuming success for
    // everything the batch command didn't throw on, same optimistic default the batch
    // command's own zero exit code already implied.
  }

  const results = targets.map((t) => ({
    updateId: t.updateId,
    resultCode: stillUpgradable.has(t.packageName) ? RESULT_FAILED : RESULT_SUCCEEDED,
    hresult: null,
  }));

  const anyFailed = results.some((r) => r.resultCode === RESULT_FAILED);
  const anySucceeded = results.some((r) => r.resultCode === RESULT_SUCCEEDED);
  const status = anyFailed && anySucceeded ? "PARTIAL" : anyFailed ? "FAILED" : "SUCCESS";

  // A kernel/glibc update is the closest Linux equivalent to a Windows patch needing a
  // reboot — checking for it is standard practice on both major distro families
  // (/var/run/reboot-required is written by Debian/Ubuntu's own update-notifier-common
  // package; needs-restarting -r is the RHEL/Fedora dnf-utils equivalent). Best-effort: a
  // missing file or missing needs-restarting binary just means "assume no reboot needed"
  // rather than failing the whole result.
  const rebootRequired = await checkRebootRequired(manager);

  return {
    status,
    rebootRequired,
    results,
    message: notFound.length > 0 ? `Update(s) no longer offered: ${notFound.join(", ")}` : null,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

async function checkRebootRequired(manager: "apt" | "dnf" | "yum"): Promise<boolean> {
  try {
    if (manager === "apt") {
      const fs = await import("node:fs");
      return fs.existsSync("/var/run/reboot-required");
    }
    // needs-restarting -r exits 1 when a reboot IS required (a genuinely documented,
    // intentional exit code — see `man needs-restarting`), so a non-zero exit here means
    // "yes" rather than "the check itself failed".
    await execFileAsync("needs-restarting", ["-r"]);
    return false;
  } catch (err) {
    const execErr = err as { code?: number };
    return execErr.code === 1;
  }
}
