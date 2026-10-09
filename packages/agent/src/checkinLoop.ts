import os from "node:os";
import type {
  AgentUpdateStatusPayload,
  AgentUpdateTaskWire,
  CheckinRequest,
  CheckinResponse,
  CommandTaskWire,
  DeploymentStatusPayload,
  DeploymentTaskWire,
  NetworkScanTaskWire,
  PatchTaskWire,
} from "@em/shared";
import { DEFAULT_POLL_INTERVAL_SEC } from "@em/shared";
import { agentClient, setServerUrls } from "./httpClient";
import { collectInventory } from "./inventory";
import { executeCommand } from "./commandExecutor";
import { processDeployment } from "./packageInstaller";
import { processAgentUpdate } from "./selfUpdater";
import { scanForMissingPatches } from "./patchScanner";
import { installPatches } from "./patchInstaller";
import { runVlanNetworkScan } from "./networkScanner";
import { runSecurityConfigScan } from "./securityConfigScanner";
import { runZeroTrustScan } from "./zeroTrustScanner";
import { runDataDiscoveryScan } from "./dataDiscoveryScanner";
import { runDataMovementScan } from "./dataMovementScanner";
import { flushDlpEvents, syncDlpPolicy } from "./dlpBridge";
import { runAppControlScan } from "./appControlEnforcer";
import { runWebBlockScan } from "./webBlockEnforcer";
import { runIpBlockScan } from "./ipBlockEnforcer";
import { runUsbControlScan } from "./usbControlEnforcer";
import { ensureWatchdogTaskRegistered } from "./watchdogGuard";
import { runCommandBlockScan } from "./commandBlockEnforcer";
import { runUserProductivityScan } from "./userProductivityScanner";
import { runEdrScan } from "./edrScanner";
import { agentConfig } from "./config";
import type { AxiosInstance } from "axios";

// Computed fresh on every checkin rather than cached at startup — DHCP leases, VPN
// connects/disconnects, and NIC changes can all shift this while the agent keeps running.
// IP and MAC are read from the SAME interface entry (not two separate scans) so they
// always describe one physical NIC, even on a multi-homed machine.
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

  async function sendSecurityConfigScan() {
    try {
      await runSecurityConfigScan(client);
      console.log("Security configuration scan reported");
    } catch (err) {
      console.error("Failed to report security configuration scan", err);
    }
  }

  async function sendZeroTrustScan() {
    try {
      await runZeroTrustScan(client);
      console.log("Zero Trust scan reported");
    } catch (err) {
      console.error("Failed to report Zero Trust scan", err);
    }
  }

  async function sendDataDiscoveryScan() {
    try {
      await runDataDiscoveryScan(client);
      console.log("Data discovery scan reported");
    } catch (err) {
      console.error("Failed to report data discovery scan", err);
    }
  }

  async function sendDataMovementScan() {
    try {
      await runDataMovementScan(client);
      console.log("Data movement scan reported");
    } catch (err) {
      console.error("Failed to report data movement scan", err);
    }
  }

  async function syncDlp() {
    try {
      await syncDlpPolicy(client);
    } catch (err) {
      console.error("Failed to sync DLP policy", err);
    }
  }

  async function flushDlp() {
    try {
      await flushDlpEvents(client);
    } catch (err) {
      console.error("Failed to flush DLP events", err);
    }
  }

  async function sendAppControlScan() {
    try {
      await runAppControlScan(client);
    } catch (err) {
      console.error("App Control scan failed", err);
    }
  }

  async function sendWebBlockScan() {
    try {
      await runWebBlockScan(client);
    } catch (err) {
      console.error("Web Block scan failed", err);
    }
  }

  async function sendIpBlockScan() {
    try {
      await runIpBlockScan(client);
    } catch (err) {
      console.error("IP Block scan failed", err);
    }
  }

  async function sendUsbControlScan() {
    try {
      await runUsbControlScan(client);
    } catch (err) {
      console.error("USB Control scan failed", err);
    }
  }

  async function checkWatchdogTask() {
    try {
      await ensureWatchdogTaskRegistered();
    } catch (err) {
      console.error("Watchdog task check failed", err);
    }
  }

  async function sendCommandBlockScan() {
    try {
      await runCommandBlockScan(client);
    } catch (err) {
      console.error("Command Block scan failed", err);
    }
  }

  async function sendUserProductivityScan() {
    try {
      await runUserProductivityScan(client);
    } catch (err) {
      console.error("User productivity scan failed", err);
    }
  }

  async function sendEdrScan() {
    try {
      await runEdrScan(client);
    } catch (err) {
      console.error("EDR scan failed", err);
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

  async function runNetworkScanTasks(client: AxiosInstance, tasks: NetworkScanTaskWire[]) {
    for (const task of tasks) {
      console.log(`Running VLAN network scan task ${task.id} (cidr ${task.cidr})`);
      await runVlanNetworkScan(client, task);
    }
  }

  // In practice this array is always a singleton — createAgentUpdateJob refuses to create a
  // second in-flight task for an agent that already has one (see agentUpdate.service.ts) —
  // but iterate defensively rather than assume it. A self-update that succeeds tears down
  // and restarts this very process partway through the loop below; any task after it in the
  // array simply never gets its own iteration, which is harmless since there is normally
  // only ever one.
  async function runAgentUpdateTasks(client: AxiosInstance, tasks: AgentUpdateTaskWire[]) {
    for (const task of tasks) {
      console.log(`Processing agent update task ${task.id} (target version ${task.targetVersion})`);
      await processAgentUpdate(client, task, async (payload: AgentUpdateStatusPayload) => {
        // Retried (unlike other task-result reports in this file) because a lost report
        // here — especially a FAILED from a bail-out guard in processAgentUpdate — leaves
        // the task stuck at DISPATCHED with no other signal until the server's own 15-minute
        // reconcileStaleAgentUpdateTasks sweep force-fails it (see agentUpdate.service.ts).
        // A few retries against a transient blip is cheap insurance against that.
        const ATTEMPTS = 3;
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
          try {
            await client.post(`/api/agent/self-update/tasks/${task.id}/status`, payload);
            console.log(`Agent update task ${task.id} status: ${payload.status}`);
            return;
          } catch (err) {
            const isLast = attempt === ATTEMPTS;
            console.error(
              `Failed to report agent update status for task ${task.id} (attempt ${attempt}/${ATTEMPTS})`,
              err,
            );
            if (!isLast) await new Promise((resolve) => setTimeout(resolve, 5_000));
          }
        }
      });
    }
  }

  async function checkin() {
    try {
      const body: CheckinRequest = { ...getLocalNetworkInfo(), agentVersion: agentConfig.agentVersion };
      const { data } = await client.post<CheckinResponse>("/api/agent/checkin", body);
      pollIntervalSec = data.pollIntervalSec;
      if (data.serverUrls) setServerUrls(data.serverUrls);

      // Deliberately NOT awaited: the server already flips each task from PENDING to
      // DISPATCHED the moment it's included in this checkin response, so it can never be
      // redelivered on a later checkin regardless of how long it takes to finish here -
      // that's what makes fire-and-forget safe. Awaiting these used to block this whole
      // checkin() call (and therefore the setTimeout(checkin, ...) reschedule in the
      // finally block below) until every dispatched task finished - a command/deployment/
      // patch running anywhere near or past AGENT_OFFLINE_AFTER_MISSED_POLLS worth of poll
      // intervals made the endpoint show OFFLINE on the dashboard for the entire duration
      // it was legitimately busy, not actually down. Each task still reports its own result
      // independently once it completes.
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

      if (data.networkScanTasks.length > 0) {
        console.log(`Check-in received ${data.networkScanTasks.length} network scan task(s)`);
        await runNetworkScanTasks(client, data.networkScanTasks);
      }

      if (data.runDataDiscoveryScanNow) {
        console.log("Check-in requested an immediate data discovery scan");
        void sendDataDiscoveryScan();
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
  void sendSecurityConfigScan();
  setInterval(sendSecurityConfigScan, agentConfig.securityConfigScanIntervalMs);
  void sendZeroTrustScan();
  setInterval(sendZeroTrustScan, agentConfig.zeroTrustScanIntervalMs);
  void sendDataDiscoveryScan();
  setInterval(sendDataDiscoveryScan, agentConfig.dataDiscoveryScanIntervalMs);
  void sendDataMovementScan();
  setInterval(sendDataMovementScan, agentConfig.dataMovementScanIntervalMs);
  void syncDlp();
  setInterval(syncDlp, agentConfig.dlpPolicySyncIntervalMs);
  void flushDlp();
  setInterval(flushDlp, agentConfig.dlpEventFlushIntervalMs);
  void sendAppControlScan();
  setInterval(sendAppControlScan, agentConfig.appControlScanIntervalMs);
  void sendWebBlockScan();
  setInterval(sendWebBlockScan, agentConfig.webBlockScanIntervalMs);
  void sendCommandBlockScan();
  setInterval(sendCommandBlockScan, agentConfig.commandBlockScanIntervalMs);
  void sendIpBlockScan();
  setInterval(sendIpBlockScan, agentConfig.ipBlockScanIntervalMs);
  void sendUsbControlScan();
  setInterval(sendUsbControlScan, agentConfig.usbControlScanIntervalMs);
  void checkWatchdogTask();
  setInterval(checkWatchdogTask, agentConfig.watchdogCheckIntervalMs);
  void sendUserProductivityScan();
  setInterval(sendUserProductivityScan, agentConfig.userProductivityScanIntervalMs);
  void sendEdrScan();
  setInterval(sendEdrScan, agentConfig.edrScanIntervalMs);
  void checkin();
}
