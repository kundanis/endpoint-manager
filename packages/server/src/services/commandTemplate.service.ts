import type { CreateCommandTemplateRequest, Shell, UpdateCommandTemplateRequest } from "@em/shared";
import { DEFAULT_COMMAND_TIMEOUT_SEC } from "@em/shared";
import { prisma } from "../db";
import { decryptField, encryptField } from "../utils/fieldEncryption";
import { createCommandJob } from "./command.service";
import { resolveTargetAgentIds } from "./agentTargeting.service";

export class CommandTemplateNotFoundError extends Error {}
export class NoAgentsResolvedError extends Error {}

function withDecryptedScript<T extends { script: string }>(template: T): T {
  return { ...template, script: decryptField(template.script) };
}

export async function createTemplate(params: CreateCommandTemplateRequest & { createdByAdminId: string }) {
  const template = await prisma.commandTemplate.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      shell: params.shell,
      script: encryptField(params.script),
      createdByAdminId: params.createdByAdminId,
    },
  });
  return withDecryptedScript(template);
}

export async function updateTemplate(id: string, params: UpdateCommandTemplateRequest) {
  const existing = await prisma.commandTemplate.findUnique({ where: { id } });
  if (!existing) throw new CommandTemplateNotFoundError();

  const template = await prisma.commandTemplate.update({
    where: { id },
    data: {
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.shell !== undefined && { shell: params.shell }),
      ...(params.script !== undefined && { script: encryptField(params.script) }),
    },
  });
  return withDecryptedScript(template);
}

export async function deleteTemplate(id: string): Promise<void> {
  await prisma.commandTemplate.delete({ where: { id } });
}

export async function listTemplates() {
  const templates = await prisma.commandTemplate.findMany({ orderBy: { name: "asc" } });
  return templates.map(withDecryptedScript);
}

export async function getTemplate(id: string) {
  const template = await prisma.commandTemplate.findUnique({ where: { id } });
  return template ? withDecryptedScript(template) : null;
}

export async function dispatchTemplate(
  templateId: string,
  agentIds: string[],
  groupIds: string[],
  createdByAdminId: string,
): Promise<{ jobId: string }> {
  const template = await prisma.commandTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new CommandTemplateNotFoundError();

  const resolvedAgentIds = await resolveTargetAgentIds(agentIds, groupIds);
  if (resolvedAgentIds.length === 0) throw new NoAgentsResolvedError();

  return createCommandJob({
    agentIds: resolvedAgentIds,
    groupIds,
    shell: template.shell as Shell,
    script: decryptField(template.script),
    timeoutSec: DEFAULT_COMMAND_TIMEOUT_SEC,
    createdByAdminId,
  });
}
