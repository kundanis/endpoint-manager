import { Router } from "express";
import { updateUserRiskAlertRequestSchema } from "@em/shared";
import {
  getAlertEvents,
  getSettings,
  getTimeline,
  getUser,
  listAlerts,
  listIdentities,
  listRules,
  listUsers,
  overview,
  runNow,
  saveSettings,
  updateAlert,
  UserRiskError,
} from "../services/userRisk/userRisk.service";
import { getNotificationSettings, NotificationError, saveNotificationSettings, sendTestEmail } from "../services/userRisk/notifications";

export const userRiskRouter = Router();

const days = (v: unknown, fallback: number, max = 90) => Math.min(max, Math.max(1, Number(v) || fallback));

userRiskRouter.get("/overview", async (_req, res, next) => {
  try {
    res.json(await overview());
  } catch (err) {
    next(err);
  }
});

userRiskRouter.get("/users", async (req, res, next) => {
  try {
    res.json(await listUsers(days(req.query.days, 7)));
  } catch (err) {
    next(err);
  }
});

userRiskRouter.get("/users/:userKey", async (req, res, next) => {
  try {
    const user = await getUser(req.params.userKey);
    if (!user) return res.status(404).json({ error: "No activity recorded for this user" });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ?days=7&types=USB_COPY,SCREENSHOT
userRiskRouter.get("/users/:userKey/timeline", async (req, res, next) => {
  try {
    const types = typeof req.query.types === "string" && req.query.types ? req.query.types.split(",") : null;
    res.json(await getTimeline(req.params.userKey, days(req.query.days, 7), types));
  } catch (err) {
    next(err);
  }
});

// ?days=30&status=OPEN|NEW|INVESTIGATING|CLOSED_TRUE|CLOSED_FALSE&severity=HIGH
userRiskRouter.get("/alerts", async (req, res, next) => {
  try {
    res.json(
      await listAlerts({
        days: days(req.query.days, 30, 365),
        status: typeof req.query.status === "string" && req.query.status ? req.query.status : undefined,
        severity: typeof req.query.severity === "string" && req.query.severity ? req.query.severity : undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
});

userRiskRouter.get("/alerts/:id/events", async (req, res, next) => {
  try {
    const events = await getAlertEvents(req.params.id);
    if (!events) return res.status(404).json({ error: "Alert not found" });
    res.json(events);
  } catch (err) {
    next(err);
  }
});

userRiskRouter.patch("/alerts/:id", async (req, res, next) => {
  try {
    const body = updateUserRiskAlertRequestSchema.parse(req.body);
    const alert = await updateAlert(req.params.id, body, req.adminEmail ?? "admin");
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    res.json(alert);
  } catch (err) {
    next(err);
  }
});

userRiskRouter.get("/settings", async (_req, res, next) => {
  try {
    const settings = await getSettings();
    res.json({ settings, rules: listRules(settings) });
  } catch (err) {
    next(err);
  }
});

userRiskRouter.put("/settings", async (req, res, next) => {
  try {
    const settings = await saveSettings(req.body);
    await runNow(); // apply links, exclusions and thresholds now rather than at the next run
    res.json({ settings, rules: listRules(settings) });
  } catch (err) {
    if (err instanceof UserRiskError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Email senders and the Windows users they are (or could be) linked to.
userRiskRouter.get("/identities", async (_req, res, next) => {
  try {
    res.json(await listIdentities());
  } catch (err) {
    next(err);
  }
});

// Email notifications (alert emails + weekly summary). The SMTP password is never returned.
userRiskRouter.get("/notifications", async (_req, res, next) => {
  try {
    res.json(await getNotificationSettings());
  } catch (err) {
    next(err);
  }
});

userRiskRouter.put("/notifications", async (req, res, next) => {
  try {
    res.json(await saveNotificationSettings(req.body));
  } catch (err) {
    if (err instanceof NotificationError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

userRiskRouter.post("/notifications/test", async (_req, res, next) => {
  try {
    await sendTestEmail();
    res.json({ sent: true });
  } catch (err) {
    if (err instanceof NotificationError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Collect and evaluate now instead of waiting for the 5-minute run.
userRiskRouter.post("/run", async (_req, res, next) => {
  try {
    res.json(await runNow());
  } catch (err) {
    next(err);
  }
});
