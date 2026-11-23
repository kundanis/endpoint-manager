import os from "node:os";
import si from "systeminformation";
import { execFileSync } from "node:child_process";
import { selectPrimaryNetworkInterface, type EnrollRequest, type EnrollResponse } from "@em/shared";
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

// Hardware identity sent with enrollment so the server can tell a reinstall on this same
// machine from someone else enrolling under this hostname (server enrollment.service.ts).
// Same sources as inventory and check-in report, so the values match what the server has on
// record. Best effort: enrollment never fails because these can't be read.
async function hardwareIdentity(): Promise<{ serialNumber: string | null; macAddress: string | null }> {
  let serialNumber: string | null = null;
  try {
    const system = await si.system();
    serialNumber = system.serial && system.serial !== "0" ? system.serial.trim().slice(0, 100) : null;
  } catch {
    // leave null
  }
  return { serialNumber, macAddress: selectPrimaryNetworkInterface(os.networkInterfaces()).macAddress };
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
    ...(await hardwareIdentity()),
  };

  const { data } = await publicClient.post<EnrollResponse>("/api/agent/enroll", payload);
  saveState(data);
  console.log(`Enrolled as agent ${data.agentId}`);
  return data;
}
