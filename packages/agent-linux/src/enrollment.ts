import os from "node:os";
import type { EnrollRequest, EnrollResponse } from "@em/shared";
import { agentConfig } from "./config";
import { loadState, saveState } from "./state";
import { publicClient } from "./httpClient";

export async function ensureEnrolled(): Promise<{ agentId: string; apiKey: string }> {
  const existing = loadState();
  if (existing) return existing;

  const payload: EnrollRequest = {
    enrollmentToken: agentConfig.getEnrollmentToken(),
    hostname: agentConfig.hostname,
    osPlatform: process.platform, // "linux" — see agentBuild.service.ts's AgentPlatform
    osVersion: os.release(),
    osArch: process.arch,
    agentVersion: agentConfig.agentVersion,
  };

  const { data } = await publicClient.post<EnrollResponse>("/api/agent/enroll", payload);
  saveState(data);
  console.log(`Enrolled as agent ${data.agentId}`);
  return data;
}
