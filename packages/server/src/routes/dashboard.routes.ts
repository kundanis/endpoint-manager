import { Router } from "express";
import { getDashboardSummary } from "../services/dashboard.service";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", async (_req, res, next) => {
  try {
    res.json(await getDashboardSummary());
  } catch (err) {
    next(err);
  }
});
