import { Router } from "express";
import {
  assignPiiEmailBlockRequestSchema,
  createPiiEmailBlockPolicyRequestSchema,
  createPiiEmailBlockRuleRequestSchema,
  updatePiiEmailBlockPolicyRequestSchema,
} from "@em/shared";
import {
  addRule,
  assign,
  createPolicy,
  deletePolicy,
  deleteRule,
  getPolicy,
  listAssignments,
  listEvents,
  listPolicies,
  unassign,
  updatePolicy,
} from "../services/piiEmailBlockPolicy.service";

export const piiEmailBlockRouter = Router();

piiEmailBlockRouter.post("/", async (req, res, next) => {
  try {
    const payload = createPiiEmailBlockPolicyRequestSchema.parse(req.body);
    res.status(201).json(await createPolicy(payload, req.adminId!));
  } catch (err) {
    next(err);
  }
});

piiEmailBlockRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listPolicies());
  } catch (err) {
    next(err);
  }
});

piiEmailBlockRouter.get("/:id", async (req, res, next) => {
  try {
    const policy = await getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

piiEmailBlockRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updatePiiEmailBlockPolicyRequestSchema.parse(req.body);
    res.json(await updatePolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

piiEmailBlockRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deletePolicy(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Policy not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

piiEmailBlockRouter.post("/:id/rules", async (req, res, next) => {
  try {
    const payload = createPiiEmailBlockRuleRequestSchema.parse(req.body);
    res.status(201).json(await addRule(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

piiEmailBlockRouter.delete("/:id/rules/:ruleId", async (req, res, next) => {
  try {
    const deleted = await deleteRule(req.params.id, req.params.ruleId);
    if (!deleted) return res.status(404).json({ error: "Rule not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

piiEmailBlockRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const payload = assignPiiEmailBlockRequestSchema.parse(req.body);
    await assign(req.params.id, payload);
    res.status(201).json(await getPolicy(req.params.id));
  } catch (err) {
    next(err);
  }
});

piiEmailBlockRouter.get("/:id/assignments", async (req, res, next) => {
  try {
    res.json(await listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

piiEmailBlockRouter.delete("/:id/assign/:assignmentId", async (req, res, next) => {
  try {
    const removed = await unassign(req.params.id, req.params.assignmentId);
    if (!removed) return res.status(404).json({ error: "Assignment not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

piiEmailBlockRouter.get("/:id/events", async (req, res, next) => {
  try {
    res.json(await listEvents(req.params.id));
  } catch (err) {
    next(err);
  }
});
