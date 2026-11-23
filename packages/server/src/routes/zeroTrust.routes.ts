import { Router } from "express";
import {
  addBuiltInConditions,
  ANTIVIRUS_PRODUCTS,
  builtInConditionChoices,
  installBuiltInZeroTrustPolicy,
  isProtectedConditionKey,
  REQUIRED_SOFTWARE_KEYS,
  resetBuiltInCondition,
  MANAGEMENT_AGENTS,
  setRequiredSoftware,
} from "../services/builtInZeroTrust";
import {
  assignZeroTrustPolicyRequestSchema,
  createZeroTrustConditionRequestSchema,
  createZeroTrustPolicyRequestSchema,
  requiredSoftwareRequestSchema,
  updateZeroTrustConditionRequestSchema,
  updateZeroTrustPolicyRequestSchema,
  zeroTrustOverrideBulkRequestSchema,
} from "@em/shared";
import {
  addCondition,
  requestPolicyScanNow,
  assignPolicy,
  createPolicy,
  deleteCondition,
  deletePolicy,
  getFindingsForAgent,
  getPolicy,
  getPolicyAgentBreakdown,
  listAssignments,
  listPolicies,
  unassign,
  updateCondition,
  updatePolicy,
} from "../services/zeroTrustPolicy.service";
import { applyForceComply, listOverridableConditionKeys, revokeOverride } from "../services/zeroTrustOverride.service";
import { resolveTargetAgentIds } from "../services/agentTargeting.service";
import { z } from "zod";
import { prisma } from "../db";
import { requestScan } from "../services/scanRequests";
import { canAuthorEndpointScripts, SCRIPT_AUTHORING_DENIED, setsNewScript } from "../middleware/requireAdminRole";

export const zeroTrustRouter = Router();

// Everything under /overrides is the ENTIRE surface this feature exists on — no other
// route, list, or CSV export anywhere in the product exposes override state (see
// zeroTrustOverride.service.ts and ZeroTrustCheckOverride's schema comment). Mounted before
// the "/:id" routes below so "overrides" is never swallowed as a policy id.
zeroTrustRouter.get("/overrides/condition-keys", async (_req, res, next) => {
  try {
    res.json(await listOverridableConditionKeys());
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.post("/overrides/force-comply", async (req, res, next) => {
  try {
    const payload = zeroTrustOverrideBulkRequestSchema.parse(req.body);
    res.json(await applyForceComply(payload.agentIds, payload.conditionKeys, req.adminId!));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.post("/overrides/revoke", async (req, res, next) => {
  try {
    const payload = zeroTrustOverrideBulkRequestSchema.parse(req.body);
    res.json(await revokeOverride(payload.agentIds, payload.conditionKeys));
  } catch (err) {
    next(err);
  }
});

// Adds the built-in "Baseline Device Trust" policy if it's missing, and any of its conditions
// it lacks - never changes or removes what's already there.
zeroTrustRouter.post("/built-in", async (req, res, next) => {
  try {
    // Optional: the antivirus / management agent to require (defaults: Defender, no agent check).
    const required = req.body && Object.keys(req.body).length ? requiredSoftwareRequestSchema.parse(req.body) : undefined;
    res.json(await installBuiltInZeroTrustPolicy(prisma, required));
  } catch (err) {
    next(err);
  }
});

// The built-in checks any policy can take (Conditions -> Add built-in check).
// requiredSoftwareKeys: managed on the Required software tab (also not deletable on Conditions).
zeroTrustRouter.get("/built-in-conditions", (_req, res) => {
  res.json({ conditions: builtInConditionChoices(), requiredSoftwareKeys: REQUIRED_SOFTWARE_KEYS });
});

// The antivirus and management-agent choices the console offers (plus "Other" - any name).
zeroTrustRouter.get("/security-products", (_req, res) => {
  res.json({ antivirus: ANTIVIRUS_PRODUCTS, managementAgents: MANAGEMENT_AGENTS });
});

zeroTrustRouter.post("/", async (req, res, next) => {
  try {
    const payload = createZeroTrustPolicyRequestSchema.parse(req.body);
    res.status(201).json(await createPolicy(payload, req.adminId!));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listPolicies());
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.get("/agents/:agentId", async (req, res, next) => {
  try {
    res.json(await getFindingsForAgent(req.params.agentId));
  } catch (err) {
    next(err);
  }
});

// Sets which antivirus must be registered and which management agent must be installed for
// this policy - creates, updates or removes just those two conditions.
// "Scan now" - the policy's endpoints re-scan at their next check-in (within ~30s).
zeroTrustRouter.post("/:id/scan-now", async (req, res, next) => {
  try {
    if (!(await getPolicy(req.params.id))) return res.status(404).json({ error: "Policy not found" });
    res.json({ agentCount: await requestPolicyScanNow(req.params.id) });
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.put("/:id/required-software", async (req, res, next) => {
  try {
    const payload = requiredSoftwareRequestSchema.parse(req.body);
    const existing = await getPolicy(req.params.id);
    if (!existing) return res.status(404).json({ error: "Policy not found" });
    await setRequiredSoftware(prisma, req.params.id, payload);
    res.json(await getPolicy(req.params.id));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.get("/:id", async (req, res, next) => {
  try {
    const policy = await getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateZeroTrustPolicyRequestSchema.parse(req.body);
    res.json(await updatePolicy(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deletePolicy(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Policy not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.post("/:id/conditions", async (req, res, next) => {
  try {
    const payload = createZeroTrustConditionRequestSchema.parse(req.body);
    // A custom condition is always PowerShell run as SYSTEM - see canAuthorEndpointScripts.
    if (!canAuthorEndpointScripts(req)) return res.status(403).json({ error: SCRIPT_AUTHORING_DENIED });
    res.status(201).json(await addCondition(req.params.id, payload));
  } catch (err) {
    next(err);
  }
});

// Adds the chosen built-in checks to this policy; ones it already has are left unchanged.
const addBuiltInConditionsSchema = z.object({ conditionKeys: z.array(z.string().min(1).max(100)).min(1).max(50) });
zeroTrustRouter.post("/:id/built-in-conditions", async (req, res, next) => {
  try {
    const { conditionKeys } = addBuiltInConditionsSchema.parse(req.body);
    const policy = await getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    const added = await addBuiltInConditions(prisma, req.params.id, conditionKeys);
    res.json({ added, policy: await getPolicy(req.params.id) });
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.patch("/:id/conditions/:conditionId", async (req, res, next) => {
  try {
    const payload = updateZeroTrustConditionRequestSchema.parse(req.body);
    const current = await prisma.zeroTrustCondition.findFirst({
      where: { id: req.params.conditionId, policyId: req.params.id },
      select: { conditionKey: true, checkPowerShell: true },
    });
    // updateCondition writes by id alone, so a condition of another policy must not slip past
    // the checks below by being addressed through this one.
    if (!current) return res.status(404).json({ error: "Condition not found" });
    if (setsNewScript(payload.checkPowerShell, current.checkPowerShell) && !canAuthorEndpointScripts(req)) {
      return res.status(403).json({ error: SCRIPT_AUTHORING_DENIED });
    }
    // A built-in check keeps its key - renaming it would quietly turn it into a deletable custom one.
    if (payload.conditionKey !== undefined) {
      if (isProtectedConditionKey(current.conditionKey) && payload.conditionKey !== current.conditionKey) {
        return res.status(400).json({ error: "A built-in check's key can't be changed." });
      }
    }
    res.json(await updateCondition(req.params.id, req.params.conditionId, payload));
  } catch (err) {
    next(err);
  }
});

// Puts an edited built-in check back to its shipped definition.
zeroTrustRouter.post("/:id/conditions/:conditionId/reset", async (req, res, next) => {
  try {
    const reset = await resetBuiltInCondition(prisma, req.params.id, req.params.conditionId);
    if (!reset) return res.status(404).json({ error: "Built-in check not found" });
    res.json(await getPolicy(req.params.id));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.delete("/:id/conditions/:conditionId", async (req, res, next) => {
  try {
    // Built-in checks are switched off, not deleted (see isProtectedConditionKey).
    const current = await prisma.zeroTrustCondition.findFirst({
      where: { id: req.params.conditionId, policyId: req.params.id },
      select: { conditionKey: true },
    });
    if (current && isProtectedConditionKey(current.conditionKey)) {
      return res.status(409).json({
        error: REQUIRED_SOFTWARE_KEYS.includes(current.conditionKey)
          ? "This check is set on the Required software tab. Choose Don't check there to stop using it."
          : "Built-in checks can't be deleted. Switch it off instead.",
      });
    }
    const deleted = await deleteCondition(req.params.id, req.params.conditionId);
    if (!deleted) return res.status(404).json({ error: "Condition not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.post("/:id/assign", async (req, res, next) => {
  try {
    const payload = assignZeroTrustPolicyRequestSchema.parse(req.body);

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

    const result = await assignPolicy(req.params.id, payload);
    // Evaluate the newly assigned endpoints at their next check-in, not at the next scheduled scan.
    requestScan("zeroTrust", resolved);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.get("/:id/assignments", async (req, res, next) => {
  try {
    res.json(await listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.delete("/:id/assign/:assignmentId", async (req, res, next) => {
  try {
    const removed = await unassign(req.params.id, req.params.assignmentId);
    if (!removed) return res.status(404).json({ error: "Assignment not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

zeroTrustRouter.get("/:id/agents", async (req, res, next) => {
  try {
    const breakdown = await getPolicyAgentBreakdown(req.params.id);
    if (!breakdown) return res.status(404).json({ error: "Policy not found" });
    res.json(breakdown);
  } catch (err) {
    next(err);
  }
});
