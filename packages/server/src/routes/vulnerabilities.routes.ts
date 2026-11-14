import { createException, deleteException, listExceptions, VulnerabilityExceptionError } from "../services/vulnerabilityException.service";
import { Router } from "express";
import {
  createVulnerabilityExceptionRequestSchema,
  remediateBySeverityRequestSchema,
  remediateVulnerabilityRequestSchema,
  triggerVulnerabilitySyncRequestSchema,
} from "@em/shared";
import {
  getFindingsForAgent,
  getFindingsForVulnerability,
  getFleetVulnerabilitySummary,
  resolveVulnerabilityScope,
  getVulnerabilitySyncRun,
  listVulnerabilitySyncRuns,
  triggerVulnerabilitySync,
} from "../services/vulnerability.service";
import { triggerMsrcSync } from "../services/msrc.service";
import { rescanAllAgents } from "../services/vulnerabilityMatch.service";
import { remediateBySeverity, remediateVulnerability } from "../services/vulnerabilityRemediation.service";

export const vulnerabilitiesRouter = Router();

vulnerabilitiesRouter.post("/sync", async (req, res, next) => {
  try {
    const payload = triggerVulnerabilitySyncRequestSchema.parse(req.body);
    const result = await triggerVulnerabilitySync({ ...payload, triggeredByAdminId: req.adminId! });
    // Sync now also reads Microsoft's Security Update Guide (only new or revised monthly
    // documents after the first run), as its own run in the sync history.
    const msrc = await triggerMsrcSync(req.adminId!);
    res.status(202).json({ ...result, msrcSyncRunId: msrc.syncRunId });
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

// ?agentId= or ?groupId= (the page's Endpoint / Group filter): counts within that scope.
function scopeQuery(q: Record<string, unknown>): { agentId?: string; groupId?: string } {
  const agentId = typeof q.agentId === "string" && q.agentId ? q.agentId : undefined;
  const groupId = typeof q.groupId === "string" && q.groupId ? q.groupId : undefined;
  return agentId ? { agentId } : groupId ? { groupId } : {};
}

vulnerabilitiesRouter.get("/", async (req, res, next) => {
  try {
    res.json(await getFleetVulnerabilitySummary(await resolveVulnerabilityScope(scopeQuery(req.query))));
  } catch (err) {
    next(err);
  }
});

// Vulnerability exceptions (Mark as False positive / Not applicable / Risk accepted). Anyone who
// can open Vulnerabilities (super admins and admins with Security access) can add or remove them;
// each change is in Admin logs.
vulnerabilitiesRouter.get("/exceptions", async (_req, res, next) => {
  try {
    res.json(await listExceptions());
  } catch (err) {
    next(err);
  }
});

vulnerabilitiesRouter.post("/exceptions", async (req, res, next) => {
  try {
    const payload = createVulnerabilityExceptionRequestSchema.parse(req.body);
    res.status(201).json({ id: await createException(payload, req.adminId!) });
  } catch (err) {
    if (err instanceof VulnerabilityExceptionError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

vulnerabilitiesRouter.delete("/exceptions/:id", async (req, res, next) => {
  try {
    if (!(await deleteException(req.params.id))) return res.status(404).json({ error: "Exception not found" });
    res.status(204).send();
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
    const detail = await getFindingsForVulnerability(
      req.params.vulnerabilityDefinitionId,
      await resolveVulnerabilityScope(scopeQuery(req.query)),
    );
    if (!detail) return res.status(404).json({ error: "Vulnerability not found" });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

vulnerabilitiesRouter.post("/remediate-by-severity", async (req, res, next) => {
  try {
    const payload = remediateBySeverityRequestSchema.parse(req.body);
    const scope = await resolveVulnerabilityScope({ agentId: payload.agentId, groupId: payload.groupId });
    res.status(202).json(await remediateBySeverity(payload.severities, req.adminId!, scope));
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
