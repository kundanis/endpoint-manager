import { Router } from "express";
import { createAdminUserRequestSchema, updateAdminUserRequestSchema } from "@em/shared";
import {
  AdminUserNotFoundError,
  CannotDeleteSelfError,
  EmailAlreadyExistsError,
  LastSuperAdminError,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  updateAdminUser,
} from "../services/adminUser.service";

export const adminUsersRouter = Router();

adminUsersRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listAdminUsers());
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.post("/", async (req, res, next) => {
  try {
    const payload = createAdminUserRequestSchema.parse(req.body);
    res.status(201).json(await createAdminUser(payload, req.adminId!));
  } catch (err) {
    if (err instanceof EmailAlreadyExistsError) {
      return res.status(409).json({ error: "An admin with that email already exists" });
    }
    next(err);
  }
});

adminUsersRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateAdminUserRequestSchema.parse(req.body);
    res.json(await updateAdminUser(req.params.id, payload));
  } catch (err) {
    if (err instanceof AdminUserNotFoundError) return res.status(404).json({ error: "Admin not found" });
    if (err instanceof LastSuperAdminError) {
      return res.status(409).json({ error: "Can't remove the last super admin - promote another admin first" });
    }
    next(err);
  }
});

adminUsersRouter.delete("/:id", async (req, res, next) => {
  try {
    await deleteAdminUser(req.params.id, req.adminId!);
    res.status(204).send();
  } catch (err) {
    if (err instanceof AdminUserNotFoundError) return res.status(404).json({ error: "Admin not found" });
    if (err instanceof CannotDeleteSelfError) return res.status(400).json({ error: "You can't delete your own account" });
    if (err instanceof LastSuperAdminError) {
      return res.status(409).json({ error: "Can't delete the last super admin - promote another admin first" });
    }
    next(err);
  }
});
