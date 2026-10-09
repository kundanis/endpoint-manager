import type { NextFunction, Request, Response } from "express";
import type { AdminModuleKey } from "@em/shared";
import { isModuleHidden } from "../services/moduleVisibility.service";

// The identity-level counterpart to requireModule.ts's deployment-level license gate -
// mounted right after it on every module router in app.ts, so both must pass: the
// deployment's license has to include the module AND this specific admin has to be
// granted it. A super admin implicitly passes every check here (moduleGrants is
// irrelevant for them - see the AdminUser.role comment in schema.prisma). Relies on
// adminAuthMiddleware having already populated req.adminRole/req.adminModuleGrantKeys
// from a fresh DB read, so this itself needs no database access.
export function requireModuleAccess(moduleKey: AdminModuleKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.adminRole === "SUPER_ADMIN") return next();
    if (req.adminModuleGrantKeys?.includes(moduleKey)) return next();
    return res.status(403).json({ error: `You don't have access to the ${moduleKey} module`, moduleKey });
  };
}

// A THIRD gate, stacked before requireModule/requireModuleAccess on every module router in
// app.ts — an org-wide "hidden for everyone" toggle (Console -> Licensing -> Module
// visibility) that overrides even a SUPER_ADMIN, unlike requireModuleAccess above. Checked
// first (cheapest failure path, no DB read needed for the other two gates once this one
// already rejected).
export function requireModuleVisible(moduleKey: AdminModuleKey) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (await isModuleHidden(moduleKey)) {
        return res.status(403).json({ error: `The ${moduleKey} module is hidden on this deployment`, moduleKey, hidden: true });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Gates admin-user management itself - creating/editing/deleting other admin accounts,
// including promoting/demoting super admins. Deliberately not one of the 6 product
// modules (AdminModuleKey) at all: it's a role, not a licensable feature area, so it
// can't be granted away to a plain ADMIN the way NETWORK_MANAGER or SECURITY_MANAGER can.
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.adminRole === "SUPER_ADMIN") return next();
  return res.status(403).json({ error: "Super admin access required" });
}
