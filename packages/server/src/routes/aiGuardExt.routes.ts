import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { extensionPolicyFor, recordPromptEvent, verifyBrowserGuardEndpoint } from "../services/aiGuardPrompt.service";

// Called by the Endpoint IQ Browser Guard extension (AI Guard prompt protection), not by admins or
// agents: public and cross-origin like /api/email-addin, authenticated by the endpoint id + key
// the agent wrote into the extension's browser policy (see aiGuardPrompt.service.ts).
export const aiGuardExtRouter = Router();

const limiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
aiGuardExtRouter.use(limiter);

async function endpointOf(req: Request): Promise<string | null> {
  return verifyBrowserGuardEndpoint(req.get("x-eiq-endpoint") ?? undefined, req.get("x-eiq-key") ?? undefined);
}

const hostSchema = z.string().trim().toLowerCase().min(3).max(255).regex(/^[a-z0-9.-]+$/);

aiGuardExtRouter.get("/policy", async (req, res, next) => {
  try {
    const agentId = await endpointOf(req);
    if (!agentId) return res.status(403).json({ error: "Unknown endpoint" });
    const host = hostSchema.safeParse(req.query.host);
    if (!host.success) return res.status(400).json({ error: "host is required" });
    res.json(await extensionPolicyFor(agentId, host.data));
  } catch (err) {
    next(err);
  }
});

const eventSchema = z.object({
  host: hostSchema,
  channel: z.enum(["PASTE", "SEND", "UPLOAD"]),
  action: z.enum(["BLOCKED", "REDACTED", "WARNED_CANCELLED", "WARNED_CONTINUED"]),
  dataTypes: z.array(z.string().max(100)).min(1).max(20),
  maskedSample: z.string().max(500).nullish(),
  fileName: z.string().max(300).nullish(),
  policyId: z.string().max(100).nullish(),
});

aiGuardExtRouter.post("/event", async (req, res, next) => {
  try {
    const agentId = await endpointOf(req);
    if (!agentId) return res.status(403).json({ error: "Unknown endpoint" });
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid event" });
    await recordPromptEvent(agentId, parsed.data);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
