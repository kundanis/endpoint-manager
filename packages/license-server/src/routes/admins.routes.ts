import { Router } from "express";
import rateLimit from "express-rate-limit";
import { changeAdminPasswordRequestSchema, createAdminRequestSchema } from "../schemas/admin.schema";
import {
  AdminEmailTakenError,
  AdminNotFoundError,
  CannotDeleteSelfError,
  InvalidOtpError,
  changeAdminPassword,
  createAdmin,
  deleteAdmin,
  listAdmins,
} from "../services/admin.service";

export const adminsRouter = Router();

// The OTP is a fixed numeric code, so cap attempts to keep it from being guessed.
const passwordChangeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password change attempts, try again in 15 minutes" },
});

adminsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listAdmins());
  } catch (err) {
    next(err);
  }
});

adminsRouter.post("/", async (req, res, next) => {
  try {
    const payload = createAdminRequestSchema.parse(req.body);
    res.status(201).json(await createAdmin(payload));
  } catch (err) {
    if (err instanceof AdminEmailTakenError) {
      return res.status(409).json({ error: "An admin with this email already exists" });
    }
    next(err);
  }
});

adminsRouter.post("/:id/password", passwordChangeRateLimiter, async (req, res, next) => {
  try {
    const { password, otp } = changeAdminPasswordRequestSchema.parse(req.body);
    await changeAdminPassword(req.params.id, password, otp);
    res.status(204).send();
  } catch (err) {
    if (err instanceof InvalidOtpError) {
      return res.status(403).json({ error: "Incorrect OTP" });
    }
    if (err instanceof AdminNotFoundError) {
      return res.status(404).json({ error: "Admin not found" });
    }
    next(err);
  }
});

adminsRouter.delete("/:id", async (req, res, next) => {
  try {
    await deleteAdmin(req.params.id, req.adminId!);
    res.status(204).send();
  } catch (err) {
    if (err instanceof CannotDeleteSelfError) {
      return res.status(400).json({ error: "You can't remove your own account" });
    }
    if (err instanceof AdminNotFoundError) {
      return res.status(404).json({ error: "Admin not found" });
    }
    next(err);
  }
});
