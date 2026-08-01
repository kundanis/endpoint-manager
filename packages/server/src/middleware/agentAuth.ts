import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";
import { hashToken, tokensMatch } from "../utils/tokens";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      agentId?: string;
    }
  }
}

export async function agentAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const agentId = req.header("X-Agent-Id");
  const agentKey = req.header("X-Agent-Key");

  if (!agentId || !agentKey) {
    return res.status(401).json({ error: "Missing agent credentials" });
  }

  // This runs on every single agent check-in/scan-result request - the busiest code path in
  // the app - so a transient DB error (SQL Server restart, network blip, pool exhaustion)
  // must become an ordinary next(err)->500, not an unhandled rejection. Express 4 doesn't
  // catch a rejected promise returned by an async middleware on its own; without this
  // try/catch, a DB hiccup here crashes the whole process instead of failing one request.
  try {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || !tokensMatch(hashToken(agentKey), agent.apiKeyHash)) {
      return res.status(401).json({ error: "Invalid agent credentials" });
    }

    req.agentId = agent.id;
    next();
  } catch (err) {
    next(err);
  }
}
