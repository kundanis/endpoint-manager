import { prisma } from "../db";

// Server-side console sessions (AdminSession). The session cookie's JWT carries the session id
// ("sid"); adminAuthMiddleware accepts a request only while that session is live. Ending a
// session here therefore makes a captured cookie useless straight away.
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000; // matches the cookie and JWT lifetime
export const SESSION_IDLE_MS = 30 * 60 * 1000;
const LAST_SEEN_WRITE_EVERY_MS = 60 * 1000;

export async function createSession(adminId: string, ipAddress: string | undefined): Promise<string> {
  // Housekeeping: rows that can no longer be used, kept a day for reference.
  await prisma.adminSession.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });

  const session = await prisma.adminSession.create({
    data: { adminId, ipAddress: ipAddress?.slice(0, 100) ?? null, expiresAt: new Date(Date.now() + SESSION_MAX_MS) },
  });
  return session.id;
}

// True while the session is live: not ended, not past 12 hours, used within the last 30 minutes.
export async function touchSession(sessionId: string, adminId: string): Promise<boolean> {
  const session = await prisma.adminSession.findUnique({ where: { id: sessionId } });
  const now = Date.now();
  if (
    !session ||
    session.adminId !== adminId ||
    session.revokedAt ||
    session.expiresAt.getTime() <= now ||
    now - session.lastSeenAt.getTime() > SESSION_IDLE_MS
  ) {
    return false;
  }
  if (now - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_EVERY_MS) {
    await prisma.adminSession.update({ where: { id: sessionId }, data: { lastSeenAt: new Date(now) } });
  }
  return true;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.adminSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}
