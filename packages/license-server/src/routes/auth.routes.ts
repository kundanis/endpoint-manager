import { Router } from "express";
import { z } from "zod";
import { InvalidCredentialsError, login } from "../services/auth.service";
import { adminAuthMiddleware } from "../middleware/adminAuth";
import { prisma } from "../db";

export const authRouter = Router();

const COOKIE_NAME = "ls_admin_jwt";
const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginRequestSchema.parse(req.body);
    const token = await login(email, password);

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE_MS,
    });
    res.json({ user: { email } });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    next(err);
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.status(204).send();
});

authRouter.get("/me", adminAuthMiddleware, async (req, res) => {
  const admin = await prisma.licenseAdmin.findUnique({ where: { id: req.adminId } });
  if (!admin) return res.status(404).json({ error: "Not found" });
  res.json({ id: admin.id, email: admin.email });
});
