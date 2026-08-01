import { Router } from "express";
import { resolveUnlockRequestSchema } from "../schemas/admin.schema";
import {
  UnlockRequestNotFoundError,
  UnlockRequestNotPendingError,
  approveUnlockRequest,
  listUnlockRequests,
  rejectUnlockRequest,
} from "../services/unlockRequest.service";

export const unlockRequestsRouter = Router();

unlockRequestsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listUnlockRequests());
  } catch (err) {
    next(err);
  }
});

unlockRequestsRouter.post("/:id/approve", async (req, res, next) => {
  try {
    const payload = resolveUnlockRequestSchema.parse(req.body);
    res.json(await approveUnlockRequest(req.params.id, req.adminId!, payload.resolutionNote));
  } catch (err) {
    if (err instanceof UnlockRequestNotFoundError) {
      return res.status(404).json({ error: "Unlock request not found" });
    }
    if (err instanceof UnlockRequestNotPendingError) {
      return res.status(409).json({ error: "Unlock request has already been resolved" });
    }
    next(err);
  }
});

unlockRequestsRouter.post("/:id/reject", async (req, res, next) => {
  try {
    const payload = resolveUnlockRequestSchema.parse(req.body);
    res.json(await rejectUnlockRequest(req.params.id, req.adminId!, payload.resolutionNote));
  } catch (err) {
    if (err instanceof UnlockRequestNotFoundError) {
      return res.status(404).json({ error: "Unlock request not found" });
    }
    if (err instanceof UnlockRequestNotPendingError) {
      return res.status(409).json({ error: "Unlock request has already been resolved" });
    }
    next(err);
  }
});
