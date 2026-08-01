import os from "node:os";
import type {
  CheckinRequest,
  CheckinResponse,
  CommandTaskWire,
  DeploymentStatusPayload,
  DeploymentTaskWire,
  NetworkScanTaskWire,
  PatchTaskWire,
} from "@em/shared";
import { DEFAULT_POLL_INTERVAL_SEC } from "@em/shared";
import { agentClient } from "./httpClient";
import { collectInventory } from "./inventory";
import { executeCommand } from "./commandExecutor";
import { processDeployment } from "./packageInstaller";
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

  async function checkin() {
    try {
      const body: CheckinRequest = getLocalNetworkInfo();
      const { data } = await client.post<CheckinResponse>("/api/agent/checkin", body);
      pollIntervalSec = data.pollIntervalSec;

      if (data.commandTasks.length > 0) {
        console.log(`Check-in ok — executing ${data.commandTasks.length} command task(s)`);
        await runCommandTasks(client, data.commandTasks);
      } else {
        console.log("Check-in ok, no pending tasks");
      }

      if (data.deploymentTasks.length > 0) {
        console.log(`Check-in received ${data.deploymentTasks.length} deployment task(s) — installing`);
        await runDeploymentTasks(client, data.deploymentTasks);
      }

      if (data.patchTasks.length > 0) {
        console.log(`Check-in received ${data.patchTasks.length} patch task(s) — installing`);
        await runPatchTasks(client, data.patchTasks);
      }

      if (data.networkScanTasks.length > 0) {
        console.log(`Check-in received ${data.networkScanTasks.length} network scan task(s)`);
        await runNetworkScanTasks(client, data.networkScanTasks);
      }

      if (data.runDataDiscoveryScanNow) {
        console.log("Check-in requested an immediate data discovery scan");
        void sendDataDiscoveryScan();
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
