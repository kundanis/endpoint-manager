import { Router } from "express";
import { createChangeRequestRequestSchema, issueLicenseKeyRequestSchema } from "../schemas/admin.schema";
import {
  ChangeRequestClosedError,
  ChangeRequestKeyNotActiveError,
  ChangeRequestNoChangeError,
  ChangeRequestNotFoundError,
  cancelChangeRequest,
  createChangeRequest,
  listChangeRequests,
} from "../services/changeRequest.service";
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

// --- Licence change requests (pushed to the key's deployment to accept or reject) ---------

licenseKeysRouter.get("/:id/change-requests", async (req, res, next) => {
  try {
    res.json(await listChangeRequests(req.params.id));
  } catch (err) {
    next(err);
  }
});

licenseKeysRouter.post("/:id/change-requests", async (req, res, next) => {
  try {
    const payload = createChangeRequestRequestSchema.parse(req.body);
    res.status(201).json(await createChangeRequest(req.params.id, payload, req.adminId!));
  } catch (err) {
    if (err instanceof ChangeRequestNotFoundError) return res.status(404).json({ error: "License key not found" });
    if (err instanceof ChangeRequestKeyNotActiveError) {
      return res.status(409).json({ error: "Changes can only be requested for an activated key" });
    }
    if (err instanceof ChangeRequestNoChangeError) return res.status(400).json({ error: "Nothing would change - adjust at least one value" });
    next(err);
  }
});

licenseKeysRouter.post("/change-requests/:requestId/cancel", async (req, res, next) => {
  try {
    res.json(await cancelChangeRequest(req.params.requestId));
  } catch (err) {
    if (err instanceof ChangeRequestClosedError) return res.status(409).json({ error: "Only a pending request can be cancelled" });
    if (err instanceof ChangeRequestNotFoundError) return res.status(404).json({ error: "Change request not found" });
    next(err);
  }
});
