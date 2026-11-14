import { Router } from "express";
import {
  assignThreatProtectionPolicyRequestSchema,
  createThreatProtectionPolicyRequestSchema,
  requestThreatActionSchema,
  requestThreatScanSchema,
  updateThreatProtectionPolicyRequestSchema,
} from "@em/shared";
import {
  assignPolicy,
  createPolicy,
  deletePolicy,
  getOverview,
  getPolicy,
  getPolicySyncStatus,
  listAssignments,
  listDetections,
  listPolicies,
  listTasks,
  requestActions,
  requestScans,
  resolveDetection,
  ThreatActionError,
  unassign,
  updatePolicy,
} from "../services/threatProtection.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { prisma } from "../db";

// Threat Protection (Microsoft Defender management). Mounted at /api/admin/threat-protection.
export const threatProtectionRouter = Router();

const daysParam = (v: unknown) => Math.min(90, Math.max(1, Number(v) || 30));

threatProtectionRouter.get("/overview", async (_req, res, next) => {
  try {
    res.json(await getOverview());
  } catch (err) {
    next(err);
  }
});

// ?status=open (active or failed, any age) | all (default, seen in the last ?days=, 1-90).
threatProtectionRouter.get("/threats", async (req, res, next) => {
  try {
    const status = req.query.status === "open" ? "open" : "all";
    const agentId = typeof req.query.agentId === "string" && req.query.agentId ? req.query.agentId : undefined;
    res.json(await listDetections({ status, agentId, days: daysParam(req.query.days) }));
  } catch (err) {
    next(err);
  }
});

threatProtectionRouter.post("/threats/:id/resolve", async (req, res, next) => {
  try {
    if (!(await resolveDetection(req.params.id, req.adminId!))) return res.status(404).json({ error: "Threat not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

threatProtectionRouter.post("/scans", async (req, res, next) => {
  try {
    res.status(201).json(await requestScans(requestThreatScanSchema.parse(req.body), req.adminId!));
  } catch (err) {
    next(err);
  }
});

threatProtectionRouter.post("/actions", async (req, res, next) => {
  try {
    res.status(201).json(await requestActions(requestThreatActionSchema.parse(req.body), req.adminId!));
  } catch (err) {
    if (err instanceof ThreatActionError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Scans and actions requested in the last ?days= (default 30), optionally for one ?agentId=.
threatProtectionRouter.get("/tasks", async (req, res, next) => {
  try {
    const agentId = typeof req.query.agentId === "string" && req.query.agentId ? req.query.agentId : undefined;
    res.json(await listTasks(daysParam(req.query.days), agentId));
  } catch (err) {
    next(err);
  }
});

// ---- Policies

threatProtectionRouter.get("/policies", async (_req, res, next) => {
  try {
    res.json(await listPolicies());
  } catch (err) {
    next(err);
  }
});

threatProtectionRouter.post("/policies", async (req, res, next) => {
  try {
    res.status(201).json(await createPolicy(createThreatProtectionPolicyRequestSchema.parse(req.body), req.adminId!));
  } catch (err) {
    next(err);
  }
});

threatProtectionRouter.get("/policies/:id", async (req, res, next) => {
  try {
    const policy = await getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

threatProtectionRouter.patch("/policies/:id", async (req, res, next) => {
  try {
    if (!(await getPolicy(req.params.id))) return res.status(404).json({ error: "Policy not found" });
    res.json(await updatePolicy(req.params.id, updateThreatProtectionPolicyRequestSchema.parse(req.body)));
  } catch (err) {
    next(err);
  }
});

threatProtectionRouter.delete("/policies/:id", async (req, res, next) => {
  try {
    if (!(await deletePolicy(req.params.id))) return res.status(404).json({ error: "Policy not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

threatProtectionRouter.post("/policies/:id/assign", async (req, res, next) => {
  try {
    if (!(await getPolicy(req.params.id))) return res.status(404).json({ error: "Policy not found" });
    const payload = assignThreatProtectionPolicyRequestSchema.parse(req.body);
    if (payload.agentIds.length > 0 && (await prisma.agent.count({ where: { id: { in: payload.agentIds } } })) !== payload.agentIds.length) {
      return res.status(400).json({ error: "One or more agentIds do not exist" });
    }
    if (payload.groupIds.length > 0 && (await prisma.assetGroup.count({ where: { id: { in: payload.groupIds } } })) !== payload.groupIds.length) {
      return res.status(400).json({ error: "One or more groupIds do not exist" });
    }
    if ((await resolveTargetAgentIds(payload.agentIds, payload.groupIds)).length === 0) {
      return res.status(400).json({ error: "No agents resolved from the given agentIds/groupIds" });
    }
    res.status(201).json(await assignPolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

threatProtectionRouter.get("/policies/:id/assignments", async (req, res, next) => {
  try {
    res.json(await listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

threatProtectionRouter.delete("/policies/:id/assign/:assignmentId", async (req, res, next) => {
  try {
    if (!(await unassign(req.params.id, req.params.assignmentId))) return res.status(404).json({ error: "Assignment not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

threatProtectionRouter.get("/policies/:id/sync", async (req, res, next) => {
  try {
    const status = await getPolicySyncStatus(req.params.id);
    if (!status) return res.status(404).json({ error: "Policy not found" });
    res.json(status);
  } catch (err) {
    next(err);
  }
});
