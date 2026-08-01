import type { NextFunction, Request, Response } from "express";
import { verifyAdminJwt } from "../utils/jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminId?: string;
      adminEmail?: string;
    }
  }
}

export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : undefined;
  const token = bearer ?? req.cookies?.["em_admin_jwt"];

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const payload = verifyAdminJwt(token);
    req.adminId = payload.sub;
    req.adminEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}
