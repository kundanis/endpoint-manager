import { Router } from "express";
import { setEdrEnabledRequestSchema } from "@em/shared";
import { listAgentsSummary, listEvents, setEnabled } from "../services/edr.service";

export const edrRouter = Router();

edrRouter.get("/agents", async (_req, res, next) => {
  try {
    res.json(await listAgentsSummary());
  } catch (err) {
    next(err);
  }
});

edrRouter.get("/events", async (req, res, next) => {
  try {
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
    res.json(await listEvents(agentId));
  } catch (err) {
    next(err);
  }
});

edrRouter.patch("/agents/:agentId/enabled", async (req, res, next) => {
  try {
    const payload = setEdrEnabledRequestSchema.parse(req.body);
    await setEnabled(req.params.agentId, payload.enabled);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
