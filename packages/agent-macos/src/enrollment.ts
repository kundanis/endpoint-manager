import os from "node:os";
import { execFileSync } from "node:child_process";
import type { EnrollRequest, EnrollResponse } from "@em/shared";
import { agentConfig } from "./config";
import { loadState, saveState } from "./state";
import { publicClient } from "./httpClient";

// The marketing version ("14.5") rather than os.release()'s Darwin kernel version ("23.5.0"),
// which means nothing to an admin. Falls back to the kernel version if sw_vers is unavailable.
function macOsProductVersion(): string {
  try {
    return execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8", timeout: 5000 }).trim() || os.release();
  } catch {
    return os.release();
  }
}

export async function ensureEnrolled(): Promise<{ agentId: string; apiKey: string }> {
  const existing = loadState();
  if (existing) return existing;
  return enroll();
}

// Enrolls with the configured token and replaces any saved identity. Also used when the
// server rejects a saved identity it has never accepted in this run (see httpClient.ts's
// agentClient) - e.g. the server's database was reset, or this endpoint was previously
// enrolled against a different server. The old state.json is only overwritten once the new
// enrollment succeeds, so a failed attempt (token revoked or used up) changes nothing.
export async function enroll(): Promise<{ agentId: string; apiKey: string }> {
  const payload: EnrollRequest = {
    enrollmentToken: agentConfig.getEnrollmentToken(),
    hostname: agentConfig.hostname,
    osPlatform: process.platform, // "darwin" — see agentBuild.service.ts's AgentPlatform
    osVersion: macOsProductVersion(),
    osArch: process.arch,
    agentVersion: agentConfig.agentVersion,
  };

  const { data } = await publicClient.post<EnrollResponse>("/api/agent/enroll", payload);
  saveState(data);
  console.log(`Enrolled as agent ${data.agentId}`);
  return data;
}
