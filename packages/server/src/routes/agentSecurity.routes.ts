import { Router } from "express";
import { setRemoteInstallAccountRequestSchema, setUninstallPasswordRequestSchema } from "@em/shared";
import {
  clearRemoteInstallAccount,
  clearUninstallPassword,
  getStatus,
  RemoteInstallAccountError,
  setRemoteInstallAccount,
  setUninstallPassword,
} from "../services/agentSecurity.service";
import { requireSuperAdmin } from "../middleware/requireAdminRole";

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

// Remote install account: a Windows admin credential, so saving or removing it is for super
// admins only, and only super admins can install with it (POST /api/admin/remote-install);
// other admins type an account for each install.
agentSecurityRouter.put("/remote-install-account", requireSuperAdmin, async (req, res, next) => {
  try {
    const payload = setRemoteInstallAccountRequestSchema.parse(req.body);
    res.json(await setRemoteInstallAccount(payload.username, payload.password));
  } catch (err) {
    if (err instanceof RemoteInstallAccountError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

agentSecurityRouter.delete("/remote-install-account", requireSuperAdmin, async (_req, res, next) => {
  try {
    res.json(await clearRemoteInstallAccount());
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
