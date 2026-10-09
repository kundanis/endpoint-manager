import { Router } from "express";
import rateLimit from "express-rate-limit";
import { loginRequestSchema } from "@em/shared";
import { InvalidCredentialsError, login } from "../services/auth.service";
import { adminAuthMiddleware } from "../middleware/adminAuth";
import { logger } from "../logger";

export const authRouter = Router();

const COOKIE_NAME = "em_admin_jwt";
const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// Brute-force protection — this one login can dispatch commands that run as SYSTEM on
// every endpoint. Two layers: a per-address cap (stops one source spraying many accounts)
// and a per-account lockout (stops a distributed guess against one account). The lockout
// is keyed on the submitted email whether or not that account exists, so a locked
// response never confirms which emails are real. Kept in memory: a server restart clears
// it, which is acceptable for a guessing-rate defence.
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts from this address. Try again in 15 minutes." },
});

const MAX_CONSECUTIVE_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failuresByEmail = new Map<string, { count: number; lockedUntil: number }>();

function lockedUntil(email: string): number {
  const entry = failuresByEmail.get(email);
  return entry && entry.lockedUntil > Date.now() ? entry.lockedUntil : 0;
}

function recordFailure(email: string): void {
  const entry = failuresByEmail.get(email) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_CONSECUTIVE_FAILURES) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
    logger.warn({ email }, "Admin login locked after repeated failed attempts");
  }
  failuresByEmail.set(email, entry);
  if (failuresByEmail.size > 10_000) failuresByEmail.clear(); // bound memory under a spray
}

authRouter.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginRequestSchema.parse(req.body);
    const key = email.trim().toLowerCase();

    const until = lockedUntil(key);
    if (until) {
      const minutes = Math.ceil((until - Date.now()) / 60_000);
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${minutes} minute(s).` });
    }

    let result;
    try {
      result = await login(email, password);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        recordFailure(key);
        return res.status(401).json({ error: "Invalid email or password" });
      }
      throw err;
    }
    failuresByEmail.delete(key);

    res.cookie(COOKIE_NAME, result.token, {
      httpOnly: true,
      sameSite: "lax",
      // Marked Secure whenever the login itself came over HTTPS, so that session cookie is
      // never sent back over the plain-HTTP port. Not unconditional: internal admins still
      // reach the console over http://<server>:4000 until internal DNS for
      // epp.systematixgroup.in exists, and a Secure cookie would silently fail to set there.
      secure: req.secure,
      maxAge: COOKIE_MAX_AGE_MS,
    });
    res.json({ user: { email, role: result.role } });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.status(204).send();
});

authRouter.get("/me", adminAuthMiddleware, async (req, res) => {
  // adminAuthMiddleware already fetched role/moduleGrants fresh from the DB for this exact
  // request - no need to query AdminUser a second time here.
  res.json({
    id: req.adminId,
    email: req.adminEmail,
    role: req.adminRole,
    moduleGrants: req.adminModuleGrantKeys,
  });
});
