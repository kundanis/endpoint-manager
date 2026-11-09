import bcrypt from "bcryptjs";
import type { AdminRole } from "@em/shared";
import { prisma } from "../db";
import { signAdminJwt } from "../utils/jwt";
import { createSession } from "./adminSession.service";

export class InvalidCredentialsError extends Error {}

export async function login(email: string, password: string, ipAddress?: string): Promise<{ token: string; role: AdminRole }> {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) throw new InvalidCredentialsError();

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) throw new InvalidCredentialsError();

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const sid = await createSession(admin.id, ipAddress);
  const token = signAdminJwt({ sub: admin.id, email: admin.email, sid });
  return { token, role: admin.role as AdminRole };
}
