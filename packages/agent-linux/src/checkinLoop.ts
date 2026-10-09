import os from "node:os";
import type {
  AgentUpdateStatusPayload,
  AgentUpdateTaskWire,
  CheckinRequest,
  CheckinResponse,
  CommandTaskWire,
  DeploymentStatusPayload,
  DeploymentTaskWire,
  PatchTaskWire,
} from "@em/shared";
import { DEFAULT_POLL_INTERVAL_SEC } from "@em/shared";
import { agentClient, setServerUrls } from "./httpClient";
import { collectInventory } from "./inventory";
import { executeCommand } from "./commandExecutor";
import { processDeployment } from "./packageInstaller";
import { scanForMissingPatches } from "./patchScanner";
import { installPatches } from "./patchInstaller";
import { processAgentUpdate } from "./selfUpdater";
import { agentConfig } from "./config";
import type { AxiosInstance } from "axios";

// This is the Linux agent's "Core + Patch Management" scope — inventory, remote command
// execution, software deployment (DEB/RPM/SH), OS package patch scanning/installing, and
// agent self-update. Everything else the Windows agent has (Security/Data Manager modules:
// DLP, USB control, app control, web/command/IP block, EDR, Zero Trust, security config
// baseline, network scanning, user productivity) was a deliberate scoping decision, not an
// oversight — see the conversation where this was decided. No watchdog task-check either:
// systemd's own Restart=always on the unit (see the packaged .service file) already covers
// what the Windows agent's dual-Scheduled-Task tamper-resistance hack exists to work around.
function getLocalNetworkInfo(): { ipAddress: string | null; macAddress: string | null } {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        const macAddress = iface.mac && iface.mac !== "00:00:00:00:00:00" ? iface.mac : null;
        return { ipAddress: iface.address, macAddress };
      }
    }
  }
  return { ipAddress: null, macAddress: null };
}

export function startCheckinLoop(agentId: string, apiKey: string): void {
  const client = agentClient(agentId, apiKey);
  let pollIntervalSec = DEFAULT_POLL_INTERVAL_SEC;

  async function sendInventory() {
    try {
      const report = await collectInventory();
      await client.post("/api/agent/inventory", report);
      console.log("Inventory reported");
    } catch (err) {
      console.error("Failed to report inventory", err);
    }
  }

  async function sendPatchScan() {
    try {
      const result = await scanForMissingPatches();
      await client.post("/api/agent/patches/scan-result", result);
      console.log(`Patch scan reported — ${result.updates.length} missing update(s)`);
    } catch (err) {
      console.error("Failed to report patch scan", err);
    }
  }

  async function runCommandTasks(client: AxiosInstance, tasks: CommandTaskWire[]) {
    for (const task of tasks) {
      console.log(`Executing command task ${task.id} (${task.shell})`);
      const result = await executeCommand(task);
      try {
        await client.post(`/api/agent/commands/${task.id}/result`, result);
        console.log(`Reported result for command task ${task.id}: ${result.status}`);
      } catch (err) {
        console.error(`Failed to report result for command task ${task.id}`, err);
      }
    }
  }

  async function runDeploymentTasks(client: AxiosInstance, tasks: DeploymentTaskWire[]) {
    for (const task of tasks) {
      console.log(`Processing deployment task ${task.id} (package ${task.packageId})`);
      await processDeployment(client, task, async (payload: DeploymentStatusPayload) => {
        try {
          await client.post(`/api/agent/deployments/${task.id}/status`, payload);
          console.log(`Deployment task ${task.id} status: ${payload.status}`);
        } catch (err) {
          console.error(`Failed to report deployment status for task ${task.id}`, err);
        }
      });
    }
  }

  async function runPatchTasks(client: AxiosInstance, tasks: PatchTaskWire[]) {
    for (const task of tasks) {
      console.log(`Installing patch task ${task.id} (${task.updateIds.length} update(s))`);
      const result = await installPatches(task);
      try {
        await client.post(`/api/agent/patches/tasks/${task.id}/result`, result);
        console.log(
          `Patch task ${task.id} status: ${result.status}${result.rebootRequired ? " (reboot required)" : ""}`,
        );
      } catch (err) {
        console.error(`Failed to report result for patch task ${task.id}`, err);
      }
    }
  }

  // In practice this array is always a singleton — createAgentUpdateJob refuses to create a
  // second in-flight task for an agent that already has one (see agentUpdate.service.ts) —
  // but iterate defensively rather than assume it, same as the Windows agent.
  async function runAgentUpdateTasks(client: AxiosInstance, tasks: AgentUpdateTaskWire[]) {
    for (const task of tasks) {
      console.log(`Processing agent update task ${task.id} (target version ${task.targetVersion})`);
      await processAgentUpdate(client, task, async (payload: AgentUpdateStatusPayload) => {
        try {
          await client.post(`/api/agent/self-update/tasks/${task.id}/status`, payload);
          console.log(`Agent update task ${task.id} status: ${payload.status}`);
        } catch (err) {
          console.error(`Failed to report agent update status for task ${task.id}`, err);
        }
      });
    }
  }

  async function checkin() {
    try {
      const body: CheckinRequest = getLocalNetworkInfo();
      const { data } = await client.post<CheckinResponse>("/api/agent/checkin", body);
      pollIntervalSec = data.pollIntervalSec;
      if (data.serverUrls) setServerUrls(data.serverUrls);

      // Deliberately NOT awaited — see the Windows agent's checkinLoop.ts for the full
      // rationale (the server already flips PENDING -> DISPATCHED the moment a task is
      // included in this response, so nothing here can be redelivered by awaiting slower).
      if (data.commandTasks.length > 0) {
        console.log(`Check-in ok — executing ${data.commandTasks.length} command task(s) in the background`);
        runCommandTasks(client, data.commandTasks).catch((err) => console.error("Command task execution failed", err));
      } else {
        console.log("Check-in ok, no pending tasks");
      }

      if (data.deploymentTasks.length > 0) {
        console.log(`Check-in received ${data.deploymentTasks.length} deployment task(s) — installing in the background`);
        runDeploymentTasks(client, data.deploymentTasks).catch((err) => console.error("Deployment task execution failed", err));
      }

      if (data.patchTasks.length > 0) {
        console.log(`Check-in received ${data.patchTasks.length} patch task(s) — installing in the background`);
        runPatchTasks(client, data.patchTasks).catch((err) => console.error("Patch task execution failed", err));
      }

      if (data.agentUpdateTasks.length > 0) {
        console.log(`Check-in received ${data.agentUpdateTasks.length} agent update task(s)`);
        runAgentUpdateTasks(client, data.agentUpdateTasks).catch((err) => console.error("Agent update task execution failed", err));
      }
    } catch (err) {
      console.error("Check-in failed", err);
    } finally {
      setTimeout(checkin, pollIntervalSec * 1000);
    }
  }

  void sendInventory();
  setInterval(sendInventory, agentConfig.inventoryRefreshMs);
  void sendPatchScan();
  setInterval(sendPatchScan, agentConfig.patchScanIntervalMs);
  void checkin();
}
