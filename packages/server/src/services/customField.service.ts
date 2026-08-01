import type { CreateCustomFieldRequest, UpdateCustomFieldRequest } from "@em/shared";
import { prisma } from "../db";

export async function createFieldDefinition(params: CreateCustomFieldRequest) {
  const def = await prisma.customFieldDefinition.create({
    data: {
      name: params.name,
      fieldType: params.fieldType,
      options: JSON.stringify(params.options ?? []),
    },
  });
  return serializeDefinition(def);
}

export async function listFieldDefinitions() {
  const defs = await prisma.customFieldDefinition.findMany({ orderBy: { name: "asc" } });
  return defs.map(serializeDefinition);
}

export async function updateFieldDefinition(id: string, params: UpdateCustomFieldRequest) {
  const def = await prisma.customFieldDefinition.update({
    where: { id },
    data: {
      name: params.name,
      options: params.options ? JSON.stringify(params.options) : undefined,
    },
  });
  return serializeDefinition(def);
}

export async function deleteFieldDefinition(id: string): Promise<boolean> {
  try {
    await prisma.customFieldDefinition.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

function serializeDefinition(d: { id: string; name: string; fieldType: string; options: string; createdAt: Date }) {
  return {
    id: d.id,
    name: d.name,
    fieldType: d.fieldType as "TEXT" | "NUMBER" | "DATE" | "SELECT",
    options: JSON.parse(d.options) as string[],
    createdAt: d.createdAt.toISOString(),
  };
}
