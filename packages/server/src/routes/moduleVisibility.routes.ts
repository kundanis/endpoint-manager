import { Router } from "express";
import { setModuleVisibilityRequestSchema } from "@em/shared";
import { getModuleVisibility, setModuleVisibility } from "../services/moduleVisibility.service";
import { requireSuperAdmin } from "../middleware/requireAdminRole";

export const moduleVisibilityRouter = Router();

// Readable by any authenticated admin (not just SUPER_ADMIN) — every admin's own console
// session needs this to filter its own nav, regardless of their role/module grants.
moduleVisibilityRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getModuleVisibility());
  } catch (err) {
    next(err);
  }
});

// Changing what's hidden org-wide is a SUPER_ADMIN-only action — same role gate as
// admin-user management itself, not a module grant (a plain ADMIN could otherwise hide a
// module out from under every other admin, including super admins).
moduleVisibilityRouter.put("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const payload = setModuleVisibilityRequestSchema.parse(req.body);
    res.json(await setModuleVisibility(payload));
  } catch (err) {
    next(err);
  }
});
