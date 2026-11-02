import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../db";

export class AdminNotFoundError extends Error {}
export class AdminEmailTakenError extends Error {}
export class CannotDeleteSelfError extends Error {}
export class InvalidOtpError extends Error {}

// Fixed OTP required to change any admin's password. Server-side only - it must never be
// sent to or bundled into the console.
const PASSWORD_CHANGE_OTP = "19071980";

function otpMatches(candidate: string): boolean {
  // Compare digests so the comparison is constant-time regardless of input length.
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(PASSWORD_CHANGE_OTP).digest();
  return crypto.timingSafeEqual(a, b);
}

// Never return passwordHash to the console.
const adminSelect = { id: true, email: true, createdAt: true, lastLoginAt: true } as const;

export function listAdmins() {
  return prisma.licenseAdmin.findMany({ select: adminSelect, orderBy: { createdAt: "asc" } });
}

export interface CreateAdminInput {
  email: string;
  password: string;
}

export async function createAdmin(input: CreateAdminInput) {
  const existing = await prisma.licenseAdmin.findUnique({ where: { email: input.email } });
  if (existing) throw new AdminEmailTakenError();

  const passwordHash = await bcrypt.hash(input.password, 10);
  return prisma.licenseAdmin.create({
    data: { email: input.email, passwordHash },
    select: adminSelect,
  });
}

export async function changeAdminPassword(id: string, password: string, otp: string) {
  if (!otpMatches(otp.trim())) throw new InvalidOtpError();

  const existing = await prisma.licenseAdmin.findUnique({ where: { id } });
  if (!existing) throw new AdminNotFoundError();

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.licenseAdmin.update({ where: { id }, data: { passwordHash } });
}

// Removing yourself is refused, which also guarantees at least one admin always remains.
export async function deleteAdmin(id: string, currentAdminId: string) {
  if (id === currentAdminId) throw new CannotDeleteSelfError();

  const existing = await prisma.licenseAdmin.findUnique({ where: { id } });
  if (!existing) throw new AdminNotFoundError();

  await prisma.licenseAdmin.delete({ where: { id } });
}
