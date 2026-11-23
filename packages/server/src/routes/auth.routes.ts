import { Router } from "express";
import rateLimit from "express-rate-limit";
import { loginRequestSchema } from "@em/shared";
import { InvalidCredentialsError, login, LoginLockout, SeatTakenError } from "../services/auth.service";
import { adminAuthMiddleware } from "../middleware/adminAuth";
import { verifyAdminJwt } from "../utils/jwt";
import { revokeSession } from "../services/adminSession.service";
import { logger } from "../logger";
import { config } from "../config";
import { writeAudit } from "../services/adminAudit.service";

export const authRouter = Router();

function auditSignIn(
  req: import("express").Request,
  email: string,
  action: "LOGIN" | "LOGIN_FAILED" | "LOGIN_BLOCKED" | "LOGIN_REFUSED",
  summary: string,
  adminId: string | null = null,
) {
  void writeAudit({
    adminId,
    adminEmail: email,
    ipAddress: req.ip,
    category: "Sign-in",
    action,
    module: "Console",
    summary,
    method: "POST",
    path: "/api/auth/login",
    statusCode: action === "LOGIN" ? 200 : action === "LOGIN_BLOCKED" ? 429 : action === "LOGIN_REFUSED" ? 409 : 401,
    success: action === "LOGIN",
  });
}

const COOKIE_NAME = "em_admin_jwt";
const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function cookieSecure(req: import("express").Request): boolean {
  return req.secure || config.tlsEnabled;
}

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

const lockout = new LoginLockout();

authRouter.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginRequestSchema.parse(req.body);
    const key = email.trim().toLowerCase();

    const until = lockout.lockedUntil(key);
    if (until) {
      const minutes = Math.ceil((until - Date.now()) / 60_000);
      auditSignIn(req, key, "LOGIN_BLOCKED", "Sign-in blocked: too many failed attempts");
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${minutes} minute(s).` });
    }

    let result;
    try {
      result = await login(email, password, req.ip);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        if (lockout.recordFailure(key)) logger.warn({ email: key }, "Admin login locked after repeated failed attempts");
        auditSignIn(req, key, "LOGIN_FAILED", "Failed sign-in (wrong email or password)");
        return res.status(401).json({ error: "Invalid email or password" });
      }
      if (err instanceof SeatTakenError) {
        // The password was right, so this isn't counted as a failed attempt.
        const who = err.superAdmin ? "Another super admin" : "Another admin with the same access";
        // The other admin's email goes to the audit log (super admins only), never into the
        // response: this endpoint is unauthenticated until it succeeds.
        auditSignIn(req, key, "LOGIN_REFUSED", `Sign-in refused: ${err.holderEmail} (same rights) is signed in`);
        return res.status(409).json({
          error: `${who} is signed in. Only one person with the same rights can use the console at a time. Try again after they sign out, or 30 minutes after they stop using it.`,
        });
      }
      throw err;
    }
    lockout.clear(key);
    auditSignIn(req, key, "LOGIN", "Signed in to the console");

    res.cookie(COOKIE_NAME, result.token, {
      httpOnly: true,
      sameSite: "lax",
      // Always Secure once the server has HTTPS (the plain-HTTP port then only serves agents
      // and redirects browsers - see plainHttpListener.ts), and whenever the login itself came
      // over HTTPS. Without a certificate the console is HTTP-only and a Secure cookie would
      // silently fail to set.
      secure: cookieSecure(req),
      maxAge: COOKIE_MAX_AGE_MS,
    });
    res.json({ user: { email, role: result.role } });
  } catch (err) {
    next(err);
  }
});

// Ends the session on the server too, so the cookie can't be reused after signing out.
authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      try {
        const { sid } = verifyAdminJwt(token);
        if (sid) await revokeSession(sid);
      } catch {
        // an expired or invalid token has no live session to end
      }
    }
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: cookieSecure(req) });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
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
