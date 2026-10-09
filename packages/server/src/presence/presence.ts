import { prisma } from "../db";
import { logger } from "../logger";

// In-memory agent presence: the last check-in time plus the small fields an agent reports on
// each check-in (ip, mac, agent version). Updated on every check-in INSTEAD of writing the
// Agent row each time - that write was pure churn (~one row write per agent per poll). The
// values are flushed to the DB periodically and overlaid on reads via effectiveLastCheckin(),
// so online/offline reflects instantly while the Agent table is written far less often.
//
// SCALING SEAM: this is a single-process map. For multiple server instances, presence must be
// shared (Redis) so every instance agrees on who is online. recordCheckin / getPresence /
// effectiveLastCheckin / flushPresence are the seam.
//
// On a server restart this map starts empty, so an agent reads as OFFLINE (from its possibly
// slightly-stale DB lastCheckinAt) only until its next check-in (<= one poll interval) - an
// acceptable, self-healing gap.

export interface Presence {
  lastSeen: Date;
  ipAddress: string | null;
  macAddress: string | null;
  agentVersion: string | null;
  dirty: boolean; // has unsaved changes to flush to the DB
}

// Hard ceiling, far above any real fleet: a backstop against pathological growth (e.g. a flush
// failing while re-enrollments keep minting new agent ids). Pruning against the real Agent
// table on each flush is the normal bound; this guarantees the map can never grow without
// limit even if that ever fails.
const MAX_ENTRIES = 50_000;
const FLUSH_INTERVAL_MS = 2 * 60 * 1000;

const presence = new Map<string, Presence>();

export function recordCheckin(
  agentId: string,
  fields: { ipAddress: string | null; macAddress: string | null; agentVersion: string | null },
): void {
  const prev = presence.get(agentId);
  if (!prev && presence.size >= MAX_ENTRIES) {
    logger.warn({ size: presence.size }, "Presence map at cap - not tracking a new agent in memory this cycle");
    return;
  }
  presence.set(agentId, {
    lastSeen: new Date(),
    ipAddress: fields.ipAddress ?? prev?.ipAddress ?? null,
    macAddress: fields.macAddress ?? prev?.macAddress ?? null,
    agentVersion: fields.agentVersion ?? prev?.agentVersion ?? null,
    dirty: true,
  });
}

export function getPresence(agentId: string): Presence | undefined {
  return presence.get(agentId);
}

// The freshest known check-in time: the in-memory value if the agent has checked in since
// startup, otherwise whatever was loaded from the DB.
export function effectiveLastCheckin(agentId: string, dbLastCheckinAt: Date | null): Date | null {
  return presence.get(agentId)?.lastSeen ?? dbLastCheckinAt;
}

let flushing = false;

export async function flushPresence(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const dirty = [...presence.entries()].filter(([, p]) => p.dirty);
    // Sequential, not a single transaction: a background flush should never hold a long
    // multi-row lock or spike the connection pool. 273 quick PK updates take well under a second.
    for (const [agentId, p] of dirty) {
      try {
        await prisma.agent.update({
          where: { id: agentId },
          data: {
            lastCheckinAt: p.lastSeen,
            ipAddress: p.ipAddress ?? undefined,
            macAddress: p.macAddress ?? undefined,
            agentVersion: p.agentVersion ?? undefined,
          },
        });
        p.dirty = false;
      } catch (err) {
        // P2025 = record not found: the agent was deleted/uninstalled - drop it from the map.
        if ((err as { code?: string }).code === "P2025") presence.delete(agentId);
        else logger.error({ err, agentId }, "Presence flush failed for agent");
      }
    }
    // Prune entries whose agent no longer exists - the normal bound on map size.
    if (presence.size > 0) {
      const existing = await prisma.agent.findMany({ select: { id: true } });
      const alive = new Set(existing.map((a) => a.id));
      for (const id of presence.keys()) if (!alive.has(id)) presence.delete(id);
    }
  } finally {
    flushing = false;
  }
}

export function startPresenceFlush(): void {
  const t = setInterval(() => void flushPresence(), FLUSH_INTERVAL_MS);
  t.unref();
}

// Test/diagnostics only.
export function presenceSize(): number {
  return presence.size;
}
