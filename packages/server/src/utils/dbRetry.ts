import { Prisma } from "@prisma/client";

// P2034 is Prisma's own designation for "the database reported a write conflict or
// deadlock, safe to retry" (SQL Server error 1205 - a deadlock victim - surfaces this way).
// A deadlock is inherently transient: whichever transaction SQL Server picked as the victim
// gets rolled back, releasing its locks, so simply retrying almost always succeeds once the
// other side has moved on.
//
// First needed for real when vulnerability.service.ts's sync (repeated delete+recreate of
// VulnerabilityCpeMatch rows, one CVE at a time) collided with vulnerabilityMatch.service.ts's
// concurrent reads/writes against the same tables (triggered by every agent's periodic
// inventory checkin) - without a retry, one unlucky collision failed an entire
// multi-thousand-CVE sync run rather than just the one CVE involved.
// P2024 ("timed out fetching a new connection from the connection pool") is transient the
// same way: every pooled connection was busy for pool_timeout, e.g. a fleet-wide checkin
// burst during a long vulnerability sync. Waiting and retrying beats failing the operation.
export function isDeadlockError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2024");
}

export async function withDeadlockRetry<T>(fn: () => Promise<T>, maxAttempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isDeadlockError(err) || attempt >= maxAttempts) throw err;
      // Exponential backoff (100ms doubling, capped at 2s - ~7s total across 8 attempts)
      // so a burst of contention, e.g. every agent checking in at once after a server
      // restart, has time to drain; random jitter so two transactions that just collided
      // don't collide again in lockstep on their next attempt.
      const delayMs = Math.min(2000, 100 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
