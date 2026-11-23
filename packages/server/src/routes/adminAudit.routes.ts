import { Router } from "express";
import { auditFacets, AuditError, clearOlderThan, getAuditConfig, listAudit, setRetention } from "../services/adminAudit.service";

// Identity Governance -> Admin logs (super admins only - see app.ts). Read-only apart from the
// retention setting and "clear older than"; there is no route to edit or delete an entry.
export const adminAuditRouter = Router();

const dateOrUndefined = (v: unknown) => (typeof v === "string" && v ? new Date(v) : undefined);

adminAuditRouter.get("/", async (req, res, next) => {
  try {
    // Only plain string values: qs would otherwise turn ?admin[not]=x into an object that
    // reaches the Prisma filter as an operator.
    const q: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.query)) if (typeof value === "string") q[key] = value;
    res.json(
      await listAudit({
        from: dateOrUndefined(q.from),
        to: dateOrUndefined(q.to),
        admin: q.admin || undefined,
        category: q.category || undefined,
        success: q.result === "success" ? true : q.result === "failed" ? false : undefined,
        q: q.q?.trim() || undefined,
        page: Math.max(1, Number(q.page) || 1),
        pageSize: Math.min(5000, Math.max(1, Number(q.pageSize) || 50)),
      }),
    );
  } catch (err) {
    next(err);
  }
});

adminAuditRouter.get("/facets", async (_req, res, next) => {
  try {
    res.json(await auditFacets());
  } catch (err) {
    next(err);
  }
});

adminAuditRouter.get("/settings", async (_req, res, next) => {
  try {
    res.json(await getAuditConfig());
  } catch (err) {
    next(err);
  }
});

adminAuditRouter.put("/settings", async (req, res, next) => {
  try {
    res.json(await setRetention(Number(req.body?.retentionDays), req));
  } catch (err) {
    if (err instanceof AuditError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

adminAuditRouter.post("/clear", async (req, res, next) => {
  try {
    res.json(await clearOlderThan(new Date(String(req.body?.before ?? "")), req));
  } catch (err) {
    if (err instanceof AuditError) return res.status(400).json({ error: err.message });
    next(err);
  }
});
