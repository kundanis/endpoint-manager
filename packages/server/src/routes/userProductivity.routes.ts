import { Router } from "express";
import { getAgentSessions, getDailyLogs, getFleetSummary } from "../services/userProductivity.service";

export const userProductivityRouter = Router();

// Parsed as a LOCAL midnight (not `new Date(str)`'s UTC-midnight ISO parsing) — logDate
// rows are always stamped at local midnight, so the filter bound must match that exactly,
// not drift by the server's UTC offset. Malformed/missing input is silently treated as
// absent so the service falls back to its own default (last 10 working days).
function parseDateParam(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

userProductivityRouter.get("/summary", async (_req, res, next) => {
  try {
    res.json(await getFleetSummary());
  } catch (err) {
    next(err);
  }
});

userProductivityRouter.get("/agents/:agentId", async (req, res, next) => {
  try {
    res.json(await getAgentSessions(req.params.agentId));
  } catch (err) {
    next(err);
  }
});

userProductivityRouter.get("/agents/:agentId/daily-log", async (req, res, next) => {
  try {
    const from = parseDateParam(req.query.from);
    const to = parseDateParam(req.query.to);
    res.json(await getDailyLogs(req.params.agentId, from, to));
  } catch (err) {
    next(err);
  }
});
