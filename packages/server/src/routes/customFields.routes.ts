import { Router } from "express";
import { createCustomFieldRequestSchema, updateCustomFieldRequestSchema } from "@em/shared";
import {
  createFieldDefinition,
  deleteFieldDefinition,
  listFieldDefinitions,
  updateFieldDefinition,
} from "../services/customField.service";

export const customFieldsRouter = Router();

customFieldsRouter.post("/", async (req, res, next) => {
  try {
    const payload = createCustomFieldRequestSchema.parse(req.body);
    res.status(201).json(await createFieldDefinition(payload));
  } catch (err) {
    next(err);
  }
});

customFieldsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listFieldDefinitions());
  } catch (err) {
    next(err);
  }
});

customFieldsRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateCustomFieldRequestSchema.parse(req.body);
    res.json(await updateFieldDefinition(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

customFieldsRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deleteFieldDefinition(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Field not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
