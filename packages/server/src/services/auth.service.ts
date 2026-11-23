import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { AdminRole } from "@em/shared";
import { prisma } from "../db";
import { signAdminJwt } from "../utils/jwt";
import { createSession, SESSION_IDLE_MS } from "./adminSession.service";

export class InvalidCredentialsError extends Error {}

// Refused because someone else with the same rights is already signed in.
export class SeatTakenError extends Error {
  constructor(
    readonly holderEmail: string,
    readonly superAdmin: boolean,
  ) {
    super("Another admin with the same rights is signed in");
  }
}

// One person per role at a time: only one super admin may be signed in, and only one admin
// with exactly the same modules. "Signed in" means a session that hasn't been ended, is under
// its 12 hours and was used in the last 30 minutes (an open console tab keeps it in use).
// The same account signing in again (another browser) is allowed.
async function sameRightsHolder(admin: { id: string; role: string }): Promise<string | null> {
  const now = Date.now();
  const live = await prisma.adminSession.findMany({
    where: {
      adminId: { not: admin.id },
      revokedAt: null,
      expiresAt: { gt: new Date(now) },
      lastSeenAt: { gt: new Date(now - SESSION_IDLE_MS) },
      admin: { role: admin.role },
    },
    select: { admin: { select: { id: true, email: true, moduleGrants: { select: { moduleKey: true } } } } },
  });
  if (live.length === 0) return null;
  if (admin.role === "SUPER_ADMIN") return live[0].admin.email;

  const key = (keys: string[]) => [...new Set(keys)].sort().join(",");
  const mine = key((await prisma.adminModuleGrant.findMany({ where: { adminUserId: admin.id }, select: { moduleKey: true } })).map((g) => g.moduleKey));
  const other = live.find((s) => key(s.admin.moduleGrants.map((g) => g.moduleKey)) === mine);
  return other ? other.admin.email : null;
}

// Hash of a random value nobody knows, same cost as real admin hashes (bcrypt.hash(..., 10)
// in seed/admin-users). Comparing against it when the email doesn't exist makes a wrong
// email take as long as a wrong password, so response time doesn't reveal which emails are
// admin accounts. Made on first use so importing this module stays cheap.
let dummyHash: string | undefined;
function dummyPasswordHash(): string {
  dummyHash ??= bcrypt.hashSync(randomBytes(16).toString("hex"), 10);
  return dummyHash;
}

export async function login(email: string, password: string, ipAddress?: string): Promise<{ token: string; role: AdminRole }> {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) {
    await bcrypt.compare(password, dummyPasswordHash());
    throw new InvalidCredentialsError();
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) throw new InvalidCredentialsError();

  const holder = await sameRightsHolder(admin);
  if (holder) throw new SeatTakenError(holder, admin.role === "SUPER_ADMIN");

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const sid = await createSession(admin.id, ipAddress);
  const token = signAdminJwt({ sub: admin.id, email: admin.email, sid });
  return { token, role: admin.role as AdminRole };
}

// Per-account lockout after repeated failed sign-ins (used by auth.routes.ts). In memory,
// bounded: when it grows past maxEntries it drops entries that no longer matter (lock over
// and no failure for a lockout period) first, then the oldest unlocked ones, and only as a
// last resort the oldest locked ones - never the whole table, which would let a spray of
// made-up emails unlock a real account that is being guessed.
export class LoginLockout {
  private readonly entries = new Map<string, { count: number; lockedUntil: number; lastFailureAt: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly lockoutMs = 15 * 60 * 1000,
    private readonly maxEntries = 10_000,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  lockedUntil(key: string, now = Date.now()): number {
    const entry = this.entries.get(key);
    return entry && entry.lockedUntil > now ? entry.lockedUntil : 0;
  }

  // Returns true when this failure locked the account.
  recordFailure(key: string, now = Date.now()): boolean {
    const entry = this.entries.get(key) ?? { count: 0, lockedUntil: 0, lastFailureAt: 0 };
    entry.count += 1;
    entry.lastFailureAt = now;
    let locked = false;
    if (entry.count >= this.maxFailures) {
      entry.lockedUntil = now + this.lockoutMs;
      entry.count = 0;
      locked = true;
    }
    // Re-insert so Map order is least-recently-failed first (eviction order below).
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.prune(now);
    return locked;
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    if (this.entries.size <= this.maxEntries) return;
    for (const [key, e] of this.entries) {
      if (e.lockedUntil <= now && now - e.lastFailureAt > this.lockoutMs) this.entries.delete(key);
    }
    for (const [key, e] of this.entries) {
      if (this.entries.size <= this.maxEntries) return;
      if (e.lockedUntil <= now) this.entries.delete(key);
    }
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) return;
      this.entries.delete(key);
    }
  }
}
