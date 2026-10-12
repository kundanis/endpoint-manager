import { Router } from "express";
import { createAutoPatchPolicyRequestSchema, dispatchPatchJobRequestSchema, updateAutoPatchPolicyRequestSchema } from "@em/shared";
import { prisma } from "../db";
import { createPatchJob, getAgentsMissingPatch, getFleetPatchSummary, getPatchJob, listPatchJobs } from "../services/patch.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import {
  AutoPatchPolicyNotFoundError,
  createAutoPatchPolicy,
  deleteAutoPatchPolicy,
  listAutoPatchPolicies,
  updateAutoPatchPolicy,
} from "../services/autoPatchPolicy.service";

export const patchesRouter = Router();

patchesRouter.get("/", async (req, res, next) => {
  try {
    const groupId = typeof req.query.groupId === "string" ? req.query.groupId : undefined;
    res.json(await getFleetPatchSummary(groupId));
  } catch (err) {
    next(err);
  }
});

// Endpoints on which a specific patch is currently missing (per-patch drill-down). The
// ":patchDefinitionId/agents" shape never collides with "/jobs/:jobId" or "/auto-policies"
// since the second segment must be the literal "agents".
patchesRouter.get("/:patchDefinitionId/agents", async (req, res, next) => {
  try {
    res.json(await getAgentsMissingPatch(req.params.patchDefinitionId));
  } catch (err) {
    next(err);
  }
});

patchesRouter.get("/auto-policies", async (_req, res, next) => {
  try {
    res.json(await listAutoPatchPolicies());
  } catch (err) {
    next(err);
  }
});

patchesRouter.post("/auto-policies", async (req, res, next) => {
  try {
    const payload = createAutoPatchPolicyRequestSchema.parse(req.body);
    res.status(201).json(await createAutoPatchPolicy(payload, req.adminId!));
  } catch (err) {
    next(err);
  }
});

patchesRouter.patch("/auto-policies/:id", async (req, res, next) => {
  try {
    const payload = updateAutoPatchPolicyRequestSchema.parse(req.body);
    res.json(await updateAutoPatchPolicy(req.params.id, payload));
  } catch (err) {
    if (err instanceof AutoPatchPolicyNotFoundError) return res.status(404).json({ error: "Auto-patch policy not found" });
    next(err);
  }
});

patchesRouter.delete("/auto-policies/:id", async (req, res, next) => {
  try {
    const deleted = await deleteAutoPatchPolicy(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Auto-patch policy not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

patchesRouter.post("/jobs", async (req, res, next) => {
  try {
    const payload = dispatchPatchJobRequestSchema.parse(req.body);

    if (payload.agentIds.length > 0) {
      const existingAgentCount = await prisma.agent.count({ where: { id: { in: payload.agentIds } } });
      if (existingAgentCount !== payload.agentIds.length) {
        return res.status(400).json({ error: "One or more agentIds do not exist" });
      }
    }
    if (payload.groupIds.length > 0) {
      const existingGroupCount = await prisma.assetGroup.count({ where: { id: { in: payload.groupIds } } });
      if (existingGroupCount !== payload.groupIds.length) {
        return res.status(400).json({ error: "One or more groupIds do not exist" });
      }
    }
    const existingDefinitionCount = await prisma.patchDefinition.count({
      where: { updateId: { in: payload.updateIds } },
    });
    if (existingDefinitionCount !== payload.updateIds.length) {
      return res.status(400).json({ error: "One or more updateIds do not correspond to a known patch" });
    }

    const resolvedAgentIds = await resolveTargetAgentIds(payload.agentIds, payload.groupIds);
    if (resolvedAgentIds.length === 0) {
      return res.status(400).json({ error: "No agents resolved from the given agentIds/groupIds" });
    }

    const result = await createPatchJob({
      updateIds: payload.updateIds,
      agentIds: resolvedAgentIds,
      groupIds: payload.groupIds,
      createdByAdminId: req.adminId!,
      scheduledAt: payload.scheduledAt,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

patchesRouter.get("/jobs", async (_req, res, next) => {
  try {
    res.json(await listPatchJobs());
  } catch (err) {
    next(err);
  }
});

patchesRouter.get("/jobs/:jobId", async (req, res, next) => {
  try {
    const job = await getPatchJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Patch job not found" });
    res.json(job);
  } catch (err) {
    next(err);
  }
});
