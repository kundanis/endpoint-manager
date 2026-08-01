import jwt from "jsonwebtoken";
import { config } from "../config";

const EXPIRES_IN = "12h";

export interface LicenseAdminJwtPayload {
  sub: string;
  email: string;
}

export function signAdminJwt(payload: LicenseAdminJwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: EXPIRES_IN });
}

export function verifyAdminJwt(token: string): LicenseAdminJwtPayload {
  return jwt.verify(token, config.jwtSecret) as LicenseAdminJwtPayload;
}
