import { Router } from "express";
import { issueLicenseKeyRequestSchema } from "../schemas/admin.schema";
import { EntityNotFoundError } from "../services/entity.service";
import {
  LicenseKeyNotFoundError,
  LicenseKeyNotRevocableError,
  getLicenseKeyById,
  issueLicenseKey,
  listLicenseKeys,
  revokeLicenseKey,
} from "../services/licenseKey.service";

export const licenseKeysRouter = Router();

licenseKeysRouter.post("/", async (req, res, next) => {
  try {
    const payload = issueLicenseKeyRequestSchema.parse(req.body);
    const { licenseKey, keyString } = await issueLicenseKey({
      ...payload,
      issuedByAdminId: req.adminId!,
    });
    res.status(201).json({ ...licenseKey, keyString });
  } catch (err) {
    if (err instanceof EntityNotFoundError) {
      return res.status(404).json({ error: "Entity not found" });
    }
    next(err);
  }
});

licenseKeysRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listLicenseKeys());
  } catch (err) {
    next(err);
  }
});

licenseKeysRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await getLicenseKeyById(req.params.id));
  } catch (err) {
    if (err instanceof LicenseKeyNotFoundError) {
      return res.status(404).json({ error: "License key not found" });
    }
    next(err);
  }
});

licenseKeysRouter.post("/:id/revoke", async (req, res, next) => {
  try {
    res.json(await revokeLicenseKey(req.params.id));
  } catch (err) {
    if (err instanceof LicenseKeyNotRevocableError) {
      return res.status(409).json({ error: "License key cannot be revoked in its current state" });
    }
    next(err);
  }
});
