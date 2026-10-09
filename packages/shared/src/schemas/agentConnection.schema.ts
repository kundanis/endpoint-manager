import { z } from "zod";

// An http(s) base URL with no path - agents append /api/... to it directly. Empty string
// means "not used" (e.g. no NAT rule set up yet), normalized to null by the server.
const baseUrl = z
  .string()
  .trim()
  .refine((v) => {
    if (v === "") return true;
    try {
      const u = new URL(v);
      return (u.protocol === "http:" || u.protocol === "https:") && (u.pathname === "/" || u.pathname === "");
    } catch {
      return false;
    }
  }, "Must be an http:// or https:// address with no path, e.g. https://203.0.113.10:4443");

export const updateAgentConnectionSettingsRequestSchema = z.object({
  localUrl: baseUrl,
  webUrl: baseUrl,
  publicUrl: baseUrl,
});
export type UpdateAgentConnectionSettingsRequest = z.infer<typeof updateAgentConnectionSettingsRequestSchema>;

export const downloadAgentSetupRequestSchema = z.object({
  enrollmentToken: z.string().min(1),
});
export type DownloadAgentSetupRequest = z.infer<typeof downloadAgentSetupRequestSchema>;
