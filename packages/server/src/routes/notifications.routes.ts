import { Router } from "express";
import { getNotifications } from "../services/notifications.service";

export const notificationsRouter = Router();

// The alert bell. ?since= is when this admin last opened the bell (kept in their browser).
notificationsRouter.get("/", async (req, res, next) => {
  try {
    const raw = typeof req.query.since === "string" ? new Date(req.query.since) : null;
    const since = raw && !Number.isNaN(raw.getTime()) ? raw : null;
    res.json(await getNotifications({ role: req.adminRole, grants: req.adminModuleGrantKeys ?? [] }, since));
  } catch (err) {
    next(err);
  }
});
