import { Router } from "express";
import {
  assignBenchmarkRequestSchema,
  createBenchmarkRequestSchema,
  createRuleRequestSchema,
  importRulesRequestSchema,
  remediateRuleRequestSchema,
  updateBenchmarkRequestSchema,
  updateRuleRequestSchema,
} from "@em/shared";
import {
  addRule,
  assignBenchmark,
  createBenchmark,
  deleteBenchmark,
  deleteRule,
  getBenchmark,
  getBenchmarkAgentBreakdown,
  getFindingsForAgent,
  importRules,
  listAssignments,
  listBenchmarks,
  remediateAllForAgent,
  remediateAllForAgentInBenchmark,
  remediateRule,
  RuleHasNoRemediationError,
  unassign,
  updateBenchmark,
  updateRule,
} from "../services/securityBenchmark.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { prisma } from "../db";

export const securityConfigRouter = Router();

securityConfigRouter.post("/", async (req, res, next) => {
  try {
    const payload = createBenchmarkRequestSchema.parse(req.body);
    res.status(201).json(await createBenchmark(payload, req.adminId!));
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listBenchmarks());
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.get("/agents/:agentId", async (req, res, next) => {
  try {
    res.json(await getFindingsForAgent(req.params.agentId));
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.post("/agents/:agentId/remediate-all", async (req, res, next) => {
  try {
    const result = await remediateAllForAgent(req.params.agentId, req.adminId!);
    if (!result) return res.status(404).json({ error: "Agent not found" });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.post("/rules/:ruleId/remediate", async (req, res, next) => {
  try {
    const payload = remediateRuleRequestSchema.parse(req.body);
    const result = await remediateRule(req.params.ruleId, payload.agentId, req.adminId!);
    if (!result) return res.status(404).json({ error: "Rule or agent not found" });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof RuleHasNoRemediationError) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

securityConfigRouter.get("/:id", async (req, res, next) => {
  try {
    const benchmark = await getBenchmark(req.params.id);
    if (!benchmark) return res.status(404).json({ error: "Benchmark not found" });
    res.json(benchmark);
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateBenchmarkRequestSchema.parse(req.body);
    res.json(await updateBenchmark(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deleteBenchmark(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Benchmark not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.post("/:id/rules", async (req, res, next) => {
  try {
    const payload = createRuleRequestSchema.parse(req.body);
    res.status(201).json(await addRule(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.post("/:id/rules/import", async (req, res, next) => {
  try {
    const payload = importRulesRequestSchema.parse(req.body);
    res.status(201).json(await importRules(req.params.id, payload.rules));
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.patch("/:id/rules/:ruleId", async (req, res, next) => {
  try {
    const payload = updateRuleRequestSchema.parse(req.body);
    res.json(await updateRule(req.params.id, req.params.ruleId, payload));
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.delete("/:id/rules/:ruleId", async (req, res, next) => {
  try {
    const deleted = await deleteRule(req.params.id, req.params.ruleId);
    if (!deleted) return res.status(404).json({ error: "Rule not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const payload = assignBenchmarkRequestSchema.parse(req.body);

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
    // Confirms at least one real agent resolves before creating the assignment rows —
    // an empty group would otherwise silently create a no-op assignment.
    const resolved = await resolveTargetAgentIds(payload.agentIds, payload.groupIds);
    if (resolved.length === 0) {
      return res.status(400).json({ error: "No agents resolved from the given agentIds/groupIds" });
    }

    res.status(201).json(await assignBenchmark(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.get("/:id/assignments", async (req, res, next) => {
  try {
    res.json(await listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.delete("/:id/assign/:assignmentId", async (req, res, next) => {
  try {
    const removed = await unassign(req.params.id, req.params.assignmentId);
    if (!removed) return res.status(404).json({ error: "Assignment not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.get("/:id/agents", async (req, res, next) => {
  try {
    const breakdown = await getBenchmarkAgentBreakdown(req.params.id);
    if (!breakdown) return res.status(404).json({ error: "Benchmark not found" });
    res.json(breakdown);
  } catch (err) {
    next(err);
  }
});

securityConfigRouter.post("/:id/agents/:agentId/remediate-all", async (req, res, next) => {
  try {
    const result = await remediateAllForAgentInBenchmark(req.params.id, req.params.agentId, req.adminId!);
    if (!result) return res.status(404).json({ error: "Agent not found" });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
