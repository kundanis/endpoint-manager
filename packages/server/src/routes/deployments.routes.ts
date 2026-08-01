import { Router } from "express";
import { createDeploymentRequestSchema } from "@em/shared";
import { prisma } from "../db";
import { createDeploymentJob, getDeploymentJob, listDeploymentJobs } from "../services/deployment.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";

export const deploymentsRouter = Router();

deploymentsRouter.post("/", async (req, res, next) => {
  try {
    const payload = createDeploymentRequestSchema.parse(req.body);

    const pkg = await prisma.package.findUnique({ where: { id: payload.packageId } });
    if (!pkg) return res.status(400).json({ error: "Package not found" });

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

    const resolvedAgentIds = await resolveTargetAgentIds(payload.agentIds, payload.groupIds);
    if (resolvedAgentIds.length === 0) {
      return res.status(400).json({ error: "No agents resolved from the given agentIds/groupIds" });
    }

    const result = await createDeploymentJob({
      packageId: payload.packageId,
      agentIds: resolvedAgentIds,
      groupIds: payload.groupIds,
      createdByAdminId: req.adminId!,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

deploymentsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listDeploymentJobs());
  } catch (err) {
    next(err);
  }
});

deploymentsRouter.get("/:jobId", async (req, res, next) => {
  try {
    const job = await getDeploymentJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Deployment job not found" });
    res.json(job);
  } catch (err) {
    next(err);
  }
});
