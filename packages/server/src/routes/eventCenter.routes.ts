import { Router, type Request } from "express";
import {
  EVENT_CATEGORIES,
  EVENT_SEVERITIES,
  MAX_PERIOD_DAYS,
  getEventGroups,
  getEventOptions,
  getEventTimeline,
  type EventCategory,
  type EventFilter,
  type EventSeverity,
} from "../services/eventCenter.service";

// Events: every module's events in one place. No module gate on the mount - each kind of event
// is filtered inside by the admin's own access (licence, visibility, grants), as the bell does.
export const eventCenterRouter = Router();

const DAY = 24 * 60 * 60 * 1000;

const list = (v: unknown) =>
  (typeof v === "string" ? v.split(",") : [])
    .map((x) => x.trim())
    .filter(Boolean);

const date = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ?from=&to= (ISO; default the last 7 days, at most 90), ?agent=, ?group=, ?category=a,b,
// ?severity=a,b, ?type=a,b
export function parseEventFilter(query: Request["query"], now = new Date()): EventFilter {
  const to = date(query.to) ?? now;
  let from = date(query.from) ?? new Date(to.getTime() - 7 * DAY);
  if (from > to) from = new Date(to.getTime() - 7 * DAY);
  if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY) from = new Date(to.getTime() - MAX_PERIOD_DAYS * DAY);
  const agentId = typeof query.agent === "string" && query.agent ? query.agent : undefined;
  const groupId = !agentId && typeof query.group === "string" && query.group ? query.group : undefined;
  return {
    from,
    to,
    agentId,
    groupId,
    categories: list(query.category).filter((c): c is EventCategory => (EVENT_CATEGORIES as readonly string[]).includes(c)),
    severities: list(query.severity).filter((s): s is EventSeverity => (EVENT_SEVERITIES as readonly string[]).includes(s)),
    types: list(query.type),
  };
}

const viewerOf = (req: Request) => ({ role: req.adminRole, grants: req.adminModuleGrantKeys ?? [] });

eventCenterRouter.get("/options", async (req, res, next) => {
  try {
    res.json(await getEventOptions(viewerOf(req)));
  } catch (err) {
    next(err);
  }
});

// By event: each kind once, with occurrences and the endpoints it happened on.
eventCenterRouter.get("/groups", async (req, res, next) => {
  try {
    res.json(await getEventGroups(viewerOf(req), parseEventFilter(req.query)));
  } catch (err) {
    next(err);
  }
});

// Timeline, newest first. ?before= pages back; ?event= (a group's key) narrows to one kind.
eventCenterRouter.get("/timeline", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit);
    res.json(
      await getEventTimeline(viewerOf(req), parseEventFilter(req.query), {
        before: date(req.query.before) ?? undefined,
        event: typeof req.query.event === "string" && req.query.event ? req.query.event : undefined,
        limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
});
