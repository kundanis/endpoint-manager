import type { AssignedBenchmarkWire, SecurityConfigScanResultPayload, SecurityRuleOperator } from "@em/shared";
import { prisma } from "../db";
import { evaluateRule } from "./securityConfigEvaluate.util";
import { isAgentPaused } from "./pause.service";

export async function resolveAssignedBenchmarksForAgent(agentId: string): Promise<AssignedBenchmarkWire[]> {
  if (await isAgentPaused(agentId)) return [];

  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);

  const assignments = await prisma.securityBenchmarkAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { benchmarkId: true },
  });
  const benchmarkIds = [...new Set(assignments.map((a) => a.benchmarkId))];
  if (benchmarkIds.length === 0) return [];

  const benchmarks = await prisma.securityBenchmark.findMany({
    where: { id: { in: benchmarkIds } },
    include: { rules: true },
  });

  return benchmarks.map((b) => ({
    benchmarkId: b.id,
    rules: b.rules.map((r) => ({ ruleId: r.id, checkPowerShell: r.checkPowerShell })),
  }));
}

// Grading (operator + expectedValue against actualValue) happens here, server-side,
// rather than on the agent — so editing a rule's expected value takes effect on the
// next scan without needing to change what the agent runs. See evaluateRule.
export async function recordScanResult(agentId: string, payload: SecurityConfigScanResultPayload): Promise<void> {
  const rules = await prisma.securityBenchmarkRule.findMany({
    where: { id: { in: payload.results.map((r) => r.ruleId) } },
  });
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  for (const result of payload.results) {
    const rule = ruleById.get(result.ruleId);
    if (!rule) continue; // rule deleted/benchmark changed out from under an in-flight scan

    const status = result.error
      ? "ERROR"
      : evaluateRule(rule.operator as SecurityRuleOperator, rule.expectedValue, result.actualValue);

    await prisma.securityBenchmarkFinding.upsert({
      where: { agentId_ruleId: { agentId, ruleId: result.ruleId } },
      create: { agentId, benchmarkId: payload.benchmarkId, ruleId: result.ruleId, actualValue: result.actualValue, status },
      update: { actualValue: result.actualValue, status, lastSeenAt: new Date() },
    });
  }
}
