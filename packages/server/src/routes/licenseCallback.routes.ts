import { Router } from "express";
import rateLimit from "express-rate-limit";
import { licenseChangeNoticeSchema, revokeNoticeRequestSchema } from "@license/shared";
import { applyRevokeNotice } from "../services/licenseActivation.service";
import { receiveLicenseChangeNotice } from "../services/licenseChange.service";
import { logger } from "../logger";

// Called by the License Server, not by admins or agents - so it's public (see
// publicAccessAllowlist.ts) and authenticated only by the revocation secret this
// deployment received when it registered its callback address.
export const licenseCallbackRouter = Router();

const revokeNoticeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

licenseCallbackRouter.post("/revoke", revokeNoticeRateLimiter, async (req, res, next) => {
  try {
    const parsed = revokeNoticeRequestSchema.safeParse(req.body);
    if (!parsed.success || !(await applyRevokeNotice(parsed.data.deploymentId, parsed.data.revocationSecret))) {
      return res.status(403).json({ error: "Revoke notice could not be verified" });
    }
    logger.warn("License revoked by the License Server");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// A licence change request (or a later state of one) - recorded for a super admin to accept or
// reject under Licensing; nothing is granted by this call itself.
licenseCallbackRouter.post("/change-request", revokeNoticeRateLimiter, async (req, res, next) => {
  try {
    const parsed = licenseChangeNoticeSchema.safeParse(req.body);
    if (
      !parsed.success ||
      !(await receiveLicenseChangeNotice(parsed.data.deploymentId, parsed.data.revocationSecret, parsed.data.request))
    ) {
      return res.status(403).json({ error: "Licence change notice could not be verified" });
    }
    logger.info({ requestId: parsed.data.request.id, status: parsed.data.request.status }, "Licence change notice received");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
