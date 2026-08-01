import { Router } from "express";
import { createEntityRequestSchema, updateEntityRequestSchema } from "../schemas/admin.schema";
import { EntityNotFoundError, createEntity, getEntityById, listEntities, updateEntity } from "../services/entity.service";

export const entitiesRouter = Router();

entitiesRouter.post("/", async (req, res, next) => {
  try {
    const payload = createEntityRequestSchema.parse(req.body);
    res.status(201).json(await createEntity(payload));
  } catch (err) {
    next(err);
  }
});

entitiesRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listEntities());
  } catch (err) {
    next(err);
  }
});

entitiesRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await getEntityById(req.params.id));
  } catch (err) {
    if (err instanceof EntityNotFoundError) {
      return res.status(404).json({ error: "Entity not found" });
    }
    next(err);
  }
});

entitiesRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateEntityRequestSchema.parse(req.body);
    res.json(await updateEntity(req.params.id, payload));
  } catch (err) {
    if (err instanceof EntityNotFoundError) {
      return res.status(404).json({ error: "Entity not found" });
    }
    next(err);
  }
});
