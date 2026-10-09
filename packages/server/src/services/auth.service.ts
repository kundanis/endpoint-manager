import bcrypt from "bcryptjs";
import type { AdminRole } from "@em/shared";
import { prisma } from "../db";
import { signAdminJwt } from "../utils/jwt";

export class InvalidCredentialsError extends Error {}

export async function login(email: string, password: string): Promise<{ token: string; role: AdminRole }> {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) throw new InvalidCredentialsError();

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) throw new InvalidCredentialsError();

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const token = signAdminJwt({ sub: admin.id, email: admin.email });
  return { token, role: admin.role as AdminRole };
}
