import bcrypt from "bcryptjs";
import type { AdminModuleKey, AdminRole, CreateAdminUserRequest, UpdateAdminUserRequest } from "@em/shared";
import { prisma } from "../db";

export class EmailAlreadyExistsError extends Error {}
export class AdminUserNotFoundError extends Error {}
export class LastSuperAdminError extends Error {}
export class CannotDeleteSelfError extends Error {}

function serialize(admin: {
  id: string;
  email: string;
  role: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  moduleGrants: { moduleKey: string }[];
}) {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role as AdminRole,
    moduleGrants: admin.moduleGrants.map((g) => g.moduleKey as AdminModuleKey),
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    createdAt: admin.createdAt.toISOString(),
  };
}

async function countSuperAdmins(excludingId?: string): Promise<number> {
  return prisma.adminUser.count({
    where: { role: "SUPER_ADMIN", id: excludingId ? { not: excludingId } : undefined },
  });
}

export async function listAdminUsers() {
  const admins = await prisma.adminUser.findMany({
    orderBy: { createdAt: "asc" },
    include: { moduleGrants: { select: { moduleKey: true } } },
  });
  return admins.map(serialize);
}

export async function createAdminUser(params: CreateAdminUserRequest, createdByAdminId: string) {
  const existing = await prisma.adminUser.findUnique({ where: { email: params.email }, select: { id: true } });
  if (existing) throw new EmailAlreadyExistsError();

  const passwordHash = await bcrypt.hash(params.password, 10);
  // Deduped defensively - AdminModuleGrant's unique [adminUserId, moduleKey] constraint
  // would otherwise reject a caller-supplied array with an accidental repeat.
  const uniqueGrants = [...new Set(params.moduleGrants)];

  const admin = await prisma.adminUser.create({
    data: {
      email: params.email,
      passwordHash,
      role: params.role,
      createdByAdminId,
      moduleGrants: { create: uniqueGrants.map((moduleKey) => ({ moduleKey })) },
    },
    include: { moduleGrants: { select: { moduleKey: true } } },
  });
  return serialize(admin);
}

export async function updateAdminUser(id: string, params: UpdateAdminUserRequest) {
  const existing = await prisma.adminUser.findUnique({ where: { id } });
  if (!existing) throw new AdminUserNotFoundError();

  // Guard BEFORE writing anything - demoting the last super admin would permanently lock
  // every account out of admin-user management (and every other super-admin-only action),
  // with no way back in short of a direct database edit.
  if (params.role === "ADMIN" && existing.role === "SUPER_ADMIN") {
    const remaining = await countSuperAdmins(id);
    if (remaining === 0) throw new LastSuperAdminError();
  }

  const passwordHash = params.password ? await bcrypt.hash(params.password, 10) : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id },
      data: {
        role: params.role,
        passwordHash,
      },
    });

    // Full-replace, same idiom as PUT /agents/:id/groups - simpler and safer than diffing
    // add/remove sets for a form that always submits the complete desired grant list.
    if (params.moduleGrants) {
      const uniqueGrants = [...new Set(params.moduleGrants)];
      await tx.adminModuleGrant.deleteMany({ where: { adminUserId: id } });
      if (uniqueGrants.length > 0) {
        await tx.adminModuleGrant.createMany({
          data: uniqueGrants.map((moduleKey) => ({ adminUserId: id, moduleKey })),
        });
      }
    }
  });

  const admin = await prisma.adminUser.findUniqueOrThrow({
    where: { id },
    include: { moduleGrants: { select: { moduleKey: true } } },
  });
  return serialize(admin);
}

export async function deleteAdminUser(id: string, actingAdminId: string): Promise<void> {
  if (id === actingAdminId) throw new CannotDeleteSelfError();

  const existing = await prisma.adminUser.findUnique({ where: { id } });
  if (!existing) throw new AdminUserNotFoundError();

  if (existing.role === "SUPER_ADMIN") {
    const remaining = await countSuperAdmins(id);
    if (remaining === 0) throw new LastSuperAdminError();
  }

  await prisma.adminUser.delete({ where: { id } });
}
