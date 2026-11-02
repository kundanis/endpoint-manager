import type { SafetyEventPayload } from "@em/shared";
import { prisma } from "../db";
import { logger } from "../logger";
import { writeAudit } from "./adminAudit.service";
import { pauseAgent } from "./pause.service";

// The agent's desktop safety net removed its own blocking rules because a user's desktop never
// started. Pausing the endpoint keeps every policy off it (the agent stops enforcing) until an
// admin has fixed the policy and resumes it. Recorded in Admin logs so it can't go unnoticed.
export async function recordSafetyEvent(agentId: string, event: SafetyEventPayload): Promise<void> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { hostname: true, paused: true } });
  if (!agent) return;
  if (!agent.paused) await pauseAgent(agentId, "system:desktop-safety-net");
  logger.warn({ agentId, hostname: agent.hostname, event }, "Desktop safety net triggered - endpoint paused");
  await writeAudit({
    adminEmail: "system",
    category: "Safety",
    action: "AUTO_RECOVERED",
    module: "Endpoints",
    summary: `${agent.hostname}: desktop didn't start for ${event.username} with ${event.managedRules} Application control rule(s) in force - rules removed and endpoint paused. Fix the policy, then resume the endpoint.`,
    targetId: agentId,
    success: true,
    detail: event,
  });
}
