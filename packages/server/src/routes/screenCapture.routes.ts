import { Router } from "express";
import { z } from "zod";
import { assignScreenCapturePolicyRequestSchema, createScreenCapturePolicyRequestSchema, updateScreenCapturePolicyRequestSchema } from "@em/shared";
import {
  assignPolicy,
  createPolicy,
  deletePolicy,
  getCaptures,
  getEndpointCaptures,
  getEndpointReport,
  getPolicy,
  getPolicyReport,
  listAssignments,
  listPolicies,
  unassign,
  updatePolicy,
} from "../services/screenCapturePolicy.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { deleteImages, getImage, zipImages } from "../services/screenCaptureImage.service";
import { requireSuperAdmin } from "../middleware/requireAdminRole";
import { prisma } from "../db";

export const screenCaptureRouter = Router();

// Keeping screenshot images is a super admin decision: only they can see the images.
const IMAGE_SETTINGS = ["saveImages", "saveImagesAllEndpoints", "saveImagesAgentIds", "imageRetentionDays"];
function touchesImageSettings(req: { body: unknown; adminRole?: string }): boolean {
  if (req.adminRole === "SUPER_ADMIN" || !req.body || typeof req.body !== "object") return false;
  return IMAGE_SETTINGS.some((k) => k in (req.body as Record<string, unknown>));
}
const IMAGE_SETTINGS_FORBIDDEN = { error: "Only a super admin can change whether screenshot images are kept" };

const eventIdsSchema = z.object({ eventIds: z.array(z.string().min(1)).min(1).max(1000) });

// ---- Saved images (super admins only). Viewing a user's list of screenshots is logged in Admin
// logs (sensitive view); downloads and deletions are logged too.

screenCaptureRouter.get("/images/:eventId", requireSuperAdmin, async (req, res, next) => {
  try {
    const image = await getImage(req.params.eventId);
    if (!image) return res.status(404).json({ error: "Image not found" });
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename="${image.fileName}"`);
    res.sendFile(image.absPath);
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.get("/images/:eventId/download", requireSuperAdmin, async (req, res, next) => {
  try {
    const image = await getImage(req.params.eventId);
    if (!image) return res.status(404).json({ error: "Image not found" });
    res.setHeader("Cache-Control", "private, no-store");
    res.download(image.absPath, image.fileName);
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.post("/images/download-images", requireSuperAdmin, async (req, res, next) => {
  try {
    const { eventIds } = eventIdsSchema.parse(req.body);
    const zip = await zipImages(eventIds);
    if (!zip) return res.status(404).json({ error: "None of these screenshots has a saved image" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="screenshots-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.send(zip.data);
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.post("/images/delete-images", requireSuperAdmin, async (req, res, next) => {
  try {
    const { eventIds } = eventIdsSchema.parse(req.body);
    res.json({ deleted: await deleteImages(eventIds) });
  } catch (err) {
    next(err);
  }
});

// ---- One endpoint's screenshots, from every policy (the endpoint's Data protection tab).
// Daily report per user over the last ?days= days (1-90, default 7).
screenCaptureRouter.get("/endpoints/:agentId/report", async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const report = await getEndpointReport(req.params.agentId, days);
    if (!report) return res.status(404).json({ error: "Endpoint not found" });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// Query values are checked to be plain strings: qs parses ?agentId[not]=x into an object,
// which would otherwise reach the Prisma where clause as a filter operator.
const capturesQuerySchema = z.object({
  agentId: z.string().min(1).max(100),
  username: z.string().min(1).max(256),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// The screenshots behind one row: ?username=&day=YYYY-MM-DD (logged as a sensitive view).
screenCaptureRouter.get("/endpoints/:agentId/captures", async (req, res, next) => {
  try {
    const parsed = capturesQuerySchema.omit({ agentId: true }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "username and day are required" });
    const { username, day } = parsed.data;
    const captures = await getEndpointCaptures(req.params.agentId, username, day, req.adminRole === "SUPER_ADMIN");
    if (!captures) return res.status(404).json({ error: "Endpoint not found" });
    res.json(captures);
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.post("/", async (req, res, next) => {
  try {
    if (touchesImageSettings(req)) return res.status(403).json(IMAGE_SETTINGS_FORBIDDEN);
    const payload = createScreenCapturePolicyRequestSchema.parse(req.body);
    res.status(201).json(await createPolicy(payload, req.adminId!));
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listPolicies());
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.get("/:id", async (req, res, next) => {
  try {
    const policy = await getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.patch("/:id", async (req, res, next) => {
  try {
    if (touchesImageSettings(req)) return res.status(403).json(IMAGE_SETTINGS_FORBIDDEN);
    const payload = updateScreenCapturePolicyRequestSchema.parse(req.body);
    res.json(await updatePolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!(await deletePolicy(req.params.id))) return res.status(404).json({ error: "Policy not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const payload = assignScreenCapturePolicyRequestSchema.parse(req.body);
    if (payload.agentIds.length > 0) {
      const existingCount = await prisma.agent.count({ where: { id: { in: payload.agentIds } } });
      if (existingCount !== payload.agentIds.length) return res.status(400).json({ error: "One or more agentIds do not exist" });
    }
    if (payload.groupIds.length > 0) {
      const existingGroupCount = await prisma.assetGroup.count({ where: { id: { in: payload.groupIds } } });
      if (existingGroupCount !== payload.groupIds.length) return res.status(400).json({ error: "One or more groupIds do not exist" });
    }
    const resolved = await resolveTargetAgentIds(payload.agentIds, payload.groupIds);
    if (resolved.length === 0) return res.status(400).json({ error: "No agents resolved from the given agentIds/groupIds" });
    res.status(201).json(await assignPolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.get("/:id/assignments", async (req, res, next) => {
  try {
    res.json(await listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

screenCaptureRouter.delete("/:id/assign/:assignmentId", async (req, res, next) => {
  try {
    if (!(await unassign(req.params.id, req.params.assignmentId))) return res.status(404).json({ error: "Assignment not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Daily report per user over the last ?days= days (1-90, default 7); ?agentId= for one endpoint.
screenCaptureRouter.get("/:id/report", async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const agentId = typeof req.query.agentId === "string" && req.query.agentId ? req.query.agentId : undefined;
    const report = await getPolicyReport(req.params.id, days, agentId);
    if (!report) return res.status(404).json({ error: "Policy not found" });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// The screenshots behind one report row: ?agentId=&username=&day=YYYY-MM-DD
screenCaptureRouter.get("/:id/captures", async (req, res, next) => {
  try {
    const parsed = capturesQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "agentId, username and day are required" });
    const { agentId, username, day } = parsed.data;
    const captures = await getCaptures(req.params.id, agentId, username, day, req.adminRole === "SUPER_ADMIN");
    if (!captures) return res.status(404).json({ error: "Policy not found" });
    res.json(captures);
  } catch (err) {
    next(err);
  }
});
