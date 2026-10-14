import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PatchInstallResultPayload, PatchTaskWire } from "@em/shared";
import { parseUpdateId } from "./patchScanner";
import { listSoftwareUpdates } from "./softwareUpdate";

const execFileAsync = promisify(execFile);
const INSTALL_TIMEOUT_MS = 60 * 60 * 1000; // macOS updates are large and slow to prepare

// WUA's OperationResultCode values, reused so patch.service.ts handles macOS results exactly
// like Windows/Linux ones - 2 = Succeeded, 4 = Failed.
const RESULT_SUCCEEDED = 2;
const RESULT_FAILED = 4;

export async function installPatches(task: PatchTaskWire): Promise<PatchInstallResultPayload> {
  const startedAt = new Date().toISOString();

  const targets: { updateId: string; label: string }[] = [];
  const notFound: string[] = [];
  for (const updateId of task.updateIds) {
    const label = parseUpdateId(updateId);
    if (label) targets.push({ updateId, label });
    else notFound.push(updateId);
  }

  // Only install what Apple still offers this Mac right now; anything else was already
  // installed or superseded since the scan.
  let offered: Awaited<ReturnType<typeof listSoftwareUpdates>> = [];
  try {
    offered = await listSoftwareUpdates();
  } catch (err) {
    return {
      status: "FAILED",
      rebootRequired: false,
      results: targets.map((t) => ({ updateId: t.updateId, resultCode: RESULT_FAILED, hresult: null })),
      message: `Could not reach Apple's software update catalog: ${err instanceof Error ? err.message : String(err)}`,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
  const offeredLabels = new Set(offered.map((u) => u.label));
  const installable = targets.filter((t) => offeredLabels.has(t.label));
  for (const t of targets) if (!offeredLabels.has(t.label)) notFound.push(t.updateId);

  if (installable.length === 0) {
    return {
      status: "NOTHING_TO_INSTALL",
      rebootRequired: false,
      results: [],
      message: notFound.length > 0 ? `Update(s) no longer offered: ${notFound.join(", ")}` : null,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  // One update at a time: softwareupdate's exit code is per invocation, so this gives an
  // honest per-update result. Never --restart: the reboot is the admin's call, reported below.
  const results: PatchInstallResultPayload["results"] = [];
  const errors: string[] = [];
  for (const t of installable) {
    try {
      await execFileAsync("softwareupdate", ["--install", t.label, "--agree-to-license"], { timeout: INSTALL_TIMEOUT_MS });
      results.push({ updateId: t.updateId, resultCode: RESULT_SUCCEEDED, hresult: null });
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      const detail = (e.stderr || e.message || "").trim().split("\n").slice(-2).join(" ");
      // Apple silicon: major OS updates need a volume owner's authorisation, which a background
      // root process can't provide - say so plainly instead of a cryptic failure.
      const ownerNeeded = /volume owner|authenticat|password/i.test(detail);
      errors.push(`${t.label}: ${ownerNeeded ? "needs a user's approval on this Mac (Apple silicon OS update)" : detail || "install failed"}`);
      results.push({ updateId: t.updateId, resultCode: RESULT_FAILED, hresult: null });
    }
  }

  // Restart needed if any installed update was flagged "Action: restart".
  const restartLabels = new Set(offered.filter((u) => u.restartRequired).map((u) => u.label));
  const rebootRequired = installable.some(
    (t) => restartLabels.has(t.label) && results.find((r) => r.updateId === t.updateId)?.resultCode === RESULT_SUCCEEDED,
  );

  const anyFailed = results.some((r) => r.resultCode === RESULT_FAILED);
  const anySucceeded = results.some((r) => r.resultCode === RESULT_SUCCEEDED);
  const status = anyFailed && anySucceeded ? "PARTIAL" : anyFailed ? "FAILED" : "SUCCESS";
  const messages = [...errors, ...(notFound.length > 0 ? [`Update(s) no longer offered: ${notFound.join(", ")}`] : [])];

  return {
    status,
    rebootRequired,
    results,
    message: messages.length > 0 ? messages.join("; ") : null,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
