import { z } from "zod";
import { prisma } from "../db";
import { logger } from "../logger";
import { escapeHtml, sendMail } from "../utils/mailer";
import { sharedMailServer } from "./userRisk/notifications";
import { aiGuardRuleId, getAiUsage, listAiApps } from "./aiGuard.service";
import { isModuleHidden } from "./moduleVisibility.service";
import { isModuleLicensed } from "./licenseActivation.service";

// AI Guard phase 3 - email alerts. A digest of what's new (sensitive data caught in AI prompts,
// blocked AI desktop app launches), at most one email per DIGEST_GAP_MS, never one per event; and an
// optional weekly AI usage summary (Mondays from 09:00 server time). Sent through the mail server set
// under User Risk -> Email.

const SINGLETON = "singleton";
const TICK_MS = 5 * 60 * 1000;
const DIGEST_GAP_MS = 15 * 60 * 1000;
const MAX_LISTED = 25;

export class AiGuardAlertError extends Error {}

export const alertSettingsInputSchema = z.object({
  enabled: z.boolean(),
  recipients: z.array(z.string().trim().email().max(320)).max(50),
  alertOnPrompts: z.boolean(),
  alertOnBlockedApps: z.boolean(),
  weeklySummary: z.boolean(),
});
export type AlertSettingsInput = z.infer<typeof alertSettingsInputSchema>;

async function row() {
  return (await prisma.aiGuardAlertSettings.findUnique({ where: { id: SINGLETON } })) ?? (await prisma.aiGuardAlertSettings.create({ data: { id: SINGLETON } }));
}

function recipientsOf(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function getAlertSettings() {
  const r = await row();
  const mail = await sharedMailServer();
  return {
    enabled: r.enabled,
    recipients: recipientsOf(r.recipients),
    alertOnPrompts: r.alertOnPrompts,
    alertOnBlockedApps: r.alertOnBlockedApps,
    weeklySummary: r.weeklySummary,
    lastAlertSentAt: r.lastAlertSentAt?.toISOString() ?? null,
    lastWeeklySentAt: r.lastWeeklySentAt?.toISOString() ?? null,
    lastError: r.lastError,
    mailServerConfigured: !!mail,
  };
}

export async function saveAlertSettings(input: AlertSettingsInput) {
  const r = await row();
  await prisma.aiGuardAlertSettings.update({
    where: { id: SINGLETON },
    data: {
      enabled: input.enabled,
      recipients: JSON.stringify([...new Set(input.recipients.map((x) => x.toLowerCase()))]),
      alertOnPrompts: input.alertOnPrompts,
      alertOnBlockedApps: input.alertOnBlockedApps,
      weeklySummary: input.weeklySummary,
      // Turning alerts on starts from now: no flood of everything that happened before.
      ...(input.enabled && !r.enabled ? { lastAlertAt: new Date() } : {}),
    },
  });
  return getAlertSettings();
}

function page(title: string, body: string): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937;max-width:720px">
<h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h2>${body}
<p style="color:#6b7280;font-size:12px;margin-top:24px">Endpoint IQ · AI Guard. Sent to the recipients set in AI Guard → AI Usage → Email alerts.</p></div>`;
}

const td = 'style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top"';
const th = 'style="padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:left"';

function table(headers: string[], rows: string[][]): string {
  return `<table style="border-collapse:collapse;width:100%"><tr>${headers.map((h) => `<th ${th}>${escapeHtml(h)}</th>`).join("")}</tr>${rows
    .map((r) => `<tr>${r.map((c) => `<td ${td}>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("")}</table>`;
}

async function deliver(recipients: string[], subject: string, text: string, html: string) {
  const mail = await sharedMailServer();
  if (!mail) throw new AiGuardAlertError("Set up the mail server under Identity Governance → User Risk → Email first.");
  if (recipients.length === 0) throw new AiGuardAlertError("Add at least one recipient.");
  try {
    await sendMail(mail.smtp, { to: recipients, subject, text, html });
    await prisma.aiGuardAlertSettings.update({ where: { id: SINGLETON }, data: { lastError: null } });
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await prisma.aiGuardAlertSettings.update({ where: { id: SINGLETON }, data: { lastError: message } });
    throw new AiGuardAlertError(`Email failed: ${message}`);
  }
  return mail.consoleUrl;
}

export async function sendTestAlert() {
  const r = await row();
  await deliver(recipientsOf(r.recipients), "Endpoint IQ: AI Guard test email", "AI Guard email alerts are working.", page("Test Email", "<p>AI Guard email alerts are working.</p>"));
}

const ACTION_TEXT: Record<string, string> = {
  BLOCKED: "Blocked",
  REDACTED: "Masked",
  WARNED_CANCELLED: "Warned, user stopped",
  WARNED_CONTINUED: "Warned, user continued",
};
const CHANNEL_TEXT: Record<string, string> = { PASTE: "Paste", SEND: "Prompt sent", UPLOAD: "File upload", CLIPBOARD: "Clipboard (desktop app)" };

// New events since the last digest; sends when there are some and the last digest is old enough.
async function maybeSendDigest() {
  const r = await row();
  if (!r.enabled || (!r.alertOnPrompts && !r.alertOnBlockedApps)) return;
  if (r.lastAlertSentAt && Date.now() - r.lastAlertSentAt.getTime() < DIGEST_GAP_MS) return;
  const since = r.lastAlertAt ?? new Date(Date.now() - DIGEST_GAP_MS);

  const prompts = r.alertOnPrompts
    ? await prisma.aiGuardPromptEvent.findMany({ where: { occurredAt: { gt: since } }, orderBy: { occurredAt: "desc" }, take: 500, include: { agent: { select: { hostname: true } } } })
    : [];
  const apps = await listAiApps();
  const ruleToApp = new Map(apps.flatMap((a) => a.executables.map((e) => [aiGuardRuleId(a.key, e), a.name] as const)));
  const launches = r.alertOnBlockedApps && ruleToApp.size
    ? await prisma.appControlEvent.findMany({ where: { ruleId: { in: [...ruleToApp.keys()] }, occurredAt: { gt: since } }, orderBy: { occurredAt: "desc" }, take: 500, include: { agent: { select: { hostname: true } } } })
    : [];
  if (prompts.length === 0 && launches.length === 0) return;

  const appName = new Map(apps.map((a) => [a.key, a.name]));
  const parts: string[] = [];
  const text: string[] = [];
  if (prompts.length > 0) {
    parts.push(`<h3 style="font-size:15px">Sensitive Data in AI Prompts (${prompts.length})</h3>`);
    parts.push(
      table(
        ["When", "User", "Endpoint", "AI tool", "How", "Data found", "Outcome"],
        prompts.slice(0, MAX_LISTED).map((e) => [
          e.occurredAt.toLocaleString(),
          e.username ?? "—",
          e.agent.hostname,
          (e.appKey && appName.get(e.appKey)) || e.host,
          CHANNEL_TEXT[e.channel] ?? e.channel,
          (JSON.parse(e.dataTypes) as string[]).join(", "),
          ACTION_TEXT[e.action] ?? e.action,
        ]),
      ),
    );
    text.push(`${prompts.length} time(s) sensitive data was caught in AI prompts.`);
  }
  if (launches.length > 0) {
    parts.push(`<h3 style="font-size:15px">Blocked AI App Launches (${launches.length})</h3>`);
    parts.push(
      table(
        ["When", "User", "Endpoint", "AI tool"],
        launches.slice(0, MAX_LISTED).map((e) => [e.occurredAt.toLocaleString(), e.userName ?? "—", e.agent.hostname, (e.ruleId && ruleToApp.get(e.ruleId)) || e.processName || "—"]),
      ),
    );
    text.push(`${launches.length} blocked launch(es) of AI desktop apps.`);
  }
  if (prompts.length > MAX_LISTED || launches.length > MAX_LISTED) parts.push(`<p>Only the newest ${MAX_LISTED} of each are listed; see AI Guard → AI Usage for all.</p>`);

  const newest = [...prompts.map((p) => p.occurredAt), ...launches.map((l) => l.occurredAt)].reduce((a, b) => (b > a ? b : a));
  const consoleUrl = await deliver(recipientsOf(r.recipients), `Endpoint IQ AI Guard: ${text.join(" ")}`, text.join("\n"), page("AI Guard Alert", parts.join("")));
  void consoleUrl;
  await prisma.aiGuardAlertSettings.update({ where: { id: SINGLETON }, data: { lastAlertAt: newest, lastAlertSentAt: new Date() } });
}

// Mondays from 09:00 server time, once a week.
async function maybeSendWeekly() {
  const r = await row();
  if (!r.enabled || !r.weeklySummary) return;
  const now = new Date();
  if (now.getDay() !== 1 || now.getHours() < 9) return;
  if (r.lastWeeklySentAt && now.getTime() - r.lastWeeklySentAt.getTime() < 6 * 24 * 60 * 60 * 1000) return;

  const usage = await getAiUsage({ days: 7 });
  const caught = await prisma.aiGuardPromptEvent.count({ where: { occurredAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } } });
  const minutes = (s: number) => `${Math.round(s / 60)} min`;
  const body = [
    `<p>Last 7 days: <b>${usage.totals.tools}</b> AI tools used by <b>${usage.totals.users}</b> people on <b>${usage.totals.endpoints}</b> endpoints; sensitive data caught <b>${caught}</b> times; <b>${usage.totals.blockedLaunches}</b> blocked AI app launches.</p>`,
    `<h3 style="font-size:15px">Most Used AI Tools</h3>`,
    table(
      ["AI tool", "Risk", "Users", "Endpoints", "Time"],
      usage.apps.filter((a) => a.users > 0).slice(0, 10).map((a) => [a.name, a.risk, String(a.users), String(a.endpoints), minutes(a.activeSeconds)]),
    ),
    `<h3 style="font-size:15px">Top Users</h3>`,
    table(["User", "Time", "AI tools"], usage.users.slice(0, 10).map((u) => [u.username, minutes(u.activeSeconds), u.apps.map((a) => a.name).join(", ")])),
  ].join("");
  await deliver(recipientsOf(r.recipients), "Endpoint IQ AI Guard: weekly AI usage summary", `Last 7 days: ${usage.totals.tools} AI tools, ${usage.totals.users} people, ${caught} sensitive-data catches.`, page("Weekly AI Usage Summary", body));
  await prisma.aiGuardAlertSettings.update({ where: { id: SINGLETON }, data: { lastWeeklySentAt: now } });
}

export function scheduleAiGuardAlerts() {
  async function tick() {
    try {
      if ((await isModuleHidden("AI_GUARD")) || !(await isModuleLicensed("AI_GUARD"))) return;
      await maybeSendDigest();
      await maybeSendWeekly();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "AI Guard alert email not sent");
    }
  }
  setInterval(tick, TICK_MS);
}
