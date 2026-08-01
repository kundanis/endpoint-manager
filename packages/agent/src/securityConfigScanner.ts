import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AssignedBenchmarkWire, SecurityConfigScanResultPayload } from "@em/shared";
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

// Fetches whichever benchmarks are currently assigned to this agent (directly or via
// group membership — resolved server-side) and scans+reports each independently.
// Grading against expectedValue/operator happens server-side on ingestion, not here —
// the agent only runs checks and reports the raw result.
export async function runSecurityConfigScan(client: AxiosInstance): Promise<void> {
  if (process.platform !== "win32") return;

  const { data: assigned } = await client.get<AssignedBenchmarkWire[]>("/api/agent/security-config/assigned");

  for (const benchmark of assigned) {
    try {
      const scannedAt = new Date().toISOString();
      const results: SecurityConfigScanResultPayload["results"] = [];

      // Each rule runs independently — one hung/broken check must not abort the rest
      // of the benchmark's checks (runCheck already catches its own execFile errors).
      for (const rule of benchmark.rules) {
        const { actualValue, error } = await runCheck(rule.checkPowerShell);
        results.push({ ruleId: rule.ruleId, actualValue, error });
      }

      const payload: SecurityConfigScanResultPayload = {
        scannedAt,
        benchmarkId: benchmark.benchmarkId,
        results,
      };
      await client.post("/api/agent/security-config/scan-result", payload);
    } catch (err) {
      console.error(`Failed to scan/report security benchmark ${benchmark.benchmarkId}`, err);
    }
  }
}
