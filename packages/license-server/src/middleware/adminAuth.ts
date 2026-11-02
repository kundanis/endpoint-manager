import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";
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

export async function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : undefined;
  const token = bearer ?? req.cookies?.["ls_admin_jwt"];

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  let payload: ReturnType<typeof verifyAdminJwt>;
  try {
    payload = verifyAdminJwt(token);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // A removed admin's JWT stays cryptographically valid until it expires, so confirm the
  // account still exists. Errors go to next() - Express 4 doesn't catch async rejections.
  try {
    const admin = await prisma.licenseAdmin.findUnique({ where: { id: payload.sub }, select: { id: true } });
    if (!admin) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    req.adminId = payload.sub;
    req.adminEmail = payload.email;
    next();
  } catch (err) {
    next(err);
  }
}
