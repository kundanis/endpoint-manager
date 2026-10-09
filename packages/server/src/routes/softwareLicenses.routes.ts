import { Router } from "express";
import {
  createSoftwareLicenseRequestSchema,
  importSoftwareLicensesRequestSchema,
  updateSoftwareLicenseRequestSchema,
} from "@em/shared";
import {
  createLicense,
  deleteLicense,
  getLicense,
  importLicenses,
  listLicenses,
  updateLicense,
} from "../services/softwareLicense.service";

export const softwareLicensesRouter = Router();

softwareLicensesRouter.post("/", async (req, res, next) => {
  try {
    const payload = createSoftwareLicenseRequestSchema.parse(req.body);
    res.status(201).json(await createLicense(payload, req.adminId!));
  } catch (err) {
    next(err);
  }
});

softwareLicensesRouter.post("/import", async (req, res, next) => {
  try {
    const payload = importSoftwareLicensesRequestSchema.parse(req.body);
    res.status(201).json(await importLicenses(payload.licenses, req.adminId!));
  } catch (err) {
    next(err);
  }
});

softwareLicensesRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listLicenses());
  } catch (err) {
    next(err);
  }
});

softwareLicensesRouter.get("/:id", async (req, res, next) => {
  try {
    const license = await getLicense(req.params.id);
    if (!license) return res.status(404).json({ error: "License not found" });
    res.json(license);
  } catch (err) {
    next(err);
  }
});

softwareLicensesRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateSoftwareLicenseRequestSchema.parse(req.body);
    res.json(await updateLicense(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

softwareLicensesRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deleteLicense(req.params.id);
    if (!deleted) return res.status(404).json({ error: "License not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
