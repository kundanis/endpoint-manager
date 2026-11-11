import { Router } from "express";
import { assignScreenshotBlockPolicyRequestSchema, createScreenshotBlockPolicyRequestSchema, updateScreenshotBlockPolicyRequestSchema } from "@em/shared";
import {
  assignPolicy,
  createPolicy,
  deletePolicy,
  getAgentEvents,
  getPolicy,
  getPolicyActivity,
  listAssignments,
  listPolicies,
  unassign,
  updatePolicy,
} from "../services/screenshotBlock.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { prisma } from "../db";

export const screenshotBlockRouter = Router();

const daysParam = (v: unknown) => Math.min(90, Math.max(1, Number(v) || 7));

screenshotBlockRouter.post("/", async (req, res, next) => {
  try {
    res.status(201).json(await createPolicy(createScreenshotBlockPolicyRequestSchema.parse(req.body), req.adminId!));
  } catch (err) {
    next(err);
  }
});

screenshotBlockRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listPolicies());
  } catch (err) {
    next(err);
  }
});

// Blocked attempts on one endpoint (all policies): ?days= (1-90, default 7).
screenshotBlockRouter.get("/agents/:agentId/events", async (req, res, next) => {
  try {
    res.json(await getAgentEvents(req.params.agentId, daysParam(req.query.days)));
  } catch (err) {
    next(err);
  }
});

screenshotBlockRouter.get("/:id", async (req, res, next) => {
  try {
    const policy = await getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

screenshotBlockRouter.patch("/:id", async (req, res, next) => {
  try {
    res.json(await updatePolicy(req.params.id, updateScreenshotBlockPolicyRequestSchema.parse(req.body)));
  } catch (err) {
    next(err);
  }
});

screenshotBlockRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!(await deletePolicy(req.params.id))) return res.status(404).json({ error: "Policy not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

screenshotBlockRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const payload = assignScreenshotBlockPolicyRequestSchema.parse(req.body);
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

screenshotBlockRouter.get("/:id/assignments", async (req, res, next) => {
  try {
    res.json(await listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

screenshotBlockRouter.delete("/:id/assign/:assignmentId", async (req, res, next) => {
  try {
    if (!(await unassign(req.params.id, req.params.assignmentId))) return res.status(404).json({ error: "Assignment not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

screenshotBlockRouter.get("/:id/activity", async (req, res, next) => {
  try {
    const activity = await getPolicyActivity(req.params.id, daysParam(req.query.days));
    if (!activity) return res.status(404).json({ error: "Policy not found" });
    res.json(activity);
  } catch (err) {
    next(err);
  }
});
