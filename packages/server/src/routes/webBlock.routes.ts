import { Router } from "express";
import {
  assignWebBlockPolicyRequestSchema,
  createWebBlockPolicyRequestSchema,
  createWebBlockRuleRequestSchema,
  updateWebBlockPolicyRequestSchema,
  updateWebBlockRuleRequestSchema,
} from "@em/shared";
import {
  addRule,
  assignPolicy,
  createPolicy,
  deletePolicy,
  deleteRule,
  getPolicy,
  getPolicyAgentBreakdown,
  listAssignments,
  listPolicies,
  unassign,
  updatePolicy,
  updateRule,
} from "../services/webBlockPolicy.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { prisma } from "../db";

export const webBlockRouter = Router();

webBlockRouter.post("/", async (req, res, next) => {
  try {
    const payload = createWebBlockPolicyRequestSchema.parse(req.body);
    res.status(201).json(await createPolicy(payload, req.adminId!));
  } catch (err) {
    next(err);
  }
});

webBlockRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listPolicies());
  } catch (err) {
    next(err);
  }
});

webBlockRouter.get("/:id", async (req, res, next) => {
  try {
    const policy = await getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

webBlockRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateWebBlockPolicyRequestSchema.parse(req.body);
    res.json(await updatePolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

webBlockRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deletePolicy(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Policy not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

webBlockRouter.post("/:id/rules", async (req, res, next) => {
  try {
    const payload = createWebBlockRuleRequestSchema.parse(req.body);
    res.status(201).json(await addRule(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

webBlockRouter.patch("/:id/rules/:ruleId", async (req, res, next) => {
  try {
    const payload = updateWebBlockRuleRequestSchema.parse(req.body);
    res.json(await updateRule(req.params.id, req.params.ruleId, payload));
  } catch (err) {
    next(err);
  }
});

webBlockRouter.delete("/:id/rules/:ruleId", async (req, res, next) => {
  try {
    const deleted = await deleteRule(req.params.id, req.params.ruleId);
    if (!deleted) return res.status(404).json({ error: "Rule not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

webBlockRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const payload = assignWebBlockPolicyRequestSchema.parse(req.body);

    if (payload.agentIds.length > 0) {
      const existingCount = await prisma.agent.count({ where: { id: { in: payload.agentIds } } });
      if (existingCount !== payload.agentIds.length) {
        return res.status(400).json({ error: "One or more agentIds do not exist" });
      }
    }
    if (payload.groupIds.length > 0) {
      const existingGroupCount = await prisma.assetGroup.count({ where: { id: { in: payload.groupIds } } });
      if (existingGroupCount !== payload.groupIds.length) {
        return res.status(400).json({ error: "One or more groupIds do not exist" });
      }
    }
    const resolved = await resolveTargetAgentIds(payload.agentIds, payload.groupIds);
    if (resolved.length === 0) {
      return res.status(400).json({ error: "No agents resolved from the given agentIds/groupIds" });
    }

    res.status(201).json(await assignPolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

webBlockRouter.get("/:id/assignments", async (req, res, next) => {
  try {
    res.json(await listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

webBlockRouter.delete("/:id/assign/:assignmentId", async (req, res, next) => {
  try {
    const removed = await unassign(req.params.id, req.params.assignmentId);
    if (!removed) return res.status(404).json({ error: "Assignment not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

webBlockRouter.get("/:id/agents", async (req, res, next) => {
  try {
    const breakdown = await getPolicyAgentBreakdown(req.params.id);
    if (!breakdown) return res.status(404).json({ error: "Policy not found" });
    res.json(breakdown);
  } catch (err) {
    next(err);
  }
});
