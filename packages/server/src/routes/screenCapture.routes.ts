import { Router } from "express";
import { assignScreenCapturePolicyRequestSchema, createScreenCapturePolicyRequestSchema, updateScreenCapturePolicyRequestSchema } from "@em/shared";
import {
  assignPolicy,
  createPolicy,
  deletePolicy,
  getCaptures,
  getPolicy,
  getPolicyReport,
  listAssignments,
  listPolicies,
  unassign,
  updatePolicy,
} from "../services/screenCapturePolicy.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { prisma } from "../db";

export const screenCaptureRouter = Router();

screenCaptureRouter.post("/", async (req, res, next) => {
  try {
    const payload = createScreenCapturePolicyRequestSchema.parse(req.body);
    res.status(201).json(await createPolicy(payload, req.adminId!));
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listPolicies());
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.get("/:id", async (req, res, next) => {
  try {
    const policy = await getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateScreenCapturePolicyRequestSchema.parse(req.body);
    res.json(await updatePolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!(await deletePolicy(req.params.id))) return res.status(404).json({ error: "Policy not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const payload = assignScreenCapturePolicyRequestSchema.parse(req.body);
    if (payload.agentIds.length > 0) {
      const existingCount = await prisma.agent.count({ where: { id: { in: payload.agentIds } } });
      if (existingCount !== payload.agentIds.length) return res.status(400).json({ error: "One or more agentIds do not exist" });
    }
    if (payload.groupIds.length > 0) {
      const existingGroupCount = await prisma.assetGroup.count({ where: { id: { in: payload.groupIds } } });
      if (existingGroupCount !== payload.groupIds.length) return res.status(400).json({ error: "One or more groupIds do not exist" });
    }
    const resolved = await resolveTargetAgentIds(payload.agentIds, payload.groupIds);
    if (resolved.length === 0) return res.status(400).json({ error: "No agents resolved from the given agentIds/groupIds" });
    res.status(201).json(await assignPolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.get("/:id/assignments", async (req, res, next) => {
  try {
    res.json(await listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.delete("/:id/assign/:assignmentId", async (req, res, next) => {
  try {
    if (!(await unassign(req.params.id, req.params.assignmentId))) return res.status(404).json({ error: "Assignment not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Daily report per user over the last ?days= days (1-90, default 7).
screenCaptureRouter.get("/:id/report", async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const report = await getPolicyReport(req.params.id, days);
    if (!report) return res.status(404).json({ error: "Policy not found" });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// The screenshots behind one report row: ?agentId=&username=&day=YYYY-MM-DD
screenCaptureRouter.get("/:id/captures", async (req, res, next) => {
  try {
    const { agentId, username, day } = req.query as Record<string, string | undefined>;
    if (!agentId || !username || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: "agentId, username and day are required" });
    const captures = await getCaptures(req.params.id, agentId, username, day);
    if (!captures) return res.status(404).json({ error: "Policy not found" });
    res.json(captures);
  } catch (err) {
    next(err);
  }
});
