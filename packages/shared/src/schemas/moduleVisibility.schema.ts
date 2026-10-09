import { z } from "zod";
import { ADMIN_MODULE_KEYS } from "./adminUser.schema";

// Sub-item paths are free-form console route paths (e.g. "/commands", "/dlp"), not an
// enum — navConfig.ts's item list isn't shared-visible, so this just sanity-checks shape
// (must look like an absolute path) rather than validating against a closed set.
const itemPathSchema = z.string().min(1).max(200).regex(/^\//, "Must be an absolute path starting with /");

export const setModuleVisibilityRequestSchema = z.object({
  hiddenModuleKeys: z.array(z.enum(ADMIN_MODULE_KEYS)).max(ADMIN_MODULE_KEYS.length),
  hiddenItemPaths: z.array(itemPathSchema).max(100),
});
export type SetModuleVisibilityRequest = z.infer<typeof setModuleVisibilityRequestSchema>;

export interface ModuleVisibilityView {
  hiddenModuleKeys: string[];
  hiddenItemPaths: string[];
}
