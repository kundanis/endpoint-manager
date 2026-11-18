import { Router } from "express";
import { createPolicyAccessExceptionRequestSchema, resolvePolicyAccessExceptionRequestSchema } from "@em/shared";
import {
  AgentNotFoundError,
  GroupEmptyError,
  GroupNotFoundError,
  PolicyNotFoundError,
  RequestAlreadyResolvedError,
  RequestNotActiveError,
  RequestNotFoundError,
  SelfApprovalError,
  approveRequest,
  createRequest,
  listRequests,
  rejectRequest,
  endRequest,
} from "../services/policyAccessException.service";

export const policyAccessExceptionRouter = Router();

policyAccessExceptionRouter.post("/", async (req, res, next) => {
  try {
    const payload = createPolicyAccessExceptionRequestSchema.parse(req.body);
    res.status(201).json(await createRequest(payload, req.adminId!));
  } catch (err) {
    if (err instanceof AgentNotFoundError) return res.status(404).json({ error: "Agent not found" });
    if (err instanceof GroupNotFoundError) return res.status(404).json({ error: "Group not found" });
    if (err instanceof GroupEmptyError) return res.status(400).json({ error: "This group has no endpoints" });
    if (err instanceof PolicyNotFoundError) return res.status(404).json({ error: "Policy not found" });
    next(err);
  }
});

policyAccessExceptionRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listRequests());
  } catch (err) {
    next(err);
  }
});

policyAccessExceptionRouter.post("/:id/approve", async (req, res, next) => {
  try {
    const payload = resolvePolicyAccessExceptionRequestSchema.parse(req.body ?? {});
    res.json(await approveRequest(req.params.id, req.adminId!, payload.resolutionNote));
  } catch (err) {
    if (err instanceof SelfApprovalError) {
      return res.status(403).json({ error: "You can't approve your own exception request — another admin has to approve it." });
    }
    if (err instanceof RequestNotFoundError) return res.status(404).json({ error: "Request not found" });
    if (err instanceof RequestAlreadyResolvedError) return res.status(409).json({ error: "This request has already been resolved" });
    next(err);
  }
});

policyAccessExceptionRouter.post("/:id/reject", async (req, res, next) => {
  try {
    const payload = resolvePolicyAccessExceptionRequestSchema.parse(req.body ?? {});
    res.json(await rejectRequest(req.params.id, req.adminId!, payload.resolutionNote));
  } catch (err) {
    if (err instanceof RequestNotFoundError) return res.status(404).json({ error: "Request not found" });
    if (err instanceof RequestAlreadyResolvedError) return res.status(409).json({ error: "This request has already been resolved" });
    next(err);
  }
});

policyAccessExceptionRouter.post("/:id/end", async (req, res, next) => {
  try {
    const payload = resolvePolicyAccessExceptionRequestSchema.parse(req.body ?? {});
    res.json(await endRequest(req.params.id, payload.resolutionNote));
  } catch (err) {
    if (err instanceof RequestNotFoundError) return res.status(404).json({ error: "Request not found" });
    if (err instanceof RequestNotActiveError) return res.status(409).json({ error: "This exception isn't active any more" });
    next(err);
  }
});
