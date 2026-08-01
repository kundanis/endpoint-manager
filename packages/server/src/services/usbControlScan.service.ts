import type { AssignedUsbControlResponse, UsbControlEventBatchPayload, UsbControlSyncResultPayload } from "@em/shared";
import { prisma } from "../db";
import { isPolicyExcepted } from "./policyAccessException.service";

async function groupIdsForAgent(agentId: string): Promise<string[]> {
  const memberships = await prisma.agentGroupMembership.findMany({ where: { agentId }, select: { groupId: true } });
  return memberships.map((m) => m.groupId);
}

// Flat, deduped serial whitelist across every enabled, non-excepted policy assigned to this
// agent (directly or via a group) — a device is allowed if its serial is in ANY of them.
export async function resolveAssignedRulesForAgent(agentId: string): Promise<AssignedUsbControlResponse> {
  const groupIds = await groupIdsForAgent(agentId);

  const assignments = await prisma.usbControlPolicyAssignment.findMany({
    where: { OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])] },
    select: { policyId: true },
  });
  const candidatePolicyIds = [...new Set(assignments.map((a) => a.policyId))];
  if (candidatePolicyIds.length === 0) return { policyIds: [], allowedSerials: [] };

  const excepted = await Promise.all(candidatePolicyIds.map((id) => isPolicyExcepted("USB_CONTROL", id, agentId)));
  const policyIds = candidatePolicyIds.filter((_, i) => !excepted[i]);
  if (policyIds.length === 0) return { policyIds: [], allowedSerials: [] };

  const policies = await prisma.usbControlPolicy.findMany({
    where: { id: { in: policyIds }, enabled: true },
    include: { rules: true },
  });

  const allowedSerials = [...new Set(policies.flatMap((p) => p.rules.map((r) => r.value)))];
  return { policyIds: policies.map((p) => p.id), allowedSerials };
}

export async function recordSyncResult(agentId: string, payload: UsbControlSyncResultPayload): Promise<void> {
  if (payload.policyIds.length === 0) return;
  const groupIds = await groupIdsForAgent(agentId);

  await prisma.usbControlPolicyAssignment.updateMany({
    where: {
      policyId: { in: payload.policyIds },
      OR: [{ agentId }, ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : [])],
    },
    data: {
      lastSyncedAt: new Date(),
      lastSyncStatus: payload.status,
      lastSyncError: payload.errorMessage,
    },
  });
}

// Plain inserts — each event is a distinct real-time occurrence (a device was disabled), not
// a current-state row. policyId is left null: "not on the combined allow-list of every
// currently assigned policy" has no single owning policy to attribute to (a union, not a
// per-rule match) — see the schema comment on UsbControlEvent.
export async function recordEvents(agentId: string, payload: UsbControlEventBatchPayload): Promise<void> {
  if (payload.events.length === 0) return;

  await prisma.usbControlEvent.createMany({
    data: payload.events.map((e) => ({
      agentId,
      policyId: null,
      serialNumber: e.serialNumber,
      deviceDescription: e.deviceDescription,
      action: e.action,
      occurredAt: new Date(e.occurredAt),
    })),
  });
}
