import type { EnrollRequest, EnrollResponse } from "@em/shared";
import { prisma } from "../db";
import { generateToken, hashToken } from "../utils/tokens";
import { decryptField, encryptField } from "../utils/fieldEncryption";
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
      tokenEncrypted: encryptField(token),
      label: params.label,
      usesRemaining: params.usesRemaining,
      expiresAt: new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000),
      groupId: params.groupId ?? null,
    },
  });
  return { id: record.id, token };
}

export class TokenNotRecoverableError extends Error {}

// The plaintext of a still-usable token, for downloading its setup file (or copying it) again
// from the token list. Null when the token doesn't exist. Throws for tokens that can no longer
// enroll anything, and for tokens created before their value was kept (hash only).
export async function getUsableTokenPlaintext(id: string): Promise<{ label: string; token: string } | null> {
  const record = await prisma.enrollmentToken.findUnique({ where: { id } });
  if (!record) return null;
  if (record.revoked || record.expiresAt.getTime() < Date.now() || record.usesRemaining <= 0) {
    throw new InvalidEnrollmentTokenError("This enrollment token is revoked, expired or used up");
  }
  if (!record.tokenEncrypted) {
    throw new TokenNotRecoverableError(
      "This token was created before tokens could be downloaded again - create a new token to get a setup file.",
    );
  }
  return { label: record.label, token: decryptField(record.tokenEncrypted) };
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

// Placeholder serials that many boards and VMs report - useless as an identity.
const PLACEHOLDER_SERIALS = new Set([
  "",
  "0",
  "NONE",
  "N/A",
  "NA",
  "DEFAULT STRING",
  "TO BE FILLED BY O.E.M.",
  "SYSTEM SERIAL NUMBER",
  "NOT SPECIFIED",
  "NOT APPLICABLE",
  "CHASSIS SERIAL NUMBER",
  "123456789",
  "0123456789",
]);

function usableSerial(value: string | null | undefined): string | null {
  const s = value?.trim().toUpperCase() ?? "";
  return PLACEHOLDER_SERIALS.has(s) || /^0+$/.test(s) ? null : s;
}

function usableMac(value: string | null | undefined): string | null {
  const m = value?.replace(/[^0-9a-f]/gi, "").toLowerCase() ?? "";
  return m.length === 12 && !/^0+$/.test(m) ? m : null;
}

// The serial decides when both sides have one (a matching MAC can't override a different
// serial); the MAC is the fallback for machines without a usable serial.
export function isSameMachine(
  known: { serialNumber: string | null; macAddress: string | null },
  incoming: { serialNumber?: string | null; macAddress?: string | null },
): boolean {
  const knownSerial = usableSerial(known.serialNumber);
  const incomingSerial = usableSerial(incoming.serialNumber);
  if (knownSerial && incomingSerial) return knownSerial === incomingSerial;
  const knownMac = usableMac(known.macAddress);
  const incomingMac = usableMac(incoming.macAddress);
  return !!knownMac && knownMac === incomingMac;
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
  //
  // A matching hostname alone is NOT proof of being that machine, though: enrollment tokens
  // are multi-use and ship inside the setup file, so anyone holding one could otherwise
  // enroll as "FINANCE-DC01", take over that endpoint's identity (its pending commands and
  // policies) and knock the real agent off. The record is reused only when the hardware
  // matches what that endpoint last reported (BIOS serial, else primary MAC); otherwise the
  // newcomer gets a record of its own and the existing endpoint is left untouched.
  const sameHostname = await prisma.agent.findMany({
    where: { hostname: payload.hostname },
    select: { id: true, serialNumber: true, macAddress: true },
    orderBy: { lastCheckinAt: "desc" }, // SQL Server sorts NULLs last when descending
  });
  const existing = sameHostname.find((a) => isSameMachine(a, payload)) ?? null;
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
          // Recorded now (inventory fills them in later anyway) so a reinstall before the
          // first inventory report is still recognised as the same machine.
          serialNumber: payload.serialNumber?.trim() || null,
          macAddress: payload.macAddress?.trim() || null,
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
