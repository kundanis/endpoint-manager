import { Router } from "express";
import {
  assignZeroTrustPolicyRequestSchema,
  createZeroTrustConditionRequestSchema,
  createZeroTrustPolicyRequestSchema,
  updateZeroTrustConditionRequestSchema,
  updateZeroTrustPolicyRequestSchema,
  zeroTrustOverrideBulkRequestSchema,
} from "@em/shared";
import {
  addCondition,
  assignPolicy,
  createPolicy,
  deleteCondition,
  deletePolicy,
  getFindingsForAgent,
  getPolicy,
  getPolicyAgentBreakdown,
  listAssignments,
  listPolicies,
  unassign,
  updateCondition,
  updatePolicy,
} from "../services/zeroTrustPolicy.service";
import { applyForceComply, listOverridableConditionKeys, revokeOverride } from "../services/zeroTrustOverride.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { prisma } from "../db";

export const zeroTrustRouter = Router();

// Everything under /overrides is the ENTIRE surface this feature exists on — no other
// route, list, or CSV export anywhere in the product exposes override state (see
// zeroTrustOverride.service.ts and ZeroTrustCheckOverride's schema comment). Mounted before
// the "/:id" routes below so "overrides" is never swallowed as a policy id.
zeroTrustRouter.get("/overrides/condition-keys", async (_req, res, next) => {
  try {
    res.json(await listOverridableConditionKeys());
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.post("/overrides/force-comply", async (req, res, next) => {
  try {
    const payload = zeroTrustOverrideBulkRequestSchema.parse(req.body);
    res.json(await applyForceComply(payload.agentIds, payload.conditionKeys, req.adminId!));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.post("/overrides/revoke", async (req, res, next) => {
  try {
    const payload = zeroTrustOverrideBulkRequestSchema.parse(req.body);
    res.json(await revokeOverride(payload.agentIds, payload.conditionKeys));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.post("/", async (req, res, next) => {
  try {
    const payload = createZeroTrustPolicyRequestSchema.parse(req.body);
    res.status(201).json(await createPolicy(payload, req.adminId!));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listPolicies());
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.get("/agents/:agentId", async (req, res, next) => {
  try {
    res.json(await getFindingsForAgent(req.params.agentId));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.get("/:id", async (req, res, next) => {
  try {
    const policy = await getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateZeroTrustPolicyRequestSchema.parse(req.body);
    res.json(await updatePolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deletePolicy(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Policy not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.post("/:id/conditions", async (req, res, next) => {
  try {
    const payload = createZeroTrustConditionRequestSchema.parse(req.body);
    res.status(201).json(await addCondition(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.patch("/:id/conditions/:conditionId", async (req, res, next) => {
  try {
    const payload = updateZeroTrustConditionRequestSchema.parse(req.body);
    res.json(await updateCondition(req.params.id, req.params.conditionId, payload));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.delete("/:id/conditions/:conditionId", async (req, res, next) => {
  try {
    const deleted = await deleteCondition(req.params.id, req.params.conditionId);
    if (!deleted) return res.status(404).json({ error: "Condition not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const payload = assignZeroTrustPolicyRequestSchema.parse(req.body);

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

zeroTrustRouter.get("/:id/assignments", async (req, res, next) => {
  try {
    res.json(await listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.delete("/:id/assign/:assignmentId", async (req, res, next) => {
  try {
    const removed = await unassign(req.params.id, req.params.assignmentId);
    if (!removed) return res.status(404).json({ error: "Assignment not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.get("/:id/agents", async (req, res, next) => {
  try {
    const breakdown = await getPolicyAgentBreakdown(req.params.id);
    if (!breakdown) return res.status(404).json({ error: "Policy not found" });
    res.json(breakdown);
  } catch (err) {
    next(err);
  }
});
