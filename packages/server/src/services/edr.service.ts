import type { EdrScanResultPayload } from "@em/shared";
import { prisma } from "../db";

export interface EdrEventView {
  id: string;
  agentId: string;
  hostname: string;
  category: string;
  ruleKey: string | null;
  severity: string;
  summary: string;
  detail: Record<string, unknown>;
  killed: boolean;
  detectedAt: string;
}

export interface EdrAgentSummaryView {
  agentId: string;
  hostname: string;
  edrEnabled: boolean;
  quarantined: boolean;
  eventCount: number;
  lastDetectedAt: string | null;
}

export async function isEnabledForAgent(agentId: string): Promise<boolean> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { edrEnabled: true } });
  return agent?.edrEnabled ?? true;
}

export async function setEnabled(agentId: string, enabled: boolean): Promise<void> {
  await prisma.agent.update({ where: { id: agentId }, data: { edrEnabled: enabled } });
}

// Persistence items are diffed against a server-held baseline (agent reports its full
// current snapshot every scan, never a self-tracked delta) — a machine's pre-existing
// startup items are seeded silently on the first-ever scan for that agent; only entries
// appearing in a LATER scan are flagged as new. See schema.prisma's EdrPersistenceBaseline.
export async function recordScanResult(agentId: string, payload: EdrScanResultPayload): Promise<void> {
  const detectedAt = new Date(payload.scannedAt);

  for (const d of payload.detections) {
    await prisma.edrEvent.create({
      data: {
        agentId,
        category: "PROCESS",
        ruleKey: d.ruleKey,
        severity: d.severity,
        summary: d.ruleLabel,
        detail: JSON.stringify({
          processName: d.processName,
          processId: d.processId,
          parentProcessName: d.parentProcessName,
          parentProcessId: d.parentProcessId,
          commandLine: d.commandLine,
        }),
        killed: d.killed,
        detectedAt,
      },
    });
  }

  const existing = await prisma.edrPersistenceBaseline.findMany({
    where: { agentId },
    select: { location: true, name: true },
  });
  const seenKeys = new Set(existing.map((e) => `${e.location}|${e.name}`));
  const isFirstScan = existing.length === 0;

  for (const item of payload.persistenceSnapshot) {
    const key = `${item.location}|${item.name}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key); // guards against the same name appearing twice within one payload

    await prisma.edrPersistenceBaseline.create({
      data: { agentId, location: item.location, name: item.name },
    });

    if (isFirstScan) continue;

    await prisma.edrEvent.create({
      data: {
        agentId,
        category: "PERSISTENCE",
        ruleKey: null,
        severity: "MEDIUM",
        summary: `New persistence entry: ${item.name}`,
        detail: JSON.stringify({ location: item.location, name: item.name, command: item.command }),
        killed: false,
        detectedAt,
      },
    });
  }
}

export async function listAgentsSummary(): Promise<EdrAgentSummaryView[]> {
  const agents = await prisma.agent.findMany({ select: { id: true, hostname: true, edrEnabled: true, quarantined: true } });
  const events = await prisma.edrEvent.findMany({ select: { agentId: true, detectedAt: true } });

  const countByAgent = new Map<string, number>();
  const lastByAgent = new Map<string, Date>();
  for (const e of events) {
    countByAgent.set(e.agentId, (countByAgent.get(e.agentId) ?? 0) + 1);
    const prev = lastByAgent.get(e.agentId);
    if (!prev || e.detectedAt > prev) lastByAgent.set(e.agentId, e.detectedAt);
  }

  return agents.map((a) => ({
    agentId: a.id,
    hostname: a.hostname,
    edrEnabled: a.edrEnabled,
    quarantined: a.quarantined,
    eventCount: countByAgent.get(a.id) ?? 0,
    lastDetectedAt: lastByAgent.get(a.id)?.toISOString() ?? null,
  }));
}

export async function listEvents(agentId?: string): Promise<EdrEventView[]> {
  const events = await prisma.edrEvent.findMany({
    where: agentId ? { agentId } : undefined,
    include: { agent: { select: { hostname: true } } },
    orderBy: { detectedAt: "desc" },
    take: 300,
  });

  return events.map((e) => ({
    id: e.id,
    agentId: e.agentId,
    hostname: e.agent.hostname,
    category: e.category,
    ruleKey: e.ruleKey,
    severity: e.severity,
    summary: e.summary,
    detail: JSON.parse(e.detail) as Record<string, unknown>,
    killed: e.killed,
    detectedAt: e.detectedAt.toISOString(),
  }));
}
