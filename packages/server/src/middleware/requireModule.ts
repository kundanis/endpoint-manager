import type { NextFunction, Request, Response } from "express";
import type { LicenseModule } from "@license/shared";
import { isFeatureLicensed, isModuleLicensed } from "../services/licenseActivation.service";

// Applied per top-level module's router mount in app.ts (after adminAuthMiddleware) — a
// pure defense-in-depth boundary matching the console's own nav-level lock, so a locked
// module can't be reached by calling its API directly even with the UI grayed out. A
// no-op (always calls next()) whenever LICENSE_ENFORCEMENT_ENABLED is off, exactly like
// assertCanEnroll's own enforcement gate.
export function requireModule(moduleKey: LicenseModule) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    // Mounted on nearly every /api/admin/* route, so - same reasoning as agentAuthMiddleware
    // - a transient DB error here must not become an unhandled rejection that crashes the
    // whole process; Express 4 doesn't catch a rejected promise from an async middleware itself.
    try {
      const licensed = await isModuleLicensed(moduleKey);
      if (!licensed) {
        return res.status(403).json({ error: `The ${moduleKey} module is not included in this license`, moduleKey });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// The same for a sub-module or feature within a licensed module (@license/shared features). The
// console shows these locked; this keeps their API closed too.
export function requireFeature(featureKey: string) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await isFeatureLicensed(featureKey))) {
        return res.status(403).json({ error: "This feature is not included in your licence. Contact your vendor to add it.", featureKey });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
