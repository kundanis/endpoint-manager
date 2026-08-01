import { Router } from "express";
import { createCommandTemplateRequestSchema, dispatchTargetRequestSchema, updateCommandTemplateRequestSchema } from "@em/shared";
import {
  CommandTemplateNotFoundError,
  NoAgentsResolvedError,
  createTemplate,
  deleteTemplate,
  dispatchTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "../services/commandTemplate.service";

export const commandTemplatesRouter = Router();

commandTemplatesRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listTemplates());
  } catch (err) {
    next(err);
  }
});

commandTemplatesRouter.post("/", async (req, res, next) => {
  try {
    const payload = createCommandTemplateRequestSchema.parse(req.body);
    res.status(201).json(await createTemplate({ ...payload, createdByAdminId: req.adminId! }));
  } catch (err) {
    next(err);
  }
});

commandTemplatesRouter.get("/:id", async (req, res, next) => {
  try {
    const template = await getTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: "Command template not found" });
    res.json(template);
  } catch (err) {
    next(err);
  }
});

commandTemplatesRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateCommandTemplateRequestSchema.parse(req.body);
    res.json(await updateTemplate(req.params.id, payload));
  } catch (err) {
    if (err instanceof CommandTemplateNotFoundError) return res.status(404).json({ error: "Command template not found" });
    next(err);
  }
});

commandTemplatesRouter.delete("/:id", async (req, res, next) => {
  try {
    await deleteTemplate(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

commandTemplatesRouter.post("/:id/dispatch", async (req, res, next) => {
  try {
    const payload = dispatchTargetRequestSchema.parse(req.body);
    const result = await dispatchTemplate(req.params.id, payload.agentIds, payload.groupIds, req.adminId!);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof CommandTemplateNotFoundError) return res.status(404).json({ error: "Command template not found" });
    if (err instanceof NoAgentsResolvedError) {
      return res.status(400).json({ error: "No agents resolved from the given agentIds/groupIds" });
    }
    next(err);
  }
});
