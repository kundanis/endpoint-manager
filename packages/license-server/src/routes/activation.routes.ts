import { Router } from "express";
import rateLimit from "express-rate-limit";
import { activateRequestSchema, revalidateRequestSchema, unlockRequestRequestSchema } from "@license/shared";
import {
  BindingMismatchError,
  LicenseKeyAlreadyActivatedError,
  LicenseKeyExpiredError,
  LicenseKeyNotFoundError,
  LicenseKeyRevokedError,
  activate,
  revalidate,
} from "../services/activation.service";
import { createUnlockRequest } from "../services/unlockRequest.service";

export const activationRouter = Router();

const publicRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// Deliberately generic: an unauthenticated caller must not be able to distinguish
// "key doesn't exist" from "key already activated" from "key revoked/expired" —
// any of those leaking would help an attacker enumerate or probe valid keys.
function isActivationDenialError(err: unknown): boolean {
  return (
    err instanceof LicenseKeyNotFoundError ||
    err instanceof LicenseKeyRevokedError ||
    err instanceof LicenseKeyExpiredError ||
    err instanceof LicenseKeyAlreadyActivatedError
  );
}

activationRouter.post("/activate", publicRateLimiter, async (req, res, next) => {
  try {
    const payload = activateRequestSchema.parse(req.body);
    const result = await activate(payload.keyString, payload.deploymentId);
    res.status(201).json(result);
  } catch (err) {
    if (isActivationDenialError(err)) {
      return res.status(409).json({ error: "License key is not available for activation" });
    }
    next(err);
  }
});

activationRouter.post("/revalidate", publicRateLimiter, async (req, res, next) => {
  try {
    const payload = revalidateRequestSchema.parse(req.body);
    const result = await revalidate(payload.keyString, payload.deploymentId, payload.bindingToken);
    res.json(result);
  } catch (err) {
    if (err instanceof LicenseKeyNotFoundError || err instanceof BindingMismatchError) {
      return res.status(403).json({ error: "License key or binding could not be verified" });
    }
    next(err);
  }
});

activationRouter.post("/unlock-request", publicRateLimiter, async (req, res, next) => {
  try {
    const payload = unlockRequestRequestSchema.parse(req.body);
    const result = await createUnlockRequest(payload.keyString, payload.deploymentId, payload.reason);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof LicenseKeyNotFoundError) {
      return res.status(404).json({ error: "License key not found" });
    }
    next(err);
  }
});
