import { Router } from "express";
import { setUninstallPasswordRequestSchema } from "@em/shared";
import { clearUninstallPassword, getStatus, setUninstallPassword } from "../services/agentSecurity.service";

export const agentSecurityRouter = Router();

agentSecurityRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getStatus());
  } catch (err) {
    next(err);
  }
});

agentSecurityRouter.put("/uninstall-password", async (req, res, next) => {
  try {
    const payload = setUninstallPasswordRequestSchema.parse(req.body);
    res.json(await setUninstallPassword(payload.password));
  } catch (err) {
    next(err);
  }
});

agentSecurityRouter.delete("/uninstall-password", async (_req, res, next) => {
  try {
    res.json(await clearUninstallPassword());
  } catch (err) {
    next(err);
  }
});
