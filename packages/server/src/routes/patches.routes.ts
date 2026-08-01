import { Router } from "express";
import { dispatchPatchJobRequestSchema } from "@em/shared";
import { prisma } from "../db";
import { createPatchJob, getFleetPatchSummary, getPatchJob, listPatchJobs } from "../services/patch.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";

export const patchesRouter = Router();

patchesRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getFleetPatchSummary());
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
