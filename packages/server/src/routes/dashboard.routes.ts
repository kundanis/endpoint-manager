import { Router } from "express";
import { getDashboardSummaryCached } from "../cache/fleetCache";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", async (_req, res, next) => {
  try {
    res.json(await getDashboardSummaryCached());
  } catch (err) {
    next(err);
  }
});
