import fs from "node:fs";
import { Router } from "express";
import {
  appControlScanResultPayloadSchema,
  checkinRequestSchema,
  commandBlockEventBatchPayloadSchema,
  commandTaskResultPayloadSchema,
  dataDiscoveryScanResultPayloadSchema,
  dataMovementScanResultPayloadSchema,
  deploymentStatusPayloadSchema,
  dlpEventBatchPayloadSchema,
  edrScanResultPayloadSchema,
  inventoryReportSchema,
  ipBlockSyncResultPayloadSchema,
  networkScanTaskResultPayloadSchema,
  patchInstallResultPayloadSchema,
  patchScanResultPayloadSchema,
  securityConfigScanResultPayloadSchema,
  usbControlEventBatchPayloadSchema,
  usbControlSyncResultPayloadSchema,
  userProductivityScanResultPayloadSchema,
  verifyUninstallPasswordRequestSchema,
  webBlockSyncResultPayloadSchema,
  zeroTrustScanResultPayloadSchema,
} from "@em/shared";
import { handleCheckin, recordInventory } from "../services/checkin.service";
import { CommandTaskNotOwnedError, recordCommandResult } from "../services/command.service";
import { DeploymentTaskNotOwnedError, recordDeploymentStatus } from "../services/deployment.service";
import { NetworkScanTaskNotOwnedError, recordNetworkScanTaskResult } from "../services/networkScan.service";
import { getPackageRecord } from "../services/package.service";
import { PatchTaskNotOwnedError, recordPatchScan, recordPatchTaskResult } from "../services/patch.service";
import { recordScanResult, resolveAssignedBenchmarksForAgent } from "../services/securityConfigScan.service";
import {
  recordScanResult as recordZeroTrustScanResult,
  resolveAssignedPoliciesForAgent,
} from "../services/zeroTrustScan.service";
import {
  recordScanResult as recordDataDiscoveryScanResult,
  resolveAssignedPoliciesForAgent as resolveAssignedDataDiscoveryPoliciesForAgent,
} from "../services/dataDiscoveryScan.service";
import {
  recordEvents as recordDlpEvents,
  resolveAssignedPoliciesForAgent as resolveAssignedDlpPoliciesForAgent,
} from "../services/dlpEvent.service";
import {
  recordScanResult as recordDataMovementScanResult,
  resolveAssignedPoliciesForAgent as resolveAssignedDataMovementPoliciesForAgent,
} from "../services/dataMovementEvent.service";
import {
  recordScanResult as recordAppControlScanResult,
  resolveAssignedRulesForAgent as resolveAssignedAppControlRulesForAgent,
} from "../services/appControlScan.service";
import {
  recordSyncResult as recordWebBlockSyncResult,
  resolveAssignedRulesForAgent as resolveAssignedWebBlockRulesForAgent,
} from "../services/webBlockScan.service";
import {
  recordEvents as recordCommandBlockEvents,
  resolveAssignedRulesForAgent as resolveAssignedCommandBlockRulesForAgent,
} from "../services/commandBlockScan.service";
import {
  recordSyncResult as recordIpBlockSyncResult,
  resolveAssignedRulesForAgent as resolveAssignedIpBlockRulesForAgent,
} from "../services/ipBlockScan.service";
import {
  recordEvents as recordUsbControlEvents,
  recordSyncResult as recordUsbControlSyncResult,
  resolveAssignedRulesForAgent as resolveAssignedUsbControlRulesForAgent,
} from "../services/usbControlScan.service";
import { recordScanResult as recordUserProductivityScanResult } from "../services/userProductivity.service";
import { isEnabledForAgent as isEdrEnabledForAgent, recordScanResult as recordEdrScanResult } from "../services/edr.service";
import { verifyUninstallPassword } from "../services/agentSecurity.service";

export const agentRouter = Router();

agentRouter.post("/checkin", async (req, res, next) => {
  try {
    // req.body is empty/absent for pre-update agents that don't send it yet — the schema
    // treats the whole body and its ipAddress field as optional, and req.ip (the server's
    // view of the connecting socket) covers that case, even though it's frequently wrong
    // (NAT, proxies, or the agent sharing this host) whenever a self-reported IP exists.
    const payload = checkinRequestSchema.parse(req.body ?? {});
    const response = await handleCheckin(req.agentId!, payload.ipAddress ?? req.ip ?? null, payload.macAddress ?? null);
    res.json(response);
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/inventory", async (req, res, next) => {
  try {
    const report = inventoryReportSchema.parse(req.body);
    await recordInventory(req.agentId!, report);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/commands/:taskId/result", async (req, res, next) => {
  try {
    const payload = commandTaskResultPayloadSchema.parse(req.body);
    await recordCommandResult(req.params.taskId, req.agentId!, payload);
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof CommandTaskNotOwnedError) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

agentRouter.post("/network-scans/tasks/:taskId/result", async (req, res, next) => {
  try {
    const payload = networkScanTaskResultPayloadSchema.parse(req.body);
    await recordNetworkScanTaskResult(req.params.taskId, req.agentId!, payload);
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof NetworkScanTaskNotOwnedError) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

agentRouter.get("/packages/:packageId/download", async (req, res, next) => {
  try {
    const pkg = await getPackageRecord(req.params.packageId);
    if (!pkg || !fs.existsSync(pkg.storagePath)) {
      return res.status(404).json({ error: "Package not found" });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${pkg.filename}"`);
    res.setHeader("Content-Length", String(pkg.fileSizeBytes));

    const stream = fs.createReadStream(pkg.storagePath);
    stream.on("error", next);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/deployments/:taskId/status", async (req, res, next) => {
  try {
    const payload = deploymentStatusPayloadSchema.parse(req.body);
    await recordDeploymentStatus(req.params.taskId, req.agentId!, payload);
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof DeploymentTaskNotOwnedError) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

agentRouter.post("/patches/scan-result", async (req, res, next) => {
  try {
    const payload = patchScanResultPayloadSchema.parse(req.body);
    await recordPatchScan(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/patches/tasks/:taskId/result", async (req, res, next) => {
  try {
    const payload = patchInstallResultPayloadSchema.parse(req.body);
    await recordPatchTaskResult(req.params.taskId, req.agentId!, payload);
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof PatchTaskNotOwnedError) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

agentRouter.get("/security-config/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedBenchmarksForAgent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/security-config/scan-result", async (req, res, next) => {
  try {
    const payload = securityConfigScanResultPayloadSchema.parse(req.body);
    await recordScanResult(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/zero-trust/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedPoliciesForAgent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/zero-trust/scan-result", async (req, res, next) => {
  try {
    const payload = zeroTrustScanResultPayloadSchema.parse(req.body);
    await recordZeroTrustScanResult(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/data-discovery/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedDataDiscoveryPoliciesForAgent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/data-discovery/scan-result", async (req, res, next) => {
  try {
    const payload = dataDiscoveryScanResultPayloadSchema.parse(req.body);
    await recordDataDiscoveryScanResult(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/dlp/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedDlpPoliciesForAgent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/dlp/events", async (req, res, next) => {
  try {
    const payload = dlpEventBatchPayloadSchema.parse(req.body);
    await recordDlpEvents(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/data-movement/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedDataMovementPoliciesForAgent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/data-movement/scan-result", async (req, res, next) => {
  try {
    const payload = dataMovementScanResultPayloadSchema.parse(req.body);
    await recordDataMovementScanResult(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/app-control/assigned", async (req, res, next) => {
  try {
    res.json({ rules: await resolveAssignedAppControlRulesForAgent(req.agentId!) });
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/app-control/scan-result", async (req, res, next) => {
  try {
    const payload = appControlScanResultPayloadSchema.parse(req.body);
    await recordAppControlScanResult(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/web-block/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedWebBlockRulesForAgent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/web-block/sync-result", async (req, res, next) => {
  try {
    const payload = webBlockSyncResultPayloadSchema.parse(req.body);
    await recordWebBlockSyncResult(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/ip-block/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedIpBlockRulesForAgent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/ip-block/sync-result", async (req, res, next) => {
  try {
    const payload = ipBlockSyncResultPayloadSchema.parse(req.body);
    await recordIpBlockSyncResult(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/usb-control/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedUsbControlRulesForAgent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/usb-control/sync-result", async (req, res, next) => {
  try {
    const payload = usbControlSyncResultPayloadSchema.parse(req.body);
    await recordUsbControlSyncResult(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/usb-control/events", async (req, res, next) => {
  try {
    const payload = usbControlEventBatchPayloadSchema.parse(req.body);
    await recordUsbControlEvents(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Agent-authenticated (not admin) - the uninstaller runs on the endpoint itself using the
// agent's own persisted apiKey (from state.json) to make this call, so no separate
// credential needs distributing just to gate uninstall. Fails closed at the caller if this
// request can't be made at all (offline) - deliberate, per the tamper-resistance design.
agentRouter.post("/verify-uninstall-password", async (req, res, next) => {
  try {
    const payload = verifyUninstallPasswordRequestSchema.parse(req.body);
    const valid = await verifyUninstallPassword(payload.password);
    res.json({ valid });
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/command-block/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedCommandBlockRulesForAgent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/command-block/events", async (req, res, next) => {
  try {
    const payload = commandBlockEventBatchPayloadSchema.parse(req.body);
    await recordCommandBlockEvents(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/user-productivity/scan-result", async (req, res, next) => {
  try {
    const payload = userProductivityScanResultPayloadSchema.parse(req.body);
    await recordUserProductivityScanResult(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/edr/enabled", async (req, res, next) => {
  try {
    res.json({ enabled: await isEdrEnabledForAgent(req.agentId!) });
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/edr/scan-result", async (req, res, next) => {
  try {
    const payload = edrScanResultPayloadSchema.parse(req.body);
    await recordEdrScanResult(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
