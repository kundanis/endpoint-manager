import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../logger";
import { PolicyConflictError } from "../services/policyExclusivity.service";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.flatten() });
  }
  // One allow/block policy per endpoint (policyExclusivity.service.ts): the message names the
  // endpoint and the policy it already has.
  if (err instanceof PolicyConflictError) {
    return res.status(409).json({ error: err.message });
  }

  logger.error({ err, path: req.path }, "Unhandled request error");
  return res.status(500).json({ error: "Internal server error" });
}
