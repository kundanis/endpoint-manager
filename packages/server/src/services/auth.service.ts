import bcrypt from "bcryptjs";
import type { AdminRole } from "@em/shared";
import { prisma } from "../db";
import { signAdminJwt } from "../utils/jwt";
import { createSession, SESSION_IDLE_MS } from "./adminSession.service";

export class InvalidCredentialsError extends Error {}

// Refused because someone else with the same rights is already signed in.
export class SeatTakenError extends Error {
  constructor(
    readonly holderEmail: string,
    readonly superAdmin: boolean,
  ) {
    super("Another admin with the same rights is signed in");
  }
}

// One person per role at a time: only one super admin may be signed in, and only one admin
// with exactly the same modules. "Signed in" means a session that hasn't been ended, is under
// its 12 hours and was used in the last 30 minutes (an open console tab keeps it in use).
// The same account signing in again (another browser) is allowed.
async function sameRightsHolder(admin: { id: string; role: string }): Promise<string | null> {
  const now = Date.now();
  const live = await prisma.adminSession.findMany({
    where: {
      adminId: { not: admin.id },
      revokedAt: null,
      expiresAt: { gt: new Date(now) },
      lastSeenAt: { gt: new Date(now - SESSION_IDLE_MS) },
      admin: { role: admin.role },
    },
    select: { admin: { select: { id: true, email: true, moduleGrants: { select: { moduleKey: true } } } } },
  });
  if (live.length === 0) return null;
  if (admin.role === "SUPER_ADMIN") return live[0].admin.email;

  const key = (keys: string[]) => [...new Set(keys)].sort().join(",");
  const mine = key((await prisma.adminModuleGrant.findMany({ where: { adminUserId: admin.id }, select: { moduleKey: true } })).map((g) => g.moduleKey));
  const other = live.find((s) => key(s.admin.moduleGrants.map((g) => g.moduleKey)) === mine);
  return other ? other.admin.email : null;
}

export async function login(email: string, password: string, ipAddress?: string): Promise<{ token: string; role: AdminRole }> {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) throw new InvalidCredentialsError();

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) throw new InvalidCredentialsError();

  const holder = await sameRightsHolder(admin);
  if (holder) throw new SeatTakenError(holder, admin.role === "SUPER_ADMIN");

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const sid = await createSession(admin.id, ipAddress);
  const token = signAdminJwt({ sub: admin.id, email: admin.email, sid });
  return { token, role: admin.role as AdminRole };
}
