import { REVOKE_NOTICE_PATH, type RevokeNoticeRequest } from "@license/shared";
import { prisma } from "../db";
import { logger } from "../logger";

// Deployments never poll for revocation (their license stays valid offline once activated),
// so a revoke only takes effect there when this notice reaches them. A failed delivery is
// recorded and retried by scheduleRevokeNoticeRetries until it lands.

const RETRY_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

export async function deliverRevokeNotice(licenseKeyId: string): Promise<boolean> {
  const key = await prisma.licenseKey.findUnique({ where: { id: licenseKeyId } });
  // A key revoked before anyone activated it has no deployment to tell.
  if (!key || key.status !== "REVOKED" || key.revokeNoticeDeliveredAt || !key.boundDeploymentId) return false;
  if (!key.revocationSecret || !key.callbackUrls) {
    await prisma.licenseKey.update({
      where: { id: key.id },
      data: { revokeNoticeLastError: "The deployment hasn't registered a callback address yet" },
    });
    return false;
  }

  const body: RevokeNoticeRequest = { deploymentId: key.boundDeploymentId, revocationSecret: key.revocationSecret };
  // Tried in the order the deployment registered them; the first that accepts wins.
  const errors: string[] = [];
  for (const baseUrl of JSON.parse(key.callbackUrls) as string[]) {
    try {
      const res = await fetch(`${baseUrl}${REVOKE_NOTICE_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        await prisma.licenseKey.update({
          where: { id: key.id },
          data: { revokeNoticeDeliveredAt: new Date(), revokeNoticeLastError: null },
        });
        logger.info({ licenseKeyId: key.id, baseUrl }, "Revoke notice delivered");
        return true;
      }
      errors.push(`${baseUrl}: HTTP ${res.status}`);
    } catch (err) {
      errors.push(`${baseUrl}: ${(err as Error).message}`);
    }
  }

  await prisma.licenseKey.update({
    where: { id: key.id },
    data: { revokeNoticeLastError: errors.join("; ").slice(0, 1000) },
  });
  logger.warn({ licenseKeyId: key.id, errors }, "Revoke notice not delivered, will retry");
  return false;
}

export function scheduleRevokeNoticeRetries() {
  async function tick() {
    try {
      const pending = await prisma.licenseKey.findMany({
        where: { status: "REVOKED", revokeNoticeDeliveredAt: null, revocationSecret: { not: null } },
        select: { id: true },
      });
      for (const { id } of pending) await deliverRevokeNotice(id);
    } catch (err) {
      logger.error({ err }, "Revoke notice retry tick failed");
    }
  }

  tick();
  setInterval(tick, RETRY_INTERVAL_MS);
}
