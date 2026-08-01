import { Router } from "express";
import { assignDataDiscoveryPolicyRequestSchema, createDataDiscoveryPolicyRequestSchema, updateDataDiscoveryPolicyRequestSchema } from "@em/shared";
import {
  assignPolicy,
  createPolicy,
  deletePolicy,
  getFindingsForAgent,
  getPolicy,
  getPolicyAgentBreakdown,
  listAssignments,
  listPolicies,
  requestScanNow,
  unassign,
  updatePolicy,
} from "../services/dataDiscoveryPolicy.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { prisma } from "../db";

export const dataDiscoveryRouter = Router();

dataDiscoveryRouter.post("/", async (req, res, next) => {
  try {
    const payload = createDataDiscoveryPolicyRequestSchema.parse(req.body);
    res.status(201).json(await createPolicy(payload, req.adminId!));
  } catch (err) {
    next(err);
  }
});

dataDiscoveryRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listPolicies());
  } catch (err) {
    next(err);
  }
});

dataDiscoveryRouter.get("/agents/:agentId", async (req, res, next) => {
  try {
    res.json(await getFindingsForAgent(req.params.agentId));
  } catch (err) {
    next(err);
  }
});

dataDiscoveryRouter.get("/:id", async (req, res, next) => {
  try {
    const policy = await getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

dataDiscoveryRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateDataDiscoveryPolicyRequestSchema.parse(req.body);
    res.json(await updatePolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

dataDiscoveryRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deletePolicy(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Policy not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

dataDiscoveryRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const payload = assignDataDiscoveryPolicyRequestSchema.parse(req.body);

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

dataDiscoveryRouter.get("/:id/assignments", async (req, res, next) => {
  try {
    res.json(await listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

dataDiscoveryRouter.delete("/:id/assign/:assignmentId", async (req, res, next) => {
  try {
    const removed = await unassign(req.params.id, req.params.assignmentId);
    if (!removed) return res.status(404).json({ error: "Assignment not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

dataDiscoveryRouter.post("/:id/scan-now", async (req, res, next) => {
  try {
    const agentId = typeof req.body?.agentId === "string" ? req.body.agentId : undefined;
    const result = await requestScanNow(req.params.id, agentId);
    if (!result) return res.status(404).json({ error: "Policy not found" });
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
});

dataDiscoveryRouter.get("/:id/agents", async (req, res, next) => {
  try {
    const breakdown = await getPolicyAgentBreakdown(req.params.id);
    if (!breakdown) return res.status(404).json({ error: "Policy not found" });
    res.json(breakdown);
  } catch (err) {
    next(err);
  }
});
