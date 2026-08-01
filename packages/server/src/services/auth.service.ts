import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { signAdminJwt } from "../utils/jwt";

export class InvalidCredentialsError extends Error {}

export async function login(email: string, password: string): Promise<string> {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) throw new InvalidCredentialsError();

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) throw new InvalidCredentialsError();

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  return signAdminJwt({ sub: admin.id, email: admin.email });
}
