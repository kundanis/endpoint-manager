import { appControlRuleProblem } from "@em/shared";
import { prisma } from "../db";
import { annotateWithLicenseStatus } from "./softwareLicense.service";

// Endpoint -> Software tab: Block / Release for software with no licence recorded. A block is an
// ordinary Application control rule (PRODUCT, matched against the product name stored inside the
// program), kept in one policy per endpoint named "Unlicensed software: <hostname>" and assigned
// to that endpoint only. So the agent enforces it like any other rule (no agent change), blocked
// launches show in Application control's Activity and the alert bell, and the policy is visible
// on the Application control page. Releasing removes the rule; the last release removes the policy.

export const SOFTWARE_BLOCK_POLICY_PREFIX = "Unlicensed software: ";
const RULE_LABEL_PREFIX = "Unlicensed: ";

export class SoftwareBlockError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface SoftwareBlockView {
  ruleId: string;
  softwareName: string;
  productName: string;
  policyId: string;
  policyEnabled: boolean;
}

// Policies this feature manages for the endpoint: assigned to it directly, named with the prefix.
async function managedPolicies(agentId: string) {
  return prisma.appControlPolicy.findMany({
    where: { name: { startsWith: SOFTWARE_BLOCK_POLICY_PREFIX }, assignments: { some: { agentId } } },
    include: { rules: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function listSoftwareBlocks(agentId: string): Promise<SoftwareBlockView[]> {
  const policies = await managedPolicies(agentId);
  return policies.flatMap((p) =>
    p.rules
      .filter((r) => r.label?.startsWith(RULE_LABEL_PREFIX))
      .map((r) => ({
        ruleId: r.id,
        softwareName: r.label!.slice(RULE_LABEL_PREFIX.length),
        productName: r.value,
        policyId: p.id,
        policyEnabled: p.enabled,
      })),
  );
}

export async function blockSoftware(agentId: string, softwareName: string, productName: string, adminId: string): Promise<SoftwareBlockView[]> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { hostname: true, inventory: { select: { installedSoftware: true } } } });
  if (!agent) throw new SoftwareBlockError("Endpoint not found", 404);

  // Only software this endpoint reports, with no licence recorded, and not system software.
  const installed = agent.inventory ? (JSON.parse(agent.inventory.installedSoftware) as { name: string; version: string | null; publisher: string | null; installDate: string | null }[]) : [];
  const entry = installed.find((s) => s.name === softwareName);
  if (!entry) throw new SoftwareBlockError(`${softwareName} isn't in this endpoint's software list.`, 400);
  const [annotated] = await annotateWithLicenseStatus([entry]);
  if (annotated.protected) throw new SoftwareBlockError(`${softwareName} is system software and can't be blocked.`, 403);
  if (annotated.licenseStatus !== "NONE") throw new SoftwareBlockError(`${softwareName} has a licence recorded or needs none, so it can't be blocked here.`, 400);

  const product = productName.trim();
  const problem = appControlRuleProblem("PRODUCT", product);
  if (problem) throw new SoftwareBlockError(problem, 400);

  const existing = await managedPolicies(agentId);
  let policy = existing[0];
  if (!policy) {
    const created = await prisma.appControlPolicy.create({
      data: {
        name: `${SOFTWARE_BLOCK_POLICY_PREFIX}${agent.hostname}`.slice(0, 200),
        description: "Software blocked from this endpoint's Software tab because no licence is recorded. Release it there to remove a rule.",
        enabled: true,
        createdByAdminId: adminId,
        assignments: { create: { agentId } },
      },
      include: { rules: { orderBy: { createdAt: "asc" } } },
    });
    policy = created;
  } else if (!policy.enabled) {
    await prisma.appControlPolicy.update({ where: { id: policy.id }, data: { enabled: true } });
  }

  const label = `${RULE_LABEL_PREFIX}${softwareName}`.slice(0, 200);
  const already = existing.some((p) => p.rules.some((r) => r.label === label));
  if (!already) {
    await prisma.appControlRule.create({ data: { policyId: policy.id, ruleType: "PRODUCT", value: product, label } });
  }
  return listSoftwareBlocks(agentId);
}

export async function releaseSoftware(agentId: string, ruleId: string): Promise<SoftwareBlockView[]> {
  const policies = await managedPolicies(agentId);
  const policy = policies.find((p) => p.rules.some((r) => r.id === ruleId));
  if (!policy) throw new SoftwareBlockError("That block wasn't found on this endpoint.", 404);

  await prisma.appControlRule.delete({ where: { id: ruleId } });
  if (policy.rules.length === 1) await prisma.appControlPolicy.delete({ where: { id: policy.id } });
  return listSoftwareBlocks(agentId);
}
