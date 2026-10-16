import { Router } from "express";
import { applyDataTypesRequestSchema, createDataTypeRequestSchema, updateDataTypeRequestSchema } from "@em/shared";
import { applyDataTypes, createDataType, DataTypeError, deleteDataType, listDataTypes, updateDataType } from "../services/dataTypes.service";

export const dataTypesRouter = Router();

dataTypesRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listDataTypes());
  } catch (err) {
    next(err);
  }
});

dataTypesRouter.post("/", async (req, res, next) => {
  try {
    const payload = createDataTypeRequestSchema.parse(req.body);
    res.status(201).json(await createDataType(payload, req.adminId!));
  } catch (err) {
    if (err instanceof DataTypeError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Adds the chosen data types' values as rules on a DLP / EPM policy.
dataTypesRouter.post("/apply", async (req, res, next) => {
  try {
    const payload = applyDataTypesRequestSchema.parse(req.body);
    res.json(await applyDataTypes(payload));
  } catch (err) {
    if (err instanceof DataTypeError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Built-in data types (id "builtin:...") can't be edited or deleted - they aren't in the table.
dataTypesRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateDataTypeRequestSchema.parse(req.body);
    const updated = await updateDataType(req.params.id, payload);
    if (!updated) return res.status(404).json({ error: "Data type not found" });
    res.json(updated);
  } catch (err) {
    if (err instanceof DataTypeError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

dataTypesRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!(await deleteDataType(req.params.id))) return res.status(404).json({ error: "Data type not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
