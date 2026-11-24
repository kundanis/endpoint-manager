import { Router } from "express";
import { requireSuperAdmin } from "../middleware/requireAdminRole";
import { ConsentError, endpointConsentRecords, getNotice, noticeInputSchema, saveNotice } from "../services/consent.service";

// Endpoint user consent (DPDP): the notice users see in the tray app, and their answers.
export const consentRouter = Router();

consentRouter.get("/notice", async (_req, res, next) => {
  try {
    res.json(await getNotice());
  } catch (err) {
    next(err);
  }
});

// The notice is a legal text, so only super admins change it.
consentRouter.put("/notice", requireSuperAdmin, async (req, res, next) => {
  try {
    res.json(await saveNotice(noticeInputSchema.parse(req.body), req.adminId!));
  } catch (err) {
    if (err instanceof ConsentError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

consentRouter.get("/endpoints/:agentId", async (req, res, next) => {
  try {
    res.json(await endpointConsentRecords(req.params.agentId));
  } catch (err) {
    next(err);
  }
});
