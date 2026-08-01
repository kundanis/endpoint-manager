import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AssignedZeroTrustPolicyWire, ZeroTrustScanResultPayload } from "@em/shared";
import { SECURITY_CHECK_TIMEOUT_MS } from "@em/shared";

const execFileAsync = promisify(execFile);

async function runCheck(checkPowerShell: string): Promise<{ actualValue: string | null; error: string | null }> {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", checkPowerShell],
      { maxBuffer: 5 * 1024 * 1024, timeout: SECURITY_CHECK_TIMEOUT_MS },
    );
    return { actualValue: stdout.trim(), error: null };
  } catch (err) {
    return { actualValue: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// Same shape as securityConfigScanner.ts — fetch whichever policies are assigned
// (directly or via group membership), run each condition's check, report raw
// results. Grading happens server-side (see zeroTrustScan.service.ts).
export async function runZeroTrustScan(client: AxiosInstance): Promise<void> {
  if (process.platform !== "win32") return;

  const { data: assigned } = await client.get<AssignedZeroTrustPolicyWire[]>("/api/agent/zero-trust/assigned");

  for (const policy of assigned) {
    try {
      const scannedAt = new Date().toISOString();
      const results: ZeroTrustScanResultPayload["results"] = [];

      for (const condition of policy.conditions) {
        const { actualValue, error } = await runCheck(condition.checkPowerShell);
        results.push({ conditionId: condition.conditionId, actualValue, error });
      }

      const payload: ZeroTrustScanResultPayload = { scannedAt, policyId: policy.policyId, results };
      await client.post("/api/agent/zero-trust/scan-result", payload);
    } catch (err) {
      console.error(`Failed to scan/report zero trust policy ${policy.policyId}`, err);
    }
  }
}
