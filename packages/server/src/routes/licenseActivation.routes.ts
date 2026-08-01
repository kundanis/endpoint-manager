import { Router } from "express";
import { z } from "zod";
import {
  ActivationDeniedError,
  LicenseServerUnreachableError,
  NoActivationError,
  UnlockRequestFailedError,
  activate,
  getStatus,
  requestUnlock,
} from "../services/licenseActivation.service";
import {
  getLicenseServerConfig,
  setLicenseServerConfig,
  testLicenseServerConnection,
} from "../services/licenseServerConfig.service";

export const licenseActivationRouter = Router();

const activateRequestSchema = z.object({
  keyString: z.string().min(1).max(64),
});

const unlockRequestSchema = z.object({
  reason: z.string().min(1).max(2000),
});

const serverConfigRequestSchema = z.object({
  url: z.string().min(1).max(500),
});

licenseActivationRouter.get("/server-config", async (_req, res, next) => {
  try {
    res.json(await getLicenseServerConfig());
  } catch (err) {
    next(err);
  }
});

// "Licence API" step — the entity admin enters the License Server's address here, and
// this only saves it once a real connection is confirmed (GET {url}/health succeeds).
licenseActivationRouter.post("/server-config", async (req, res, next) => {
  try {
    const { url } = serverConfigRequestSchema.parse(req.body);
    res.json(await setLicenseServerConfig(url));
  } catch (err) {
    if (err instanceof LicenseServerUnreachableError) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  }
});

licenseActivationRouter.post("/server-config/test", async (_req, res, next) => {
  try {
    const ok = await testLicenseServerConnection();
    res.json({ ok });
  } catch (err) {
    if (err instanceof LicenseServerUnreachableError) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  }
});

licenseActivationRouter.get("/status", async (_req, res, next) => {
  try {
    res.json(await getStatus());
  } catch (err) {
    next(err);
  }
});

licenseActivationRouter.post("/activate", async (req, res, next) => {
  try {
    const { keyString } = activateRequestSchema.parse(req.body);
    res.json(await activate(keyString));
  } catch (err) {
    if (err instanceof ActivationDeniedError) {
      return res.status(409).json({ error: err.message });
    }
    if (err instanceof LicenseServerUnreachableError) {
      return res.status(503).json({ error: err.message || "License Server is unreachable" });
    }
    next(err);
  }
});

licenseActivationRouter.post("/unlock-request", async (req, res, next) => {
  try {
    const { reason } = unlockRequestSchema.parse(req.body);
    await requestUnlock(reason);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NoActivationError) {
      return res.status(409).json({ error: "No license is currently activated on this deployment" });
    }
    if (err instanceof UnlockRequestFailedError) {
      return res.status(409).json({ error: err.message });
    }
    if (err instanceof LicenseServerUnreachableError) {
      return res.status(503).json({ error: err.message || "License Server is unreachable" });
    }
    next(err);
  }
});
