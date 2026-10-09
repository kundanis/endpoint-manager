import type { NextFunction, Request, Response } from "express";
import type { AdminModuleKey, AdminRole } from "@em/shared";
import { verifyAdminJwt } from "../utils/jwt";
import { prisma } from "../db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminId?: string;
      adminEmail?: string;
      adminRole?: AdminRole;
      adminModuleGrantKeys?: AdminModuleKey[];
    }
  }
}

// The JWT itself only ever carries {sub, email} (unchanged) - role and module grants are
// looked up fresh from the database on every request instead of baked into the token, so
// a demotion/grant change takes effect on the very next request rather than waiting up to
// COOKIE_MAX_AGE_MS for the old token to expire. This mirrors how isModuleLicensed already
// does a fresh per-request DB check for the license side of authorization - identity can
// tolerate some staleness (the token itself), but what an already-authenticated admin is
// allowed to do should not. Also tightens a pre-existing gap: a deleted admin's token would
// previously still pass this middleware since it never touched the database at all.
export async function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : undefined;
  const token = bearer ?? req.cookies?.["em_admin_jwt"];

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  let payload;
  try {
    payload = verifyAdminJwt(token);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // Outside the JWT try/catch on purpose - a DB error here is a real 500, not an auth
  // failure, and must go through next(err) rather than being reported as "invalid session".
  try {
    const admin = await prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: { role: true, moduleGrants: { select: { moduleKey: true } } },
    });
    if (!admin) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    req.adminId = payload.sub;
    req.adminEmail = payload.email;
    req.adminRole = admin.role as AdminRole;
    req.adminModuleGrantKeys = admin.moduleGrants.map((g) => g.moduleKey as AdminModuleKey);
    next();
  } catch (err) {
    next(err);
  }
}
