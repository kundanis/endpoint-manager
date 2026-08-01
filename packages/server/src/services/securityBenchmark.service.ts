import type {
  AssignBenchmarkRequest,
  CreateBenchmarkRequest,
  CreateRuleRequest,
  SecurityBenchmarkTargetType,
  SecurityRuleOperator,
  UpdateBenchmarkRequest,
  UpdateRuleRequest,
} from "@em/shared";
import { DEFAULT_COMMAND_TIMEOUT_SEC } from "@em/shared";
import { prisma } from "../db";
import { resolveTargetAgentIds } from "./agentTargeting.service";
import { createCommandJob } from "./command.service";

export class RuleHasNoRemediationError extends Error {}

async function resolveAssignedAgentIdsForBenchmark(benchmarkId: string): Promise<string[]> {
  const assignments = await prisma.securityBenchmarkAssignment.findMany({ where: { benchmarkId } });
  const agentIds = assignments.filter((a) => a.agentId).map((a) => a.agentId!);
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  return resolveTargetAgentIds(agentIds, groupIds);
}

export async function createBenchmark(params: CreateBenchmarkRequest, createdByAdminId: string) {
  const benchmark = await prisma.securityBenchmark.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      source: "CUSTOM",
      targetType: params.targetType,
      createdByAdminId,
    },
  });
  return getBenchmark(benchmark.id);
}

export async function listBenchmarks() {
  const benchmarks = await prisma.securityBenchmark.findMany({
    orderBy: { createdAt: "asc" },
    include: { rules: { select: { id: true } }, findings: { select: { status: true } } },
  });

  return Promise.all(
    benchmarks.map(async (b) => {
      const assignedAgentIds = await resolveAssignedAgentIdsForBenchmark(b.id);
      const passCount = b.findings.filter((f) => f.status === "PASS").length;
      const gradedCount = b.findings.filter((f) => f.status === "PASS" || f.status === "FAIL").length;
      return {
        id: b.id,
        name: b.name,
        description: b.description,
        source: b.source as "BUILT_IN" | "CUSTOM",
        targetType: b.targetType as SecurityBenchmarkTargetType,
        ruleCount: b.rules.length,
        assignedAgentCount: assignedAgentIds.length,
        compliancePercent: gradedCount > 0 ? Math.round((passCount / gradedCount) * 100) : null,
        createdAt: b.createdAt.toISOString(),
      };
    }),
  );
}

export async function getBenchmark(id: string) {
  const benchmark = await prisma.securityBenchmark.findUnique({
    where: { id },
    include: { rules: { orderBy: { ruleKey: "asc" } } },
  });
  if (!benchmark) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForBenchmark(id);
  const findings = await prisma.securityBenchmarkFinding.findMany({ where: { benchmarkId: id } });
  const findingsByRule = new Map<string, { pass: number; fail: number; error: number }>();
  for (const f of findings) {
    const bucket = findingsByRule.get(f.ruleId) ?? { pass: 0, fail: 0, error: 0 };
    if (f.status === "PASS") bucket.pass++;
    else if (f.status === "ERROR") bucket.error++;
    else bucket.fail++;
    findingsByRule.set(f.ruleId, bucket);
  }

  return {
    id: benchmark.id,
    name: benchmark.name,
    description: benchmark.description,
    source: benchmark.source as "BUILT_IN" | "CUSTOM",
    targetType: benchmark.targetType as SecurityBenchmarkTargetType,
    assignedAgentCount: assignedAgentIds.length,
    createdAt: benchmark.createdAt.toISOString(),
    rules: benchmark.rules.map((r) => {
      const bucket = findingsByRule.get(r.id);
      return {
        id: r.id,
        ruleKey: r.ruleKey,
        title: r.title,
        description: r.description,
        severity: r.severity as "HIGH" | "MEDIUM" | "LOW",
        checkPowerShell: r.checkPowerShell,
        operator: r.operator as SecurityRuleOperator,
        expectedValue: r.expectedValue,
        remediationPowerShell: r.remediationPowerShell,
        passCount: bucket?.pass ?? 0,
        failCount: bucket?.fail ?? 0,
        errorCount: bucket?.error ?? 0,
      };
    }),
  };
}

export async function updateBenchmark(id: string, params: UpdateBenchmarkRequest) {
  await prisma.securityBenchmark.update({
    where: { id },
    data: { name: params.name, description: params.description, targetType: params.targetType },
  });
  return getBenchmark(id);
}

export async function deleteBenchmark(id: string): Promise<boolean> {
  try {
    await prisma.securityBenchmark.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function addRule(benchmarkId: string, params: CreateRuleRequest) {
  await prisma.securityBenchmarkRule.create({
    data: {
      benchmarkId,
      ruleKey: params.ruleKey,
      title: params.title,
      description: params.description ?? null,
      severity: params.severity,
      checkPowerShell: params.checkPowerShell,
      operator: params.operator,
      expectedValue: params.expectedValue,
      remediationPowerShell: params.remediationPowerShell ?? null,
    },
  });
  return getBenchmark(benchmarkId);
}

export async function updateRule(benchmarkId: string, ruleId: string, params: UpdateRuleRequest) {
  await prisma.securityBenchmarkRule.update({
    where: { id: ruleId },
    data: {
      ruleKey: params.ruleKey,
      title: params.title,
      description: params.description,
      severity: params.severity,
      checkPowerShell: params.checkPowerShell,
      operator: params.operator,
      expectedValue: params.expectedValue,
      remediationPowerShell: params.remediationPowerShell,
    },
  });
  return getBenchmark(benchmarkId);
}

export async function deleteRule(benchmarkId: string, ruleId: string): Promise<boolean> {
  const result = await prisma.securityBenchmarkRule.deleteMany({ where: { id: ruleId, benchmarkId } });
  return result.count > 0;
}

export async function importRules(benchmarkId: string, rules: CreateRuleRequest[]) {
  await prisma.securityBenchmarkRule.createMany({
    data: rules.map((r) => ({
      benchmarkId,
      ruleKey: r.ruleKey,
      title: r.title,
      description: r.description ?? null,
      severity: r.severity,
      checkPowerShell: r.checkPowerShell,
      operator: r.operator,
      expectedValue: r.expectedValue,
      remediationPowerShell: r.remediationPowerShell ?? null,
    })),
  });
  return getBenchmark(benchmarkId);
}

export async function assignBenchmark(benchmarkId: string, params: AssignBenchmarkRequest) {
  await prisma.securityBenchmarkAssignment.createMany({
    data: [
      ...params.agentIds.map((agentId) => ({ benchmarkId, agentId })),
      ...params.groupIds.map((groupId) => ({ benchmarkId, groupId })),
    ],
  });
  return getBenchmark(benchmarkId);
}

export async function listAssignments(benchmarkId: string) {
  const assignments = await prisma.securityBenchmarkAssignment.findMany({
    where: { benchmarkId },
    include: { agent: true, group: true },
  });
  return assignments.map((a) => ({
    id: a.id,
    agentId: a.agentId,
    hostname: a.agent?.hostname ?? null,
    groupId: a.groupId,
    groupName: a.group?.name ?? null,
  }));
}

export async function unassign(benchmarkId: string, assignmentId: string): Promise<boolean> {
  const result = await prisma.securityBenchmarkAssignment.deleteMany({ where: { id: assignmentId, benchmarkId } });
  return result.count > 0;
}

export async function getBenchmarkAgentBreakdown(benchmarkId: string) {
  const benchmark = await prisma.securityBenchmark.findUnique({ where: { id: benchmarkId } });
  if (!benchmark) return null;

  const assignedAgentIds = await resolveAssignedAgentIdsForBenchmark(benchmarkId);
  const agents = assignedAgentIds.length > 0 ? await prisma.agent.findMany({ where: { id: { in: assignedAgentIds } } }) : [];
  const findings = await prisma.securityBenchmarkFinding.findMany({ where: { benchmarkId } });

  const findingsByAgent = new Map<string, typeof findings>();
  for (const f of findings) {
    const list = findingsByAgent.get(f.agentId) ?? [];
    list.push(f);
    findingsByAgent.set(f.agentId, list);
  }

  return {
    benchmarkId,
    name: benchmark.name,
    agents: agents.map((a) => {
      const agentFindings = findingsByAgent.get(a.id) ?? [];
      return {
        agentId: a.id,
        hostname: a.hostname,
        scanned: agentFindings.length > 0,
        passCount: agentFindings.filter((f) => f.status === "PASS").length,
        failCount: agentFindings.filter((f) => f.status === "FAIL").length,
        errorCount: agentFindings.filter((f) => f.status === "ERROR").length,
      };
    }),
  };
}

export async function getFindingsForAgent(agentId: string) {
  const findings = await prisma.securityBenchmarkFinding.findMany({
    where: { agentId },
    include: { rule: true, benchmark: true },
    orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
  });

  return findings.map((f) => ({
    id: f.id,
    benchmarkId: f.benchmarkId,
    benchmarkName: f.benchmark.name,
    ruleId: f.ruleId,
    ruleKey: f.rule.ruleKey,
    title: f.rule.title,
    severity: f.rule.severity as "HIGH" | "MEDIUM" | "LOW",
    expectedValue: f.rule.expectedValue,
    actualValue: f.actualValue,
    status: f.status as "PASS" | "FAIL" | "ERROR",
    hasRemediation: Boolean(f.rule.remediationPowerShell),
    lastSeenAt: f.lastSeenAt.toISOString(),
  }));
}

export async function remediateRule(ruleId: string, agentId: string, createdByAdminId: string) {
  const rule = await prisma.securityBenchmarkRule.findUnique({ where: { id: ruleId } });
  if (!rule) return null;
  if (!rule.remediationPowerShell) throw new RuleHasNoRemediationError("Rule has no remediation script");

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  return createCommandJob({
    agentIds: [agentId],
    groupIds: [],
    shell: "powershell",
    script: rule.remediationPowerShell,
    timeoutSec: DEFAULT_COMMAND_TIMEOUT_SEC,
    createdByAdminId,
  });
}

// One CommandJob per distinct rule (each has its own script) rather than one merged
// script — keeps the existing per-CommandTask status/stdout/stderr result model
// meaningful instead of collapsing several independent remediations into one opaque
// pass/fail.
export async function remediateAllForAgent(agentId: string, createdByAdminId: string) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  const findings = await prisma.securityBenchmarkFinding.findMany({
    where: { agentId, status: "FAIL" },
    include: { rule: true },
  });
  const remediable = findings.filter((f) => f.rule.remediationPowerShell);

  const jobIds: string[] = [];
  for (const f of remediable) {
    const { jobId } = await createCommandJob({
      agentIds: [agentId],
      groupIds: [],
      shell: "powershell",
      script: f.rule.remediationPowerShell!,
      timeoutSec: DEFAULT_COMMAND_TIMEOUT_SEC,
      createdByAdminId,
    });
    jobIds.push(jobId);
  }

  return { jobIds, remediatedCount: remediable.length, skippedCount: findings.length - remediable.length };
}

// Same one-job-per-rule reasoning as remediateAllForAgent, but scoped to a single
// benchmark's findings — lives on the "Compliance by endpoint" panel, so it should
// only touch rules belonging to the benchmark being viewed, not every benchmark
// assigned to the agent.
export async function remediateAllForAgentInBenchmark(benchmarkId: string, agentId: string, createdByAdminId: string) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  const findings = await prisma.securityBenchmarkFinding.findMany({
    where: { benchmarkId, agentId, status: "FAIL" },
    include: { rule: true },
  });
  const remediable = findings.filter((f) => f.rule.remediationPowerShell);

  const jobIds: string[] = [];
  for (const f of remediable) {
    const { jobId } = await createCommandJob({
      agentIds: [agentId],
      groupIds: [],
      shell: "powershell",
      script: f.rule.remediationPowerShell!,
      timeoutSec: DEFAULT_COMMAND_TIMEOUT_SEC,
      createdByAdminId,
    });
    jobIds.push(jobId);
  }

  return { jobIds, remediatedCount: remediable.length, skippedCount: findings.length - remediable.length };
}
