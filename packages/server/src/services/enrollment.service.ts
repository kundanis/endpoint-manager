import type { EnrollRequest, EnrollResponse } from "@em/shared";
import { prisma } from "../db";
import { generateToken, hashToken } from "../utils/tokens";
import { assertCanEnroll } from "./licenseActivation.service";
import { addGroupMembers } from "./assetGroup.service";

export class InvalidEnrollmentTokenError extends Error {}

export async function createEnrollmentToken(params: {
  label: string;
  expiresInDays: number;
  usesRemaining: number;
  groupId?: string | null;
}): Promise<{ id: string; token: string }> {
  const token = generateToken(24);
  const record = await prisma.enrollmentToken.create({
    data: {
      tokenHash: hashToken(token),
      label: params.label,
      usesRemaining: params.usesRemaining,
      expiresAt: new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000),
      groupId: params.groupId ?? null,
    },
  });
  return { id: record.id, token };
}

async function consumeEnrollmentToken(plaintextToken: string) {
  const tokenHash = hashToken(plaintextToken);
  const record = await prisma.enrollmentToken.findUnique({ where: { tokenHash } });

  if (!record || record.revoked) throw new InvalidEnrollmentTokenError("Token not found or revoked");
  if (record.expiresAt.getTime() < Date.now()) throw new InvalidEnrollmentTokenError("Token expired");
  if (record.usesRemaining <= 0) throw new InvalidEnrollmentTokenError("Token exhausted");

  const usesRemaining = record.usesRemaining - 1;
  await prisma.enrollmentToken.update({
    where: { id: record.id },
    data: {
      usesRemaining,
      revoked: usesRemaining <= 0 ? true : record.revoked,
    },
  });

  return record;
}

export async function enrollAgent(payload: EnrollRequest): Promise<EnrollResponse> {
  // Checked before consuming the enrollment token so a licensing denial doesn't burn a
  // token use for nothing.
  await assertCanEnroll();
  const consumedToken = await consumeEnrollmentToken(payload.enrollmentToken);

  const apiKey = generateToken(32);
  const apiKeyHash = hashToken(apiKey);

  // Hostname is this deployment's identity for "which physical/virtual machine is this" -
  // an agent enrolling under a hostname that's already on record (a reinstall, a wiped
  // local .state, a remote-install rerun) is that SAME machine getting a new identity, not
  // a second machine. Update the existing row in place rather than creating another one:
  // keeps assertCanEnroll's agent.count() (the license seat cap) accurate to actual
  // machines rather than inflated by orphaned duplicates, and - just as importantly -
  // preserves everything administrative already attached to this asset (quarantine/pause
  // state, tags, lifecycle status, group memberships, notes, custom fields) instead of
  // silently resetting it on every reinstall. Only identity/version fields are refreshed;
  // deliberately not a full replace.
  const existing = await prisma.agent.findFirst({ where: { hostname: payload.hostname } });
  const agent = existing
    ? await prisma.agent.update({
        where: { id: existing.id },
        data: {
          apiKeyHash,
          osPlatform: payload.osPlatform,
          osVersion: payload.osVersion,
          osArch: payload.osArch,
          agentVersion: payload.agentVersion,
        },
      })
    : await prisma.agent.create({
        data: {
          hostname: payload.hostname,
          osPlatform: payload.osPlatform,
          osVersion: payload.osVersion,
          osArch: payload.osArch,
          agentVersion: payload.agentVersion,
          apiKeyHash,
        },
      });

  // A group-scoped token (see createEnrollmentToken's groupId) maps every endpoint it
  // enrolls into that group automatically - no manual post-enrollment assignment needed.
  // Best-effort: a group deleted between token creation and this enroll (groupId already
  // nulled out by the FK's ON DELETE SET NULL) just means no auto-assignment, not a failure.
  // Additive even on a re-enrollment - addGroupMembers doesn't touch group memberships this
  // agent already has from before.
  if (consumedToken.groupId) {
    await addGroupMembers(consumedToken.groupId, [agent.id]);
  }

  return { agentId: agent.id, apiKey };
}
