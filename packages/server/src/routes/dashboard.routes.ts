import { Router } from "express";
import { getDashboardSummaryCached } from "../cache/fleetCache";
import { getPostureHistory, POSTURE_RANGES, type PostureRange } from "../services/posture.service";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", async (_req, res, next) => {
  try {
    res.json(await getDashboardSummaryCached());
  } catch (err) {
    next(err);
  }
});

// Organisation security posture: the live score and its daily history (?range=week|month|quarter|half|year).
dashboardRouter.get("/posture", async (req, res, next) => {
  try {
    const range = String(req.query.range ?? "month");
    if (!(range in POSTURE_RANGES)) return res.status(400).json({ error: "range must be week, month, quarter, half or year" });
    res.json(await getPostureHistory(range as PostureRange));
  } catch (err) {
    next(err);
  }
});
