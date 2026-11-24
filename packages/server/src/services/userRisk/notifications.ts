import { z } from "zod";
import { USER_RISK_SEVERITIES, type UserRiskSeverity } from "@em/shared";
import { prisma } from "../../db";
import { logger } from "../../logger";
import { decryptFieldOrNull, encryptFieldOrNull } from "../../utils/fieldEncryption";
import { escapeHtml, sendMail, type SmtpSettings } from "../../utils/mailer";
import { localParts, riskLevel, riskScore } from "./rules";

// User Risk email: an alert email for new alerts at or above a severity (sent with each run,
// batched), and a weekly summary of the riskiest users. Stored in UserRiskConfig.settings under
// "notifications"; the SMTP password is encrypted and never sent back to the console.

const SEVERITY_RANK: Record<UserRiskSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export const notificationSettingsInputSchema = z.object({
  enabled: z.boolean(),
  recipients: z.array(z.string().trim().email().max(320)).max(50),
  minSeverity: z.enum(USER_RISK_SEVERITIES),
  weeklyDigest: z.boolean(),
  digestWeekday: z.number().int().min(0).max(6),
  digestHour: z.number().int().min(0).max(23),
  consoleUrl: z.string().trim().max(500).nullable(), // for links in emails, e.g. https://epp.company.com
  smtp: z.object({
    host: z.string().trim().max(255),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    username: z.string().trim().max(320).nullable(),
    // Omitted = keep the stored password; "" = clear it.
    password: z.string().max(500).optional(),
    from: z.string().trim().max(320),
  }),
});
export type NotificationSettingsInput = z.infer<typeof notificationSettingsInputSchema>;

interface StoredNotifications extends Omit<NotificationSettingsInput, "smtp"> {
  smtp: Omit<SmtpSettings, "password"> & { passwordEncrypted: string | null };
  lastError?: string | null;
  lastSentAt?: string | null;
}

const DEFAULTS: StoredNotifications = {
  enabled: false,
  recipients: [],
  minSeverity: "HIGH",
  weeklyDigest: true,
  digestWeekday: 1,
  digestHour: 9,
  consoleUrl: null,
  smtp: { host: "", port: 587, secure: false, username: null, passwordEncrypted: null, from: "" },
};

async function readAll(): Promise<{ settings: Record<string, unknown>; stored: StoredNotifications }> {
  const row = (await prisma.userRiskConfig.findUnique({ where: { id: "singleton" } })) ?? (await prisma.userRiskConfig.create({ data: { id: "singleton" } }));
  const settings = JSON.parse(row.settings) as Record<string, unknown>;
  const n = (settings.notifications ?? {}) as Partial<StoredNotifications>;
  return { settings, stored: { ...DEFAULTS, ...n, smtp: { ...DEFAULTS.smtp, ...(n.smtp ?? {}) } } };
}

async function write(stored: StoredNotifications) {
  const { settings } = await readAll();
  await prisma.userRiskConfig.update({ where: { id: "singleton" }, data: { settings: JSON.stringify({ ...settings, notifications: stored }) } });
}

// What the console sees: everything except the password itself.
export async function getNotificationSettings() {
  const { stored } = await readAll();
  const { passwordEncrypted, ...smtp } = stored.smtp;
  return { ...stored, smtp: { ...smtp, passwordSet: !!passwordEncrypted } };
}

export class NotificationError extends Error {}

// Whether the server the stored password would be sent to (host, port or account) differs.
// Exported for tests.
export function smtpTargetChanged(
  stored: { host: string; port: number; username: string | null },
  next: { host: string; port: number; username: string | null },
): boolean {
  const norm = (v: string | null) => (v ?? "").trim().toLowerCase();
  return norm(stored.host) !== norm(next.host) || stored.port !== next.port || norm(stored.username) !== norm(next.username);
}

export async function saveNotificationSettings(input: unknown) {
  const body = notificationSettingsInputSchema.parse(input);
  if (body.enabled) {
    if (!body.smtp.host || !body.smtp.from) throw new NotificationError("Enter the SMTP server and the sender address.");
    if (body.recipients.length === 0) throw new NotificationError("Add at least one recipient.");
  }
  const { stored } = await readAll();
  if (body.smtp.password === undefined && stored.smtp.passwordEncrypted && smtpTargetChanged(stored.smtp, body.smtp)) {
    // Keeping the stored password while pointing it at a different server or account would let
    // anyone who can edit these settings send it to a host of their choosing ("Send test email").
    throw new NotificationError("The SMTP server, port or username changed - enter the SMTP password again to save.");
  }
  const passwordEncrypted =
    body.smtp.password === undefined ? stored.smtp.passwordEncrypted : body.smtp.password === "" ? null : (encryptFieldOrNull(body.smtp.password) ?? null);
  const { password: _password, ...smtp } = body.smtp;
  await write({ ...stored, ...body, smtp: { ...smtp, passwordEncrypted } });
  return getNotificationSettings();
}

function smtpOf(stored: StoredNotifications): SmtpSettings {
  return { ...stored.smtp, password: decryptFieldOrNull(stored.smtp.passwordEncrypted) ?? null };
}

// The product's mail server (set under User Risk -> Email), for other modules' emails (AI Guard
// alerts). Null until a server and sender are saved there.
export async function sharedMailServer(): Promise<{ smtp: SmtpSettings; consoleUrl: string | null } | null> {
  const { stored } = await readAll();
  if (!stored.smtp.host || !stored.smtp.from) return null;
  return { smtp: smtpOf(stored), consoleUrl: stored.consoleUrl };
}

async function deliver(stored: StoredNotifications, subject: string, text: string, html: string) {
  try {
    await sendMail(smtpOf(stored), { to: stored.recipients, subject, text, html });
    await write({ ...stored, lastError: null, lastSentAt: new Date().toISOString() });
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    logger.error({ err }, "User risk: email failed");
    await write({ ...stored, lastError: message });
    throw new NotificationError(`Email failed: ${message}`);
  }
}

const userLink = (stored: StoredNotifications, userKey: string) =>
  stored.consoleUrl ? `${stored.consoleUrl.replace(/\/$/, "")}/user-risk/user/${encodeURIComponent(userKey)}` : null;

function page(title: string, body: string): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937;max-width:680px">
<h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h2>${body}
<p style="color:#6b7280;font-size:12px;margin-top:24px">Endpoint IQ · User risk. Sent to the recipients set in User risk → Rules &amp; settings.</p></div>`;
}

const td = 'style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top"';

export async function sendTestEmail() {
  const { stored } = await readAll();
  if (!stored.smtp.host || !stored.smtp.from || stored.recipients.length === 0) throw new NotificationError("Save the SMTP server, sender and recipients first.");
  await deliver(stored, "Endpoint IQ: test email", "This is a test email from Endpoint IQ User risk. Email notifications are working.", page("Test email", "<p>Email notifications from User risk are working.</p>"));
}

// New alerts at or above the configured severity, in one email.
export async function notifyNewAlerts(alertIds: string[]) {
  if (alertIds.length === 0) return;
  const { stored } = await readAll();
  if (!stored.enabled || stored.recipients.length === 0 || !stored.smtp.host) return;
  const alerts = (await prisma.userRiskAlert.findMany({ where: { id: { in: alertIds } }, orderBy: { createdAt: "asc" } })).filter(
    (a) => SEVERITY_RANK[a.severity as UserRiskSeverity] >= SEVERITY_RANK[stored.minSeverity],
  );
  if (alerts.length === 0) return;

  const worst = alerts.reduce((w, a) => (SEVERITY_RANK[a.severity as UserRiskSeverity] > SEVERITY_RANK[w] ? (a.severity as UserRiskSeverity) : w), "LOW" as UserRiskSeverity);
  const subject = alerts.length === 1 ? `[${worst}] ${alerts[0].username}: ${alerts[0].title}` : `[${worst}] ${alerts.length} new user risk alerts`;
  const text = alerts.map((a) => `${a.severity} - ${a.username}: ${a.title}\n${a.detail}\n${userLink(stored, a.userKey) ?? ""}`).join("\n\n");
  const rows = alerts
    .map((a) => {
      const link = userLink(stored, a.userKey);
      const who = link ? `<a href="${escapeHtml(link)}">${escapeHtml(a.username)}</a>` : escapeHtml(a.username);
      return `<tr><td ${td}><b>${a.severity}</b></td><td ${td}>${who}</td><td ${td}><b>${escapeHtml(a.title)}</b><br><span style="color:#6b7280;white-space:pre-line">${escapeHtml(a.detail)}</span></td></tr>`;
    })
    .join("");
  const html = page(alerts.length === 1 ? "New user risk alert" : `${alerts.length} new user risk alerts`, `<table style="border-collapse:collapse;width:100%">${rows}</table>`);
  await deliver(stored, subject, text, html).catch(() => undefined); // logged and shown in settings
}

// Weekly summary, once in the configured weekday + hour (time zone from User risk settings).
export async function maybeSendWeeklyDigest(cursors: Record<string, string>, timezone: string) {
  const { stored } = await readAll();
  if (!stored.enabled || !stored.weeklyDigest || stored.recipients.length === 0 || !stored.smtp.host) return;
  const now = new Date();
  const { weekday, hour } = localParts(now, timezone);
  if (weekday !== stored.digestWeekday || hour !== stored.digestHour) return;
  if (cursors.lastDigestAt && now.getTime() - new Date(cursors.lastDigestAt).getTime() < 6 * 24 * 60 * 60_000) return;
  cursors.lastDigestAt = now.toISOString();

  const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const alerts = await prisma.userRiskAlert.findMany({ where: { windowEnd: { gte: since } } });
  const byUser = new Map<string, typeof alerts>();
  for (const a of alerts) byUser.set(a.userKey, [...(byUser.get(a.userKey) ?? []), a]);
  const users = [...byUser.entries()]
    .map(([userKey, list]) => ({ userKey, username: list[0].username, score: riskScore(list, now), count: list.length, open: list.filter((a) => a.status === "NEW" || a.status === "INVESTIGATING").length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const open = alerts.filter((a) => a.status === "NEW" || a.status === "INVESTIGATING").length;

  const text = [`User risk - last 7 days: ${alerts.length} alerts, ${open} still open.`, "", ...users.map((u) => `${u.username}: risk ${u.score} (${riskLevel(u.score)}), ${u.count} alerts, ${u.open} open`)].join("\n");
  const rows = users
    .map((u) => {
      const link = userLink(stored, u.userKey);
      const who = link ? `<a href="${escapeHtml(link)}">${escapeHtml(u.username)}</a>` : escapeHtml(u.username);
      return `<tr><td ${td}>${who}</td><td ${td}><b>${u.score}</b> ${riskLevel(u.score)}</td><td ${td}>${u.count}</td><td ${td}>${u.open}</td></tr>`;
    })
    .join("");
  const html = page(
    "User risk: weekly summary",
    `<p>Last 7 days: <b>${alerts.length}</b> alerts, <b>${open}</b> still open.</p>` +
      (users.length > 0
        ? `<table style="border-collapse:collapse;width:100%"><tr><th ${td} align="left">User</th><th ${td} align="left">Risk</th><th ${td} align="left">Alerts</th><th ${td} align="left">Open</th></tr>${rows}</table>`
        : "<p>No alerts this week.</p>"),
  );
  await deliver(stored, `User risk weekly summary: ${alerts.length} alerts, ${open} open`, text, html).catch(() => undefined);
}
