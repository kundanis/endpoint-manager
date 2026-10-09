import { Router } from "express";
import {
  remediateBySeverityRequestSchema,
  remediateVulnerabilityRequestSchema,
  triggerVulnerabilitySyncRequestSchema,
} from "@em/shared";
import {
  getFindingsForAgent,
  getFindingsForVulnerability,
  getFleetVulnerabilitySummary,
  getVulnerabilitySyncRun,
  listVulnerabilitySyncRuns,
  triggerVulnerabilitySync,
} from "../services/vulnerability.service";
import { rescanAllAgents } from "../services/vulnerabilityMatch.service";
import { remediateBySeverity, remediateVulnerability } from "../services/vulnerabilityRemediation.service";

export const vulnerabilitiesRouter = Router();

vulnerabilitiesRouter.post("/sync", async (req, res, next) => {
  try {
    const payload = triggerVulnerabilitySyncRequestSchema.parse(req.body);
    const result = await triggerVulnerabilitySync({ ...payload, triggeredByAdminId: req.adminId! });
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
});

vulnerabilitiesRouter.get("/sync-runs", async (_req, res, next) => {
  try {
    res.json(await listVulnerabilitySyncRuns());
  } catch (err) {
    next(err);
  }
});

vulnerabilitiesRouter.get("/sync-runs/:id", async (req, res, next) => {
  try {
    const run = await getVulnerabilitySyncRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Sync run not found" });
    res.json(run);
  } catch (err) {
    next(err);
  }
});

vulnerabilitiesRouter.post("/rescan", async (_req, res, next) => {
  try {
    void rescanAllAgents();
    res.status(202).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

vulnerabilitiesRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getFleetVulnerabilitySummary());
  } catch (err) {
    next(err);
  }
});

vulnerabilitiesRouter.get("/agents/:agentId", async (req, res, next) => {
  try {
    res.json(await getFindingsForAgent(req.params.agentId));
  } catch (err) {
    next(err);
  }
});

vulnerabilitiesRouter.get("/:vulnerabilityDefinitionId/agents", async (req, res, next) => {
  try {
    const detail = await getFindingsForVulnerability(req.params.vulnerabilityDefinitionId);
    if (!detail) return res.status(404).json({ error: "Vulnerability not found" });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

vulnerabilitiesRouter.post("/remediate-by-severity", async (req, res, next) => {
  try {
    const payload = remediateBySeverityRequestSchema.parse(req.body);
    res.status(202).json(await remediateBySeverity(payload.severities, req.adminId!));
  } catch (err) {
    next(err);
  }
});

vulnerabilitiesRouter.post("/:vulnerabilityDefinitionId/remediate", async (req, res, next) => {
  try {
    const { findingIds } = remediateVulnerabilityRequestSchema.parse(req.body ?? {});
    res.status(202).json(await remediateVulnerability(req.params.vulnerabilityDefinitionId, req.adminId!, findingIds));
  } catch (err) {
    next(err);
  }
});
