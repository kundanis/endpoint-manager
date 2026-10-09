import { Router } from "express";
import { dispatchAgentUpdateRequestSchema } from "@em/shared";
import { getLatestAgentBuild } from "../services/agentBuild.service";
import {
  AllAgentsAlreadyUpdatingError,
  createAgentUpdateJob,
  getAgentUpdateJob,
  listAgentUpdateJobs,
  NoAgentBuildStagedError,
} from "../services/agentUpdate.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { prisma } from "../db";

export const agentUpdatesRouter = Router();

// Powers the "new agent build available" banner/panel in the console — either field is null
// when that platform has never been staged (e.g. a fresh install before anyone has run the
// packaging script with a manifest), which the console renders as "no build information
// available" rather than an error.
agentUpdatesRouter.get("/latest-build", (_req, res) => {
  res.json({ windows: getLatestAgentBuild("win32"), linux: getLatestAgentBuild("linux") });
});

agentUpdatesRouter.post("/jobs", async (req, res, next) => {
  try {
    const payload = dispatchAgentUpdateRequestSchema.parse(req.body);

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

    const result = await createAgentUpdateJob({
      agentIds: resolvedAgentIds,
      groupIds: payload.groupIds,
      createdByAdminId: req.adminId!,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof NoAgentBuildStagedError) {
      return res.status(400).json({ error: "No agent build is currently staged on this server" });
    }
    if (err instanceof AllAgentsAlreadyUpdatingError) {
      return res.status(400).json({ error: "Every selected agent already has an update in progress" });
    }
    next(err);
  }
});

agentUpdatesRouter.get("/jobs", async (_req, res, next) => {
  try {
    res.json(await listAgentUpdateJobs());
  } catch (err) {
    next(err);
  }
});

agentUpdatesRouter.get("/jobs/:jobId", async (req, res, next) => {
  try {
    const job = await getAgentUpdateJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Agent update job not found" });
    res.json(job);
  } catch (err) {
    next(err);
  }
});
