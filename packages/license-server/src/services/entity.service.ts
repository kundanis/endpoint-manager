import { prisma } from "../db";

export class EntityNotFoundError extends Error {}

export interface CreateEntityInput {
  name: string;
  contactEmail?: string;
}

export function createEntity(input: CreateEntityInput) {
  return prisma.entity.create({
    data: { name: input.name, contactEmail: input.contactEmail },
  });
}

export function listEntities() {
  return prisma.entity.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { licenseKeys: true } } },
  });
}

export async function getEntityById(id: string) {
  const entity = await prisma.entity.findUnique({
    where: { id },
    include: { licenseKeys: true },
  });
  if (!entity) throw new EntityNotFoundError();
  return entity;
}

export interface UpdateEntityInput {
  name?: string;
  contactEmail?: string | null;
}

export async function updateEntity(id: string, input: UpdateEntityInput) {
  const existing = await prisma.entity.findUnique({ where: { id } });
  if (!existing) throw new EntityNotFoundError();

  return prisma.entity.update({
    where: { id },
    data: { name: input.name, contactEmail: input.contactEmail },
  });
}
