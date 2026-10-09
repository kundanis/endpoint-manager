import { prisma } from "../db";

// Batch helper for every compliance-verdict aggregation this override needs to affect
// (zeroTrustNonCompliantCount, compliancePercent, per-agent pass/fail/trusted) — one query
// per caller instead of N+1 per-agent lookups, same convention as this codebase's other
// fleet-wide count computations.
export async function getOverriddenKeysByAgent(agentIds: string[]): Promise<Map<string, Set<string>>> {
  if (agentIds.length === 0) return new Map();
  const overrides = await prisma.zeroTrustCheckOverride.findMany({
    where: { agentId: { in: agentIds } },
    select: { agentId: true, conditionKey: true },
  });
  const byAgent = new Map<string, Set<string>>();
  for (const o of overrides) {
    const set = byAgent.get(o.agentId) ?? new Set<string>();
    set.add(o.conditionKey);
    byAgent.set(o.agentId, set);
  }
  return byAgent;
}

// Powers the checkbox list in the console's Policy check override panel — every
// conditionKey currently defined anywhere (across all policies, not just "Baseline Device
// Trust"), so a newly authored custom condition becomes overridable immediately with no
// separate registration step. Only enabled conditions: a disabled one produces no findings
// and can't be "currently failing" in the first place.
export async function listOverridableConditionKeys(): Promise<{ conditionKey: string; title: string }[]> {
  const conditions = await prisma.zeroTrustCondition.findMany({
    where: { enabled: true },
    select: { conditionKey: true, title: true },
    orderBy: { conditionKey: "asc" },
  });
  const byKey = new Map<string, string>();
  for (const c of conditions) {
    // Same conditionKey can legitimately appear in more than one policy (e.g. an agent
    // assigned to two different baselines that both check firewall status) - first title
    // seen wins, purely a display label, doesn't affect override semantics either way.
    if (!byKey.has(c.conditionKey)) byKey.set(c.conditionKey, c.title);
  }
  return [...byKey.entries()].map(([conditionKey, title]) => ({ conditionKey, title }));
}

// Only actually creates an override row for an (agent, conditionKey) pair that is
// CURRENTLY FAILING - selecting a device/check combination that's already passing (or has
// never been scanned) is a silent no-op, never creates a "dead" override sitting around for
// something that was never wrong. Returns how many pairs were actually touched so the
// console can tell the admin "3 of your 5 selections were already fine."
export async function applyForceComply(
  agentIds: string[],
  conditionKeys: string[],
  appliedByAdminId: string,
): Promise<{ appliedCount: number }> {
  const failingFindings = await prisma.zeroTrustFinding.findMany({
    where: {
      agentId: { in: agentIds },
      status: "FAIL",
      condition: { conditionKey: { in: conditionKeys }, enabled: true },
    },
    select: { agentId: true, condition: { select: { conditionKey: true } } },
  });

  // Dedup: the same (agentId, conditionKey) pair can appear more than once if an agent is
  // assigned to multiple policies that each define a condition under that same key.
  const pairs = new Map<string, { agentId: string; conditionKey: string }>();
  for (const f of failingFindings) {
    const key = `${f.agentId}:${f.condition.conditionKey}`;
    pairs.set(key, { agentId: f.agentId, conditionKey: f.condition.conditionKey });
  }

  for (const pair of pairs.values()) {
    await prisma.zeroTrustCheckOverride.upsert({
      where: { agentId_conditionKey: pair },
      create: { ...pair, appliedByAdminId },
      // Re-applying just refreshes who/when — the override was already active either way.
      update: { appliedByAdminId, appliedAt: new Date() },
    });
  }

  return { appliedCount: pairs.size };
}

// Pure filter, reused at every compliance-verdict aggregation site (admin.routes.ts's
// zeroTrustNonCompliantCount x2, and listPolicies/getPolicy/getPolicyAgentBreakdown below) -
// drops any FAIL finding that has an active override for its own conditionKey on that same
// agent. Never touches PASS/ERROR findings: an override only ever suppresses a failure,
// it can't manufacture a pass for a condition that was never actually checked.
export function excludeOverriddenFailures<T extends { agentId: string; status: string; conditionKey: string }>(
  findings: T[],
  overriddenByAgent: Map<string, Set<string>>,
): T[] {
  return findings.filter((f) => {
    if (f.status !== "FAIL") return true;
    return !overriddenByAgent.get(f.agentId)?.has(f.conditionKey);
  });
}

// Safe to call for every selected device even where nothing is actually overridden yet -
// deleteMany matching zero rows is a no-op, not an error. Returns the real count for the
// same "tell the admin what actually happened" reason as applyForceComply.
export async function revokeOverride(agentIds: string[], conditionKeys: string[]): Promise<{ revokedCount: number }> {
  const result = await prisma.zeroTrustCheckOverride.deleteMany({
    where: { agentId: { in: agentIds }, conditionKey: { in: conditionKeys } },
  });
  return { revokedCount: result.count };
}
