import { Router, type Response } from "express";
import { z } from "zod";
import { AI_APP_CATEGORIES, AI_APP_RISKS } from "@em/shared";
import {
  AiGuardNotFoundError,
  AiGuardValidationError,
  createCustomApp,
  createPolicy,
  deleteCustomApp,
  deletePolicy,
  getAiUsage,
  getPolicy,
  getPolicySyncStatus,
  listAiApps,
  listPolicies,
  setPolicyAssignments,
  updateCustomApp,
  updatePolicy,
} from "../services/aiGuard.service";
import { listPromptEvents, promptDataTypeOptions } from "../services/aiGuardPrompt.service";
import { AiComponentError, listComponents, requestScan, setEndpointBlock } from "../services/aiGuardAddons.service";
import { AiGuardAlertError, alertSettingsInputSchema, getAlertSettings, saveAlertSettings, sendTestAlert } from "../services/aiGuardAlerts.service";
import { requireFeature } from "../middleware/requireModule";

// AI Guard admin API (mounted behind the AI_GUARD module gates in app.ts).
export const aiGuardRouter = Router();

function sendError(err: unknown, res: Response): boolean {
  if (err instanceof AiGuardNotFoundError) {
    res.status(404).json({ error: "Not found" });
  } else if (err instanceof AiGuardValidationError) {
    res.status(400).json({ error: err.message });
  } else {
    return false;
  }
  return true;
}

const customAppSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(AI_APP_CATEGORIES),
  risk: z.enum(AI_APP_RISKS),
  domains: z.array(z.string().max(253)).max(30).default([]),
  executables: z.array(z.string().max(124)).max(20).default([]),
});

const actionSchema = z.enum(["ALLOW", "BLOCK"]);
const policySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).nullish(),
  enabled: z.boolean().default(true),
  defaultAction: actionSchema,
  appActions: z.record(z.string().max(100), actionSchema).default({}),
  promptProtection: z.boolean().optional(),
  promptDataTypes: z.array(z.string().max(120)).max(200).optional(),
  promptAction: z.enum(["WARN", "BLOCK", "REDACT"]).optional(),
});

const assignmentsSchema = z.object({
  agentIds: z.array(z.string()).max(5000).default([]),
  groupIds: z.array(z.string()).max(500).default([]),
});

const usageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  groupId: z.string().max(100).optional(),
});

aiGuardRouter.get("/usage", async (req, res, next) => {
  try {
    const q = usageQuerySchema.parse(req.query);
    res.json(await getAiUsage({ days: q.days, groupId: q.groupId || undefined }));
  } catch (err) {
    next(err);
  }
});

aiGuardRouter.get("/apps", async (_req, res, next) => {
  try {
    res.json(await listAiApps());
  } catch (err) {
    next(err);
  }
});

aiGuardRouter.post("/apps", async (req, res, next) => {
  try {
    res.status(201).json(await createCustomApp(customAppSchema.parse(req.body), req.adminId!));
  } catch (err) {
    if (!sendError(err, res)) next(err);
  }
});

aiGuardRouter.put("/apps/:id", async (req, res, next) => {
  try {
    res.json(await updateCustomApp(req.params.id, customAppSchema.parse(req.body)));
  } catch (err) {
    if (!sendError(err, res)) next(err);
  }
});

aiGuardRouter.delete("/apps/:id", async (req, res, next) => {
  try {
    await deleteCustomApp(req.params.id);
    res.status(204).send();
  } catch (err) {
    if (!sendError(err, res)) next(err);
  }
});

aiGuardRouter.get("/policies", async (_req, res, next) => {
  try {
    res.json(await listPolicies());
  } catch (err) {
    next(err);
  }
});

aiGuardRouter.get("/policies/:id", async (req, res, next) => {
  try {
    res.json(await getPolicy(req.params.id));
  } catch (err) {
    if (!sendError(err, res)) next(err);
  }
});

aiGuardRouter.post("/policies", async (req, res, next) => {
  try {
    res.status(201).json(await createPolicy(policySchema.parse(req.body), req.adminId!));
  } catch (err) {
    if (!sendError(err, res)) next(err);
  }
});

aiGuardRouter.put("/policies/:id", async (req, res, next) => {
  try {
    res.json(await updatePolicy(req.params.id, policySchema.parse(req.body)));
  } catch (err) {
    if (!sendError(err, res)) next(err);
  }
});

aiGuardRouter.delete("/policies/:id", async (req, res, next) => {
  try {
    await deletePolicy(req.params.id);
    res.status(204).send();
  } catch (err) {
    if (!sendError(err, res)) next(err);
  }
});

aiGuardRouter.put("/policies/:id/assignments", async (req, res, next) => {
  try {
    const p = assignmentsSchema.parse(req.body);
    res.json(await setPolicyAssignments(req.params.id, p.agentIds, p.groupIds));
  } catch (err) {
    if (!sendError(err, res)) next(err);
  }
});

aiGuardRouter.get("/policies/:id/sync-status", async (req, res, next) => {
  try {
    res.json(await getPolicySyncStatus(req.params.id));
  } catch (err) {
    if (!sendError(err, res)) next(err);
  }
});

aiGuardRouter.get("/prompt-data-types", requireFeature("AI_PROMPT"), async (_req, res, next) => {
  try {
    res.json(await promptDataTypeOptions());
  } catch (err) {
    next(err);
  }
});

aiGuardRouter.get("/prompt-events", requireFeature("AI_PROMPT"), async (req, res, next) => {
  try {
    const q = usageQuerySchema.parse(req.query);
    res.json(await listPromptEvents({ days: q.days, groupId: q.groupId || undefined }));
  } catch (err) {
    next(err);
  }
});

// ---- Phase 3: AI add-ons and email alerts --------------------------------------------------------

aiGuardRouter.get("/components", requireFeature("AI_EXTENSIONS"), async (req, res, next) => {
  try {
    const groupId = typeof req.query.groupId === "string" && req.query.groupId ? req.query.groupId : undefined;
    res.json(await listComponents({ groupId }));
  } catch (err) {
    next(err);
  }
});

const endpointBlockSchema = z.object({
  agentId: z.string().min(1).max(64),
  key: z.string().min(1).max(260).startsWith("addon:"),
  blocked: z.boolean(),
});

// Allow or block one AI add-on on one endpoint, on top of the endpoint's policy.
aiGuardRouter.put("/components/endpoint-block", requireFeature("AI_EXTENSIONS"), async (req, res, next) => {
  try {
    const b = endpointBlockSchema.parse(req.body);
    await setEndpointBlock(b.agentId, b.key, b.blocked);
    res.status(204).send();
  } catch (err) {
    if (err instanceof AiComponentError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

const scanSchema = z.object({ agentId: z.string().min(1).max(64).optional(), groupId: z.string().min(1).max(64).optional() });

// Scan now: the chosen endpoint (or every Windows endpoint, or a group's) looks for add-ons again.
aiGuardRouter.post("/components/scan", requireFeature("AI_EXTENSIONS"), async (req, res, next) => {
  try {
    res.json({ requested: await requestScan(scanSchema.parse(req.body ?? {})) });
  } catch (err) {
    next(err);
  }
});

aiGuardRouter.get("/alerts", async (_req, res, next) => {
  try {
    res.json(await getAlertSettings());
  } catch (err) {
    next(err);
  }
});

aiGuardRouter.put("/alerts", async (req, res, next) => {
  try {
    res.json(await saveAlertSettings(alertSettingsInputSchema.parse(req.body)));
  } catch (err) {
    next(err);
  }
});

aiGuardRouter.post("/alerts/test", async (_req, res, next) => {
  try {
    await sendTestAlert();
    res.status(204).send();
  } catch (err) {
    if (err instanceof AiGuardAlertError) return res.status(400).json({ error: err.message });
    next(err);
  }
});
