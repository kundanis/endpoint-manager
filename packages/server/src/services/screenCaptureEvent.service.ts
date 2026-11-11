import type { AssignedScreenCaptureWire, ScreenCaptureReportPayload, ScreenCaptureSource } from "@em/shared";
import { isIgnoredScreenshotOpener } from "@em/shared";
import { prisma } from "../db";
import { isAgentPaused } from "./pause.service";
import { shouldSaveImages } from "./screenCaptureImage.service";
import { policySources } from "./screenCapturePolicy.service";

const MAX_OPENED_BY = 10; // programs kept per screenshot (fits the 2000-character column)

// What this endpoint watches: the union of its enabled, assigned policies. Nothing assigned (or
// the endpoint paused) means no sources, and the agent stops watching and auditing.
export async function resolveAssignedForAgent(agentId: string): Promise<AssignedScreenCaptureWire> {
  const none: AssignedScreenCaptureWire = { sources: [], extraPaths: [], trackOpenedBy: false, saveImages: false };
  if (await isAgentPaused(agentId)) return none;

  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);
  const assignments = await prisma.screenCapturePolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const policyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (policyIds.length === 0) return none;

  const policies = await prisma.screenCapturePolicy.findMany({ where: { id: { in: policyIds }, enabled: true } });
  const sources = new Set<ScreenCaptureSource>();
  const extraPaths = new Set<string>();
  for (const p of policies) {
    for (const s of policySources(p)) sources.add(s);
    for (const x of JSON.parse(p.extraPaths) as string[]) extraPaths.add(x);
  }
  return {
    sources: [...sources],
    extraPaths: [...extraPaths],
    trackOpenedBy: policies.some((p) => p.trackOpenedBy),
    saveImages: shouldSaveImages(policies, agentId),
  };
}

async function latestCapture(agentId: string, filePath: string) {
  return prisma.screenCaptureEvent.findFirst({ where: { agentId, filePath }, orderBy: { capturedAt: "desc" } });
}

// Captures first, so a deletion or an open reported in the same batch finds its screenshot.
export async function recordReport(agentId: string, payload: ScreenCaptureReportPayload): Promise<void> {
  for (const c of payload.captures) {
    const capturedAt = new Date(c.capturedAt);
    await prisma.screenCaptureEvent.upsert({
      where: { agentId_filePath_capturedAt: { agentId, filePath: c.filePath, capturedAt } },
      create: {
        agentId,
        username: c.username,
        source: c.source,
        filePath: c.filePath,
        fileSizeBytes: BigInt(c.fileSizeBytes),
        capturedAt,
        captureDay: c.captureDay,
      },
      update: {},
    });
  }

  for (const d of payload.deletions) {
    const event = await latestCapture(agentId, d.filePath);
    if (event && !event.deletedAt) await prisma.screenCaptureEvent.update({ where: { id: event.id }, data: { deletedAt: new Date(d.deletedAt) } });
  }

  for (const o of payload.opens) {
    if (isIgnoredScreenshotOpener(o.process)) continue; // antivirus etc. (older agents still send these)
    const event = await latestCapture(agentId, o.filePath);
    if (!event) continue;
    const openedBy = JSON.parse(event.openedBy) as { process: string; at: string }[];
    if (openedBy.length >= MAX_OPENED_BY || openedBy.some((x) => x.process.toLowerCase() === o.process.toLowerCase())) continue;
    openedBy.push({ process: o.process, at: o.at });
    await prisma.screenCaptureEvent.update({ where: { id: event.id }, data: { openedBy: JSON.stringify(openedBy) } });
  }
}
