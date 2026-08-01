import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../logger";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.flatten() });
  }

  logger.error({ err, path: req.path }, "Unhandled request error");
  return res.status(500).json({ error: "Internal server error" });
}
