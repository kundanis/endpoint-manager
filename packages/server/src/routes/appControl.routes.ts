import { Router } from "express";
import {
  assignAppControlPolicyRequestSchema,
  createAppControlPolicyRequestSchema,
  createAppControlRuleRequestSchema,
  updateAppControlPolicyRequestSchema,
  updateAppControlRuleRequestSchema,
} from "@em/shared";
import {
  addRule,
  assignPolicy,
  createPolicy,
  deletePolicy,
  deleteRule,
  getEventsForAgent,
  getPolicy,
  getPolicyAgentBreakdown,
  getPolicyEventsForAgent,
  listAssignments,
  searchSeenSigners,
  listPolicies,
  unassign,
  updatePolicy,
  updateRule,
} from "../services/appControlPolicy.service";
import { PolicyModeError, UnsafeRuleError } from "../services/appControlPolicy.service";
import { getUndefinedApplications } from "../services/appControlUndefined.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { prisma } from "../db";
import { config } from "../config";
import { blockSoftware, listSoftwareBlocks, releaseSoftware, SoftwareBlockError } from "../services/softwareBlock.service";

export const appControlRouter = Router();

appControlRouter.post("/", async (req, res, next) => {
  try {
    const payload = createAppControlPolicyRequestSchema.parse(req.body);
    res.status(201).json(await createPolicy(payload, req.adminId!));
  } catch (err) {
    if (err instanceof PolicyModeError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Installed software no policy names yet (?all=1 includes drivers, runtimes and updates).
appControlRouter.get("/undefined-applications", async (req, res, next) => {
  try {
    res.json(await getUndefinedApplications(req.query.all === "1"));
  } catch (err) {
    next(err);
  }
});

// Allowlist rule picker: signers Windows recorded on endpoints. ?q= filters by name.
appControlRouter.get("/signers", async (req, res, next) => {
  try {
    res.json(await searchSeenSigners(typeof req.query.q === "string" ? req.query.q : ""));
  } catch (err) {
    next(err);
  }
});

// Whether this server offers advanced application control (ADVANCED_APP_CONTROL in .env).
appControlRouter.get("/features", (_req, res) => {
  res.json({ advanced: config.advancedAppControl });
});

appControlRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listPolicies());
  } catch (err) {
    next(err);
  }
});

appControlRouter.get("/agents/:agentId", async (req, res, next) => {
  try {
    res.json(await getEventsForAgent(req.params.agentId));
  } catch (err) {
    next(err);
  }
});

// Endpoint -> Software tab: Block / Release software with no licence recorded (softwareBlock.service).
appControlRouter.get("/agents/:agentId/software-blocks", async (req, res, next) => {
  try {
    res.json(await listSoftwareBlocks(req.params.agentId));
  } catch (err) {
    next(err);
  }
});

appControlRouter.post("/agents/:agentId/software-blocks", async (req, res, next) => {
  try {
    const { softwareName, productName } = (req.body ?? {}) as { softwareName?: unknown; productName?: unknown };
    if (typeof softwareName !== "string" || !softwareName.trim() || typeof productName !== "string" || productName.length > 500) {
      return res.status(400).json({ error: "softwareName and productName are required" });
    }
    res.status(201).json(await blockSoftware(req.params.agentId, softwareName, productName, req.adminId!));
  } catch (err) {
    if (err instanceof SoftwareBlockError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

appControlRouter.delete("/agents/:agentId/software-blocks/:ruleId", async (req, res, next) => {
  try {
    res.json(await releaseSoftware(req.params.agentId, req.params.ruleId));
  } catch (err) {
    if (err instanceof SoftwareBlockError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

appControlRouter.get("/:id", async (req, res, next) => {
  try {
    const policy = await getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

appControlRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateAppControlPolicyRequestSchema.parse(req.body);
    res.json(await updatePolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

appControlRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deletePolicy(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Policy not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

appControlRouter.post("/:id/rules", async (req, res, next) => {
  try {
    const payload = createAppControlRuleRequestSchema.parse(req.body);
    res.status(201).json(await addRule(req.params.id, payload));
  } catch (err) {
    if (err instanceof UnsafeRuleError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

appControlRouter.patch("/:id/rules/:ruleId", async (req, res, next) => {
  try {
    const payload = updateAppControlRuleRequestSchema.parse(req.body);
    res.json(await updateRule(req.params.id, req.params.ruleId, payload));
  } catch (err) {
    if (err instanceof UnsafeRuleError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

appControlRouter.delete("/:id/rules/:ruleId", async (req, res, next) => {
  try {
    const deleted = await deleteRule(req.params.id, req.params.ruleId);
    if (!deleted) return res.status(404).json({ error: "Rule not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

appControlRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const payload = assignAppControlPolicyRequestSchema.parse(req.body);

    if (payload.agentIds.length > 0) {
      const existingCount = await prisma.agent.count({ where: { id: { in: payload.agentIds } } });
      if (existingCount !== payload.agentIds.length) {
        return res.status(400).json({ error: "One or more agentIds do not exist" });
      }
    }
    if (payload.groupIds.length > 0) {
      const existingGroupCount = await prisma.assetGroup.count({ where: { id: { in: payload.groupIds } } });
      if (existingGroupCount !== payload.groupIds.length) {
        return res.status(400).json({ error: "One or more groupIds do not exist" });
      }
    }
    const resolved = await resolveTargetAgentIds(payload.agentIds, payload.groupIds);
    if (resolved.length === 0) {
      return res.status(400).json({ error: "No agents resolved from the given agentIds/groupIds" });
    }

    res.status(201).json(await assignPolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

appControlRouter.get("/:id/assignments", async (req, res, next) => {
  try {
    res.json(await listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

appControlRouter.delete("/:id/assign/:assignmentId", async (req, res, next) => {
  try {
    const removed = await unassign(req.params.id, req.params.assignmentId);
    if (!removed) return res.status(404).json({ error: "Assignment not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

appControlRouter.get("/:id/agents/:agentId/events", async (req, res, next) => {
  try {
    res.json(await getPolicyEventsForAgent(req.params.id, req.params.agentId));
  } catch (err) {
    next(err);
  }
});

appControlRouter.get("/:id/agents", async (req, res, next) => {
  try {
    const breakdown = await getPolicyAgentBreakdown(req.params.id);
    if (!breakdown) return res.status(404).json({ error: "Policy not found" });
    res.json(breakdown);
  } catch (err) {
    next(err);
  }
});
