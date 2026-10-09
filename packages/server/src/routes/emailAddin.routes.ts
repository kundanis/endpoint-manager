import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { piiEmailBlockEventReportSchema } from "@em/shared";
import { getPatternKeysForEmail, recordEvent } from "../services/piiEmailBlockPolicy.service";

// Reachable from inside the Outlook add-in's sandboxed JS runtime, which cannot hold this
// app's own admin session cookie or an agent API key — see the PiiEmailBlockPolicy model
// comment for why this pair of endpoints is deliberately unauthenticated. Rate-limited the
// same way agentEnroll.routes.ts limits its own public endpoint, since anyone who can reach
// this server can call these too, not just a real Outlook client.
export const emailAddinRouter = Router();

const emailAddinRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const policyQuerySchema = z.object({ email: z.string().trim().toLowerCase().email() });

emailAddinRouter.get("/policy", emailAddinRateLimiter, async (req, res, next) => {
  try {
    const { email } = policyQuerySchema.parse(req.query);
    const patternKeys = await getPatternKeysForEmail(email);
    res.json({ patternKeys });
  } catch (err) {
    next(err);
  }
});

emailAddinRouter.post("/event", emailAddinRateLimiter, async (req, res, next) => {
  try {
    const payload = piiEmailBlockEventReportSchema.parse(req.body);
    await recordEvent(payload);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
