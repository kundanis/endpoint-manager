import { recordReport as recordThreatProtectionReport, recordTaskResult as recordThreatTaskResult, resolveForAgent as resolveThreatProtectionForAgent } from "../services/threatProtection.service";
import { recordReport as recordScreenshotBlockReport, resolveAssignedForAgent as resolveScreenshotBlockForAgent } from "../services/screenshotBlock.service";
import { storeImage as storeScreenCaptureImage } from "../services/screenCaptureImage.service";
import fs from "node:fs";
import express, { Router } from "express";
import { z } from "zod";
import { AI_COMPONENT_HOSTS, AI_COMPONENT_KINDS } from "@em/shared";
import { agentAssignment, aiAppForProcess, recordComponents } from "../services/aiGuardAddons.service";
import { recordPromptEvent } from "../services/aiGuardPrompt.service";
import { agentConsent, ConsentError, recordDecision, touchSignedInUsers } from "../services/consent.service";
import rateLimit from "express-rate-limit";
import {
  agentUpdateStatusPayloadSchema,
  appControlScanResultPayloadSchema,
  checkinRequestSchema,
  commandBlockEventBatchPayloadSchema,
  commandBlockSyncResultPayloadSchema,
  commandTaskResultPayloadSchema,
  dataDiscoveryScanResultPayloadSchema,
  dataMovementScanResultPayloadSchema,
  screenCaptureReportPayloadSchema,
  securitySignalsPayloadSchema,
  safetyEventPayloadSchema,
  deploymentStatusPayloadSchema,
  dlpEventBatchPayloadSchema,
  edrScanResultPayloadSchema,
  endpointPauseRequestSchema,
  inventoryReportSchema,
  ipBlockSyncResultPayloadSchema,
  networkScanTaskResultPayloadSchema,
  patchInstallResultPayloadSchema,
  patchScanResultPayloadSchema,
  piiBlockSyncResultPayloadSchema,
  securityConfigScanResultPayloadSchema,
  usbControlEventBatchPayloadSchema,
  usbControlSyncResultPayloadSchema,
  userProductivityScanResultPayloadSchema,
  appUsageReportSchema,
  verifyUninstallPasswordRequestSchema,
  webBlockSyncResultPayloadSchema,
  zeroTrustScanResultPayloadSchema,
  SCREEN_CAPTURE_IMAGE_MAX_BYTES,
  screenshotBlockReportSchema,
  threatProtectionReportSchema,
  threatTaskResultSchema,
} from "@em/shared";
import { agentUpdatePackageFor } from "../services/agentBuild.service";
import { prisma } from "../db";
import { logger } from "../logger";
import { AgentUpdateTaskNotOwnedError, recordAgentUpdateStatus } from "../services/agentUpdate.service";
import { handleCheckin, recordInventory } from "../services/checkin.service";
import { CommandTaskNotOwnedError, recordCommandResult } from "../services/command.service";
import { DeploymentTaskNotOwnedError, recordDeploymentStatus } from "../services/deployment.service";
import { NetworkScanTaskNotOwnedError, recordNetworkScanTaskResult } from "../services/networkScan.service";
import { getPackageRecord } from "../services/package.service";
import { mailGuardAgentSettings } from "../services/piiEmailBlockPolicy.service";
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
import { recordAgentSignals } from "../services/userRisk/userRisk.service";
import { recordSafetyEvent } from "../services/safetyEvent.service";
import { recordReport as recordScreenCaptureReport, resolveAssignedForAgent as resolveScreenCaptureForAgent } from "../services/screenCaptureEvent.service";
import {
  recordScanResult as recordAppControlScanResult,
  resolveAssignedAppControlForAgent,
} from "../services/appControlScan.service";
import {
  recordSyncResult as recordWebBlockSyncResult,
  resolveAssignedRulesForAgent as resolveAssignedWebBlockRulesForAgent,
} from "../services/webBlockScan.service";
import {
  recordSyncResult as recordPiiBlockSyncResult,
  resolveAssignedRulesForAgent as resolveAssignedPiiBlockRulesForAgent,
} from "../services/piiBlockScan.service";
import {
  recordEvents as recordCommandBlockEvents,
  recordSyncResult as recordCommandBlockSyncResult,
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
import { recordAppUsage, recordScanResult as recordUserProductivityScanResult } from "../services/userProductivity.service";
import { isEnabledForAgent as isEdrEnabledForAgent, recordScanResult as recordEdrScanResult } from "../services/edr.service";
import { hasUninstallPassword, verifyUninstallPassword } from "../services/agentSecurity.service";
import { confirmAgentUninstalled } from "../services/agent.service";
import { logUninstallFromEndpoint } from "../services/agentUninstallLog.service";
import {
  PolicyNotApplicableError,
  createPauseRequests,
  listApplicablePolicies,
  listPauseRequestsForAgent,
} from "../services/endpointPauseRequest.service";
import { isFeatureLicensed } from "../services/licenseActivation.service";
import { buildUninstallAgentScript } from "../services/agent.service";
import { groupPaths } from "../services/groupTree.service";

export const agentRouter = Router();

agentRouter.post("/checkin", async (req, res, next) => {
  try {
    // req.body is empty/absent for pre-update agents that don't send it yet — the schema
    // treats the whole body and its ipAddress field as optional, and req.ip (the server's
    // view of the connecting socket) covers that case, even though it's frequently wrong
    // (NAT, proxies, or the agent sharing this host) whenever a self-reported IP exists.
    const payload = checkinRequestSchema.parse(req.body ?? {});
    const response = await handleCheckin(
      req.agentId!,
      payload.ipAddress ?? req.ip ?? null,
      payload.macAddress ?? null,
      payload.agentVersion ?? null,
    );
    if (payload.signedInUsers) await touchSignedInUsers(req.agentId!, payload.signedInUsers).catch(() => {});
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

// How long after a deployment task finished its agent may still fetch the package (a retry
// or a slow installer re-reading it).
const PACKAGE_DOWNLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

agentRouter.get("/packages/:packageId/download", async (req, res, next) => {
  try {
    // Only a package actually deployed to THIS agent - an enrolled agent's key must not be a
    // way to pull every installer uploaded to the server (they can carry licence keys or
    // internal software). Same 404 as a missing package, so ids can't be probed.
    const task = await prisma.deploymentTask.findFirst({
      where: {
        agentId: req.agentId!,
        job: { packageId: req.params.packageId },
        OR: [
          { status: { notIn: ["SUCCESS", "FAILED"] } },
          { completedAt: { gte: new Date(Date.now() - PACKAGE_DOWNLOAD_GRACE_MS) } },
        ],
      },
      select: { id: true },
    });
    const pkg = task ? await getPackageRecord(req.params.packageId) : null;
    if (!pkg || !fs.existsSync(pkg.storagePath)) {
      return res.status(404).json({ error: "Package not found" });
    }

    // res.attachment builds Content-Disposition with RFC 5987 encoding (filename*=UTF-8''...),
    // so a name with quotes, CR/LF or non-ASCII characters can't break or inject headers.
    res.attachment(pkg.filename);
    res.setHeader("Content-Type", "application/octet-stream");
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

// Same streaming shape as /packages/:packageId/download - the payload is always whatever
// is currently staged for THIS agent's own osPlatform (see agentBuild.service.ts), not a
// per-task file, since there's only ever one build live per platform on a given server at a
// time. Which file that is depends on the calling agent, not a query param - a Linux agent
// asking for this always gets the Linux tarball, regardless of what a Windows agent would
// get from the exact same URL.
agentRouter.get("/self-update/package", async (req, res, next) => {
  try {
    const agent = await prisma.agent.findUnique({ where: { id: req.agentId! }, select: { osPlatform: true } });
    const { filePath, filename } = agentUpdatePackageFor(agent?.osPlatform);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "No agent build is currently staged on this server for this platform" });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(filePath);
    stream.on("error", next);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// Called twice per self-update: once by the still-running original process (a best-effort
// DOWNLOADING/APPLYING progress ping, sent just before it tears itself down) and once more
// by the detached helper task with the real terminal SUCCESS/FAILED, after the file swap
// has actually happened - see buildSelfUpdateScript. Both calls carry the same agent
// credentials (state.json survives the swap untouched), so this route can't and doesn't
// need to tell them apart.
agentRouter.post("/self-update/tasks/:taskId/status", async (req, res, next) => {
  try {
    const payload = agentUpdateStatusPayloadSchema.parse(req.body);
    await recordAgentUpdateStatus(req.params.taskId, req.agentId!, payload);
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof AgentUpdateTaskNotOwnedError) {
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
    res.json(await resolveAssignedBenchmarksForAgent(await licensedAgentId(req.agentId!, "SP_SECURITY_CONFIG")));
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
    res.json(await resolveAssignedPoliciesForAgent(await licensedAgentId(req.agentId!, "SP_ZERO_TRUST")));
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
    res.json(await resolveAssignedDataDiscoveryPoliciesForAgent(await licensedAgentId(req.agentId!, "DG_DISCOVERY")));
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
    res.json(await resolveAssignedDlpPoliciesForAgent(await licensedAgentId(req.agentId!, "DG_DLP_CONTENT")));
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
    res.json(await resolveAssignedDataMovementPoliciesForAgent(await licensedAgentId(req.agentId!, "DG_MOVEMENT_FILES")));
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

agentRouter.get("/screen-capture/assigned", async (req, res, next) => {
  try {
    res.json(await resolveScreenCaptureForAgent(await licensedAgentId(req.agentId!, "DG_MOVEMENT_SCREEN")));
  } catch (err) {
    next(err);
  }
});

// One screenshot's image, when a policy keeps images for this endpoint. Raw image bytes; the
// capture it belongs to (reported earlier) is named by the X-Capture-Path (URI-encoded) and
// X-Captured-At headers. 409 = that capture hasn't been recorded yet - the agent retries.
agentRouter.post(
  "/screen-capture/image",
  express.raw({ type: () => true, limit: SCREEN_CAPTURE_IMAGE_MAX_BYTES }),
  async (req, res, next) => {
    try {
      const filePath = decodeURIComponent(String(req.header("x-capture-path") ?? ""));
      const capturedAt = new Date(String(req.header("x-captured-at") ?? ""));
      if (!filePath || filePath.length > 1000 || Number.isNaN(capturedAt.getTime()) || !Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: "X-Capture-Path, X-Captured-At and the image are required" });
      }
      const result = await storeScreenCaptureImage(req.agentId!, filePath, capturedAt, req.body);
      if (result === "no-capture") return res.status(409).json({ error: "Capture not recorded yet" });
      if (result === "invalid") return res.status(400).json({ error: "Not a supported image" });
      res.status(204).send(); // stored, or no longer wanted (policy changed) - either way, done
    } catch (err) {
      next(err);
    }
  },
);

agentRouter.post("/screen-capture/report", async (req, res, next) => {
  try {
    const payload = screenCaptureReportPayloadSchema.parse(req.body);
    await recordScreenCaptureReport(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// The desktop safety net removed the agent's own blocking rules (see agent shellHealthGuard.ts).
agentRouter.post("/safety-event", async (req, res, next) => {
  try {
    await recordSafetyEvent(req.agentId!, safetyEventPayloadSchema.parse(req.body));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Windows signals for User Risk (failed sign-ins, admin group changes, ...).
agentRouter.post("/security-signals", async (req, res, next) => {
  try {
    const payload = securitySignalsPayloadSchema.parse(req.body);
    await recordAgentSignals(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/app-control/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedAppControlForAgent(req.agentId!));
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

agentRouter.get("/mail-guard", async (req, res, next) => {
  try {
    res.json(await mailGuardAgentSettings(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/pii-block/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedPiiBlockRulesForAgent(await licensedAgentId(req.agentId!, "DG_DLP_PII")));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/pii-block/sync-result", async (req, res, next) => {
  try {
    const payload = piiBlockSyncResultPayloadSchema.parse(req.body);
    await recordPiiBlockSyncResult(req.agentId!, payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// EPM -> Screenshot blocking: what this endpoint blocks, and the blocked attempts (+ sync status).
agentRouter.get("/screenshot-block/assigned", async (req, res, next) => {
  try {
    res.json(await resolveScreenshotBlockForAgent(await licensedAgentId(req.agentId!, "EPM_SCREENSHOT")));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/screenshot-block/report", async (req, res, next) => {
  try {
    await recordScreenshotBlockReport(req.agentId!, screenshotBlockReportSchema.parse(req.body));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Threat Protection (Microsoft Defender management): settings, waiting scans and actions; the
// endpoint's protection status and threats; and each scan's or action's result.
agentRouter.get("/threat-protection/assigned", async (req, res, next) => {
  try {
    res.json(await resolveThreatProtectionForAgent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/threat-protection/report", async (req, res, next) => {
  try {
    await recordThreatProtectionReport(req.agentId!, threatProtectionReportSchema.parse(req.body));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/threat-protection/task-result", async (req, res, next) => {
  try {
    if (!(await recordThreatTaskResult(req.agentId!, threatTaskResultSchema.parse(req.body)))) return res.status(404).json({ error: "Task not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/ip-block/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedIpBlockRulesForAgent(await licensedAgentId(req.agentId!, "EPM_IP")));
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
    res.json(await resolveAssignedUsbControlRulesForAgent(await licensedAgentId(req.agentId!, "EPM_USB")));
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
// Per agent, not per address: many agents can share one NAT address, and the password is
// one secret for the whole fleet - so each agent key gets a handful of guesses only.
const uninstallPasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `agent:${req.agentId}`,
  message: { error: "Too many uninstall password attempts from this endpoint. Try again in 15 minutes." },
});

agentRouter.post("/verify-uninstall-password", uninstallPasswordRateLimiter, async (req, res, next) => {
  try {
    const payload = verifyUninstallPasswordRequestSchema.parse(req.body);
    const valid = await verifyUninstallPassword(payload.password);
    // Setup's uninstall (Windows' Apps list) goes ahead as soon as the password is accepted.
    await logUninstallFromEndpoint(req.agentId!, "uninstaller", { ok: valid, ipAddress: req.ip });
    res.json({ valid });
  } catch (err) {
    next(err);
  }
});

// Same trust model as /verify-uninstall-password above - the detached uninstall helper
// task calls this using the agent's own state.json credentials right before deleting the
// install folder, so the Agent row (and its license seat) is freed immediately rather
// than lingering forever as an unreachable "offline" row.
// The uninstall guard (packages/shared/src/agentRelease.ts) also says how the agent was removed
// and what it released on the PC - logged, never trusted for anything else. A report that arrives
// late (the PC was offline when the agent was removed) is handled the same way.
const uninstalledReportSchema = z
  .object({
    how: z.string().max(40).optional(),
    uninstalledAt: z.string().max(40).optional(),
    released: z.array(z.string().max(100)).max(30).optional(),
    problems: z.array(z.string().max(500)).max(30).optional(),
  })
  .partial();

agentRouter.post("/uninstalled", async (req, res, next) => {
  try {
    const report = uninstalledReportSchema.safeParse(req.body ?? {});
    if (report.success && report.data.how) {
      logger.info({ agentId: req.agentId, ...report.data }, "Endpoint reported that the agent was removed");
    }
    await confirmAgentUninstalled(req.agentId!, report.success ? report.data : undefined);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/command-block/assigned", async (req, res, next) => {
  try {
    res.json(await resolveAssignedCommandBlockRulesForAgent(await licensedAgentId(req.agentId!, "EPM_COMMAND")));
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

agentRouter.post("/command-block/scan-result", async (req, res, next) => {
  try {
    const payload = commandBlockSyncResultPayloadSchema.parse(req.body);
    await recordCommandBlockSyncResult(req.agentId!, payload);
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

// From the tray app (through the agent): time per application and website since its last report.
agentRouter.post("/user-productivity/app-usage", async (req, res, next) => {
  try {
    await recordAppUsage(req.agentId!, appUsageReportSchema.parse(req.body));
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

// The Endpoint IQ tray app on the endpoint (through the local agent): the EPM and DLP policies
// that apply here, and pause requests the endpoint's user sends for an admin to approve.
agentRouter.get("/policies", async (req, res, next) => {
  try {
    res.json(await listApplicablePolicies(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.get("/pause-requests", async (req, res, next) => {
  try {
    res.json(await listPauseRequestsForAgent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/pause-requests", async (req, res, next) => {
  try {
    const payload = endpointPauseRequestSchema.parse(req.body);
    res.status(201).json(await createPauseRequests(req.agentId!, payload));
  } catch (err) {
    if (err instanceof PolicyNotApplicableError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ---- AI Guard phase 3 (Windows agent 0.2.33+) -------------------------------------------------

// What this endpoint applies: blocked AI browser / VS Code extensions, and the tray's clipboard check.
agentRouter.get("/ai-guard/assigned", async (req, res, next) => {
  try {
    res.json(await agentAssignment(req.agentId!));
  } catch (err) {
    next(err);
  }
});

const aiComponentsSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(AI_COMPONENT_KINDS),
        host: z.enum(AI_COMPONENT_HOSTS),
        identifier: z.string().min(1).max(200),
        name: z.string().max(300).default(""),
        version: z.string().max(100).nullable().default(null),
        userName: z.string().max(300).nullable().default(null),
      }),
    )
    .max(5000),
});

// Every browser extension, code-editor extension and npm command-line tool the agent found; the
// server keeps the AI ones.
agentRouter.post("/ai-guard/components", async (req, res, next) => {
  try {
    const { items } = aiComponentsSchema.parse(req.body);
    res.json({ kept: await recordComponents(req.agentId!, items) });
  } catch (err) {
    next(err);
  }
});

const clipboardEventSchema = z.object({
  process: z.string().min(1).max(260),
  action: z.enum(["BLOCKED", "REDACTED", "WARNED_CONTINUED"]),
  dataTypes: z.array(z.string().max(100)).min(1).max(20),
  maskedSample: z.string().max(500).nullish(),
});

// The tray app's clipboard check caught sensitive data on its way into an AI desktop app.
agentRouter.post("/ai-guard/clipboard-events", async (req, res, next) => {
  try {
    const e = clipboardEventSchema.parse(req.body);
    const app = await aiAppForProcess(e.process);
    await recordPromptEvent(req.agentId!, {
      host: e.process.toLowerCase().slice(0, 255),
      appKey: app?.key ?? null,
      channel: "CLIPBOARD",
      action: e.action,
      dataTypes: e.dataTypes,
      maskedSample: e.maskedSample ?? null,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---- Endpoint user consent (Windows agent 0.2.35+) ---------------------------------------------------

// The notice in force and this endpoint's answers - the agent sends monitoring data only while every
// signed-in user has agreed.
agentRouter.get("/consent", async (req, res, next) => {
  try {
    res.json(await agentConsent(req.agentId!));
  } catch (err) {
    next(err);
  }
});

const consentDecisionSchema = z.object({
  account: z.string().min(1).max(300),
  decision: z.enum(["AGREED", "DECLINED"]),
  version: z.number().int().positive(),
});

// A user answered in the tray app (the agent vouches for which user - see localApi.ts).
agentRouter.post("/consent", async (req, res, next) => {
  try {
    const d = consentDecisionSchema.parse(req.body);
    await recordDecision(req.agentId!, d.account, d.decision, d.version);
    res.json(await agentConsent(req.agentId!));
  } catch (err) {
    if (err instanceof ConsentError) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// Licensing below the module: a feature that isn't licensed applies nothing on endpoints. The
// resolvers are plain reads, so asking for an id no endpoint has gives exactly the answer of an
// endpoint with no policies (the same empty shape every agent version already handles).
const NO_ENDPOINT = "00000000-0000-0000-0000-unlicensed00";
async function licensedAgentId(agentId: string, featureKey: string): Promise<string> {
  return (await isFeatureLicensed(featureKey)) ? agentId : NO_ENDPOINT;
}

// ---- Tray app: details and uninstall from the PC (Windows agent 0.2.39+) --------------------------

// What the tray app shows about this endpoint: the groups it was put in ("Mumbai › Andheri").
agentRouter.get("/info", async (req, res, next) => {
  try {
    const [direct, paths] = await Promise.all([
      prisma.agentGroupMembership.findMany({ where: { agentId: req.agentId! }, select: { groupId: true } }),
      groupPaths(),
    ]);
    res.json({ groups: direct.map((m) => paths.get(m.groupId) ?? m.groupId).sort() });
  } catch (err) {
    next(err);
  }
});

const selfUninstallSchema = z.object({
  password: z.string().min(1).max(200),
  requestedBy: z.string().max(300).optional(),
});

// A user uninstalls the agent from the tray app with the uninstall password (Asset Settings ->
// Tamper protection). Without a password set, uninstalling from the PC isn't allowed at all - only
// from the console. Same rate limit as the setup's password check.
agentRouter.post("/self-uninstall", uninstallPasswordRateLimiter, async (req, res, next) => {
  try {
    const { password, requestedBy } = selfUninstallSchema.parse(req.body);
    if (!(await hasUninstallPassword())) {
      return res.status(409).json({ error: "Your organisation hasn't set an uninstall password, so the agent can't be removed from this PC. Ask your IT administrator to uninstall it from the console." });
    }
    if (!(await verifyUninstallPassword(password))) {
      logger.warn({ agentId: req.agentId, requestedBy }, "Uninstall from the endpoint refused: wrong password");
      await logUninstallFromEndpoint(req.agentId!, "endpoint", { ok: false, user: requestedBy, ipAddress: req.ip });
      return res.status(403).json({ error: "Incorrect uninstall password." });
    }
    logger.info({ agentId: req.agentId, requestedBy }, "Agent uninstalled from the endpoint with the uninstall password");
    await logUninstallFromEndpoint(req.agentId!, "endpoint", { ok: true, user: requestedBy, ipAddress: req.ip });
    res.json({ script: buildUninstallAgentScript("endpoint") });
  } catch (err) {
    next(err);
  }
});
