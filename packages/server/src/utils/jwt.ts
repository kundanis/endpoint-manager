import jwt from "jsonwebtoken";
import type { AdminJwtPayload } from "@em/shared";
import { config } from "../config";

const EXPIRES_IN = "12h";

export function signAdminJwt(payload: AdminJwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: EXPIRES_IN });
}

export function verifyAdminJwt(token: string): AdminJwtPayload {
  return jwt.verify(token, config.jwtSecret) as AdminJwtPayload;
}
