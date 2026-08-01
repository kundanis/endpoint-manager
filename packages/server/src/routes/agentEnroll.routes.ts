import { Router } from "express";
import rateLimit from "express-rate-limit";
import { enrollRequestSchema } from "@em/shared";
import { enrollAgent, InvalidEnrollmentTokenError } from "../services/enrollment.service";
import { AgentCapExceededError, NotLicensedError } from "../services/licenseActivation.service";

export const agentEnrollRouter = Router();

const enrollRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

agentEnrollRouter.post("/", enrollRateLimiter, async (req, res, next) => {
  try {
    const payload = enrollRequestSchema.parse(req.body);
    const result = await enrollAgent(payload);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof InvalidEnrollmentTokenError) {
      return res.status(401).json({ error: err.message });
    }
    if (err instanceof NotLicensedError) {
      return res.status(403).json({ error: "This deployment is not licensed to enroll new agents" });
    }
    if (err instanceof AgentCapExceededError) {
      return res.status(403).json({ error: "This license's agent limit has been reached" });
    }
    next(err);
  }
});
