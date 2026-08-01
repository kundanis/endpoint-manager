import { Router } from "express";
import { dispatchCommandRequestSchema } from "@em/shared";
import { prisma } from "../db";
import { createCommandJob, getCommandJob, listCommandJobs } from "../services/command.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";

export const commandsRouter = Router();

commandsRouter.post("/", async (req, res, next) => {
  try {
    const payload = dispatchCommandRequestSchema.parse(req.body);

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

    const result = await createCommandJob({
      agentIds: resolvedAgentIds,
      groupIds: payload.groupIds,
      shell: payload.shell,
      script: payload.script,
      timeoutSec: payload.timeoutSec,
      createdByAdminId: req.adminId!,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

commandsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listCommandJobs());
  } catch (err) {
    next(err);
  }
});

commandsRouter.get("/:jobId", async (req, res, next) => {
  try {
    const job = await getCommandJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Command job not found" });
    res.json(job);
  } catch (err) {
    next(err);
  }
});
