import { Router } from "express";
import { createAssetGroupRequestSchema, groupMembersRequestSchema, updateAssetGroupRequestSchema } from "@em/shared";
import { prisma } from "../db";
import {
  addGroupMembers,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  removeGroupMember,
  updateGroup,
} from "../services/assetGroup.service";
import { GroupTreeError } from "../services/groupTree.service";

export const assetGroupsRouter = Router();

assetGroupsRouter.post("/", async (req, res, next) => {
  try {
    const payload = createAssetGroupRequestSchema.parse(req.body);
    res.status(201).json(await createGroup(payload));
  } catch (err) {
    if (err instanceof GroupTreeError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

assetGroupsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listGroups());
  } catch (err) {
    if (err instanceof GroupTreeError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

assetGroupsRouter.get("/:id", async (req, res, next) => {
  try {
    const group = await getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    res.json(group);
  } catch (err) {
    if (err instanceof GroupTreeError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

assetGroupsRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateAssetGroupRequestSchema.parse(req.body);
    res.json(await updateGroup(req.params.id, payload));
  } catch (err) {
    if (err instanceof GroupTreeError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

assetGroupsRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deleteGroup(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Group not found" });
    res.status(204).send();
  } catch (err) {
    if (err instanceof GroupTreeError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

assetGroupsRouter.post("/:id/members", async (req, res, next) => {
  try {
    const payload = groupMembersRequestSchema.parse(req.body);

    const existingCount = await prisma.agent.count({ where: { id: { in: payload.agentIds } } });
    if (existingCount !== payload.agentIds.length) {
      return res.status(400).json({ error: "One or more agentIds do not exist" });
    }

    await addGroupMembers(req.params.id, payload.agentIds);
    res.status(204).send();
  } catch (err) {
    if (err instanceof GroupTreeError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

assetGroupsRouter.delete("/:id/members/:agentId", async (req, res, next) => {
  try {
    await removeGroupMember(req.params.id, req.params.agentId);
    res.status(204).send();
  } catch (err) {
    if (err instanceof GroupTreeError) return res.status(400).json({ error: err.message });
    next(err);
  }
});
