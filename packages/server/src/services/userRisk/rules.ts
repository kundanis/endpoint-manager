import type { UserActivityType, UserRiskRuleSetting, UserRiskSettings, UserRiskSeverity } from "@em/shared";

// Built-in User Risk rules. Each turns the per-user activity stream into alerts:
// - count:  at least `threshold` matching events by one user in one hour / one day
// - each:   every matching event is an alert of its own
// - combo:  a sequence across modules (see evaluateCombos)
// Admins can switch rules off and change threshold, points and severity (UserRiskConfig).

export interface ActivityRow {
  id: string;
  userKey: string;
  username: string;
  type: string;
  summary: string;
  detail: string; // JSON
  occurredAt: Date;
  sourceId: string;
}

export interface RuleDefinition {
  key: string;
  title: string;
  description: string;
  category: string;
  kind: "count" | "each" | "combo" | "baseline";
  types: UserActivityType[];
  window?: "hour" | "day";
  thresholdLabel?: string;
  defaults: UserRiskRuleSetting;
  // Optional narrowing of the matching events.
  filter?: (e: ActivityRow, ctx: RuleContext) => boolean;
  // Count rules: how much one event counts for (default 1), e.g. the files in a deletion burst.
  weight?: (e: ActivityRow) => number;
  alertTitle: (count: number, threshold: number) => string;
}

export interface RuleContext {
  settings: UserRiskSettings;
}

// Programs that opening a screenshot usually means it is being sent or uploaded.
export const SHARING_APPS = new Set([
  "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "iexplore.exe",
  "whatsapp.exe", "telegram.exe", "signal.exe", "outlook.exe", "olk.exe", "thunderbird.exe",
  "teams.exe", "ms-teams.exe", "slack.exe", "discord.exe", "skype.exe", "zoom.exe",
  "onedrive.exe", "dropbox.exe", "googledrivefs.exe", "anydesk.exe", "teamviewer.exe",
]);

export const QUICK_DELETE_MINUTES = 10;

// Remote-control, tunnelling and VPN tools: installing one is a common way round controls.
export const REMOTE_TOOL_PATTERN = /anydesk|teamviewer|ultraviewer|rustdesk|ammyy|supremo|splashtop|radmin|parsec|remote ?pc|screenconnect|logmein|chrome remote desktop|ngrok|tor browser|\bvpn\b|openvpn|wireguard|nordvpn|expressvpn|protonvpn|surfshark|hotspot shield|psiphon|ultrasurf|windscribe|tunnelbear/i;

export function detailOf(e: Pick<ActivityRow, "detail">): Record<string, unknown> {
  try {
    return JSON.parse(e.detail) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Hour (0-23) and weekday (0 = Sunday) of an instant in the configured time zone.
export function localParts(d: Date, timezone: string): { hour: number; weekday: number; day: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" });
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { hour: Number(parts.hour) % 24, weekday, day: `${parts.year}-${parts.month}-${parts.day}` };
}

export function isOffHours(d: Date, s: Pick<UserRiskSettings, "timezone" | "workStartHour" | "workEndHour" | "workDays">): boolean {
  const { hour, weekday } = localParts(d, s.timezone);
  return !s.workDays.includes(weekday) || hour < s.workStartHour || hour >= s.workEndHour;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const RULES: RuleDefinition[] = [
  {
    key: "SCREENSHOT_BURST",
    title: "Many screenshots in an hour",
    description: "A user takes a large number of screenshots within one hour.",
    category: "Screen capture",
    kind: "count",
    types: ["SCREENSHOT"],
    window: "hour",
    thresholdLabel: "Screenshots per hour",
    defaults: { enabled: true, threshold: 20, points: 15, severity: "MEDIUM" },
    alertTitle: (n) => `${plural(n, "screenshot")} within an hour`,
  },
  {
    key: "SCREENSHOT_QUICK_DELETE",
    title: "Screenshots deleted soon after",
    description: `Screenshots deleted within ${QUICK_DELETE_MINUTES} minutes of being taken, several times in a day.`,
    category: "Screen capture",
    kind: "count",
    types: ["SCREENSHOT_DELETED"],
    window: "day",
    thresholdLabel: "Quick deletes per day",
    defaults: { enabled: true, threshold: 3, points: 20, severity: "HIGH" },
    filter: (e) => Number(detailOf(e).minutesAfter ?? Infinity) <= QUICK_DELETE_MINUTES,
    alertTitle: (n) => `${plural(n, "screenshot")} deleted within ${QUICK_DELETE_MINUTES} minutes of being taken`,
  },
  {
    key: "SCREENSHOT_SHARED",
    title: "Screenshot opened in a browser or messaging app",
    description: "A screenshot was opened by a browser, messaging, email or cloud app - usually a sign it was sent or uploaded.",
    category: "Screen capture",
    kind: "count",
    types: ["SCREENSHOT_OPENED"],
    window: "day",
    thresholdLabel: "Screenshots shared per day",
    defaults: { enabled: true, threshold: 1, points: 15, severity: "MEDIUM" },
    filter: (e) => SHARING_APPS.has(String(detailOf(e).process ?? "").toLowerCase()),
    alertTitle: (n) => `${plural(n, "screenshot")} opened in a browser or messaging app`,
  },
  {
    key: "USB_MASS_COPY",
    title: "Many files copied to USB",
    description: "A large number of files copied to a USB or removable drive within one hour.",
    category: "Data movement",
    kind: "count",
    types: ["USB_COPY"],
    window: "hour",
    thresholdLabel: "Files per hour",
    defaults: { enabled: true, threshold: 50, points: 25, severity: "HIGH" },
    alertTitle: (n) => `${plural(n, "file")} copied to USB within an hour`,
  },
  {
    key: "CLOUD_MASS_COPY",
    title: "Many files put in cloud-sync folders",
    description: "A large number of files written into OneDrive, Dropbox or Google Drive folders within one hour.",
    category: "Data movement",
    kind: "count",
    types: ["CLOUD_COPY"],
    window: "hour",
    thresholdLabel: "Files per hour",
    defaults: { enabled: true, threshold: 100, points: 15, severity: "MEDIUM" },
    alertTitle: (n) => `${plural(n, "file")} put in cloud-sync folders within an hour`,
  },
  {
    key: "SHARE_MASS_COPY",
    title: "Many files copied to network drives",
    description: "A large number of files copied onto mapped network drives within one hour.",
    category: "Data movement",
    kind: "count",
    types: ["SHARE_COPY"],
    window: "hour",
    thresholdLabel: "Files per hour",
    defaults: { enabled: true, threshold: 100, points: 10, severity: "LOW" },
    alertTitle: (n) => `${plural(n, "file")} copied to network drives within an hour`,
  },
  {
    key: "DLP_REPEATED",
    title: "Repeated DLP matches",
    description: "Several DLP content or file policy matches (alerted or blocked) in a day.",
    category: "DLP",
    kind: "count",
    types: ["DLP_EVENT"],
    window: "day",
    thresholdLabel: "DLP events per day",
    defaults: { enabled: true, threshold: 5, points: 15, severity: "MEDIUM" },
    alertTitle: (n) => `${plural(n, "DLP match", "DLP matches")} in a day`,
  },
  {
    key: "DLP_TO_REMOVABLE",
    title: "Sensitive file written to removable media",
    description: "A DLP policy matched a file being written to a USB or removable drive.",
    category: "DLP",
    kind: "each",
    types: ["DLP_EVENT"],
    defaults: { enabled: true, points: 20, severity: "HIGH" },
    filter: (e) => detailOf(e).removable === true,
    alertTitle: () => "Sensitive file written to removable media",
  },
  {
    key: "EMAIL_PII_BLOCKED",
    title: "Emails with personal data stopped",
    description: "Outgoing emails stopped or warned for personal data in attachments, several times in a day.",
    category: "DLP",
    kind: "count",
    types: ["EMAIL_BLOCKED"],
    window: "day",
    thresholdLabel: "Emails per day",
    defaults: { enabled: true, threshold: 3, points: 15, severity: "MEDIUM" },
    alertTitle: (n) => `${plural(n, "email")} with personal data stopped in a day`,
  },
  {
    key: "USB_DEVICE_BLOCKED",
    title: "Blocked USB devices connected",
    description: "Several blocked USB devices plugged in during a day.",
    category: "EPM",
    kind: "count",
    types: ["USB_DEVICE_BLOCKED"],
    window: "day",
    thresholdLabel: "Devices per day",
    defaults: { enabled: true, threshold: 3, points: 10, severity: "LOW" },
    alertTitle: (n) => `${plural(n, "blocked USB device")} connected in a day`,
  },
  {
    key: "BLOCKED_APP_ATTEMPTS",
    title: "Repeated blocked applications",
    description: "Several attempts to run blocked applications in a day.",
    category: "EPM",
    kind: "count",
    types: ["APP_BLOCKED"],
    window: "day",
    thresholdLabel: "Attempts per day",
    defaults: { enabled: true, threshold: 5, points: 10, severity: "LOW" },
    alertTitle: (n) => `${plural(n, "blocked application launch", "blocked application launches")} in a day`,
  },
  {
    key: "BLOCKED_SCREENSHOT_ATTEMPTS",
    title: "Repeated blocked screenshots",
    description: "Several attempts in a day to take a screenshot where screenshots are blocked (Print Screen, a screenshot tool, or a copied picture).",
    category: "EPM",
    kind: "count",
    types: ["SCREENSHOT_BLOCKED"],
    window: "day",
    thresholdLabel: "Attempts per day",
    defaults: { enabled: true, threshold: 5, points: 10, severity: "LOW" },
    alertTitle: (n) => `${plural(n, "blocked screenshot attempt")} in a day`,
  },
  {
    key: "BLOCKED_COMMAND",
    title: "Blocked command run",
    description: "A command blocked by a command-blocking policy (for example a script or admin tool).",
    category: "EPM",
    kind: "each",
    types: ["COMMAND_BLOCKED"],
    defaults: { enabled: true, points: 15, severity: "MEDIUM" },
    alertTitle: () => "Blocked command run",
  },
  {
    key: "EDR_DETECTION",
    title: "Threat detection",
    description: "An EDR detection of high or critical severity on the user's endpoint.",
    category: "Security",
    kind: "each",
    types: ["EDR_DETECTION"],
    defaults: { enabled: true, points: 25, severity: "HIGH" },
    filter: (e) => ["HIGH", "CRITICAL"].includes(String(detailOf(e).severity ?? "").toUpperCase()),
    alertTitle: () => "High-severity threat detection",
  },
  {
    key: "OFF_HOURS_LOGON",
    title: "Sign-in outside working hours",
    description: "A sign-in outside the working hours and days set below.",
    category: "Sign-ins",
    kind: "each",
    types: ["LOGON"],
    defaults: { enabled: true, points: 10, severity: "LOW" },
    filter: (e, ctx) => isOffHours(e.occurredAt, ctx.settings),
    alertTitle: () => "Sign-in outside working hours",
  },
  {
    key: "FAILED_LOGONS",
    title: "Repeated failed sign-ins",
    description: "Many failed sign-ins to one account within an hour - password guessing, or someone trying another person's account.",
    category: "Sign-ins",
    kind: "count",
    types: ["FAILED_LOGON"],
    window: "hour",
    thresholdLabel: "Failed sign-ins per hour",
    defaults: { enabled: true, threshold: 10, points: 20, severity: "HIGH" },
    alertTitle: (n) => `${plural(n, "failed sign-in")} within an hour`,
  },
  {
    key: "ADMIN_GROUP_ADD",
    title: "User added to local Administrators",
    description: "Someone was given administrator rights on an endpoint.",
    category: "Endpoint tampering",
    kind: "each",
    types: ["ADMIN_GROUP_ADD"],
    defaults: { enabled: true, points: 30, severity: "HIGH" },
    alertTitle: () => "User added to local Administrators",
  },
  {
    key: "LOG_CLEARED",
    title: "Event log cleared",
    description: "The Windows Security or System event log was cleared - a common way to cover tracks.",
    category: "Endpoint tampering",
    kind: "each",
    types: ["LOG_CLEARED"],
    defaults: { enabled: true, points: 40, severity: "CRITICAL" },
    alertTitle: () => "Windows event log cleared",
  },
  {
    key: "SECURITY_OFF",
    title: "Antivirus or firewall turned off",
    description: "Antivirus real-time protection or a Windows Firewall profile was switched off.",
    category: "Endpoint tampering",
    kind: "each",
    types: ["SECURITY_OFF"],
    defaults: { enabled: true, points: 25, severity: "HIGH" },
    alertTitle: () => "Antivirus or firewall turned off",
  },
  {
    key: "REMOTE_TOOL_INSTALLED",
    title: "Remote access or VPN tool installed",
    description: "A remote-control, tunnelling or VPN tool (AnyDesk, TeamViewer, UltraViewer, ngrok, a VPN...) was installed.",
    category: "Endpoint tampering",
    kind: "each",
    types: ["SOFTWARE_INSTALLED"],
    defaults: { enabled: true, points: 20, severity: "HIGH" },
    filter: (e) => REMOTE_TOOL_PATTERN.test(String(detailOf(e).name ?? "")),
    alertTitle: () => "Remote access or VPN tool installed",
  },
  {
    key: "MASS_DELETE",
    title: "Many files deleted",
    description: "A large number of files deleted from a user's Documents, Desktop, Downloads, Pictures or OneDrive within an hour - sabotage, or ransomware-like behaviour.",
    category: "Endpoint tampering",
    kind: "count",
    types: ["FILES_DELETED"],
    window: "hour",
    thresholdLabel: "Files deleted per hour",
    defaults: { enabled: true, threshold: 200, points: 25, severity: "HIGH" },
    weight: (e) => Number(detailOf(e).count ?? 1),
    alertTitle: (n) => `${plural(n, "file")} deleted within an hour`,
  },
  {
    key: "COMBO_PROTECTION_OFF_THEN_TRANSFER",
    title: "Protection off, then files moved out",
    description: "Antivirus or firewall turned off, followed within 2 hours by files copied to USB or a cloud-sync folder by the same user.",
    category: "Combined",
    kind: "combo",
    types: ["SECURITY_OFF", "USB_COPY", "CLOUD_COPY"],
    defaults: { enabled: true, points: 40, severity: "CRITICAL" },
    alertTitle: () => "Protection turned off, then files moved out",
  },
  {
    key: "UNUSUAL_ACTIVITY",
    title: "Unusual activity for this user",
    description: "A user does far more of something in a day than they usually do (compared with their own last 30 days): files copied out, screenshots, DLP matches, deletions or failed sign-ins.",
    category: "Baseline",
    kind: "baseline",
    types: ["USB_COPY", "CLOUD_COPY", "SHARE_COPY", "SCREENSHOT", "DLP_EVENT", "FILES_DELETED", "FAILED_LOGON"],
    thresholdLabel: "At least this many in the day",
    defaults: { enabled: true, threshold: 20, points: 20, severity: "MEDIUM" },
    alertTitle: () => "Unusual activity",
  },
  {
    key: "COMBO_DLP_THEN_TRANSFER",
    title: "Sensitive data, then files moved out",
    description: "A DLP match followed within 60 minutes by files copied to USB or a cloud-sync folder by the same user.",
    category: "Combined",
    kind: "combo",
    types: ["DLP_EVENT", "USB_COPY", "CLOUD_COPY"],
    defaults: { enabled: true, points: 35, severity: "CRITICAL" },
    alertTitle: () => "Sensitive data matched, then files moved out within an hour",
  },
  {
    key: "COMBO_SCREENSHOT_EXFIL",
    title: "Screenshot shared, then deleted",
    description: `A screenshot opened in a browser or messaging app and then deleted within ${QUICK_DELETE_MINUTES} minutes of being taken.`,
    category: "Combined",
    kind: "combo",
    types: ["SCREENSHOT_OPENED", "SCREENSHOT_DELETED"],
    defaults: { enabled: true, points: 35, severity: "CRITICAL" },
    alertTitle: () => "Screenshot shared, then deleted",
  },
];

export const DEFAULT_SETTINGS: UserRiskSettings = {
  autoLinkEmails: true,
  identityLinks: [],
  timezone: "Asia/Kolkata",
  workStartHour: 9,
  workEndHour: 19,
  workDays: [1, 2, 3, 4, 5, 6],
  excludedUsers: [],
  retentionDays: 90,
  rules: Object.fromEntries(RULES.map((r) => [r.key, r.defaults])),
};

export function ruleSetting(settings: UserRiskSettings, rule: RuleDefinition): UserRiskRuleSetting {
  return { ...rule.defaults, ...(settings.rules[rule.key] ?? {}) };
}

export interface AlertDraft {
  dedupeKey: string;
  userKey: string;
  username: string;
  ruleKey: string;
  severity: UserRiskSeverity;
  points: number;
  title: string;
  detail: string;
  eventIds: string[];
  windowStart: Date;
  windowEnd: Date;
}

function draft(rule: RuleDefinition, setting: UserRiskRuleSetting, bucket: string, events: ActivityRow[], title: string): AlertDraft {
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const lines = sorted.slice(0, 5).map((e) => e.summary);
  const more = sorted.length > 5 ? ` (+${sorted.length - 5} more)` : "";
  return {
    dedupeKey: `${rule.key}|${sorted[0].userKey}|${bucket}`,
    userKey: sorted[0].userKey,
    username: sorted[0].username,
    ruleKey: rule.key,
    severity: setting.severity,
    points: setting.points,
    title,
    detail: (lines.join("\n") + more).slice(0, 2000),
    eventIds: sorted.slice(0, 200).map((e) => e.id),
    windowStart: sorted[0].occurredAt,
    windowEnd: sorted[sorted.length - 1].occurredAt,
  };
}

function bucketOf(e: ActivityRow, window: "hour" | "day", timezone: string): string {
  if (window === "day") return localParts(e.occurredAt, timezone).day;
  return e.occurredAt.toISOString().slice(0, 13); // UTC hour
}

// Alerts the given activity (one user's or everyone's) raises under the current settings.
export function evaluate(events: ActivityRow[], settings: UserRiskSettings): AlertDraft[] {
  const ctx: RuleContext = { settings };
  const excluded = new Set(settings.excludedUsers.map((u) => normaliseUserKey(u)));
  const active = events.filter((e) => !excluded.has(e.userKey));
  const out: AlertDraft[] = [];

  for (const rule of RULES) {
    const setting = ruleSetting(settings, rule);
    if (!setting.enabled) continue;
    const matching = active.filter((e) => (rule.types as string[]).includes(e.type) && (!rule.filter || rule.filter(e, ctx)));

    if (rule.kind === "each") {
      for (const e of matching) out.push(draft(rule, setting, e.id, [e], rule.alertTitle(1, 1)));
    } else if (rule.kind === "count") {
      const threshold = setting.threshold ?? rule.defaults.threshold ?? 1;
      const groups = new Map<string, ActivityRow[]>();
      for (const e of matching) {
        const key = `${e.userKey}|${bucketOf(e, rule.window!, settings.timezone)}`;
        groups.set(key, [...(groups.get(key) ?? []), e]);
      }
      for (const [key, group] of groups) {
        const total = rule.weight ? group.reduce((sum, e) => sum + rule.weight!(e), 0) : group.length;
        if (total >= threshold) out.push(draft(rule, setting, key.slice(key.indexOf("|") + 1), group, rule.alertTitle(total, threshold)));
      }
    } else if (rule.kind === "combo") {
      out.push(...evaluateCombo(rule, setting, matching));
    }
    // "baseline" rules need weeks of history - see evaluateBaselines.
  }
  return out;
}

function evaluateCombo(rule: RuleDefinition, setting: UserRiskRuleSetting, events: ActivityRow[]): AlertDraft[] {
  const out: AlertDraft[] = [];
  if (rule.key === "COMBO_DLP_THEN_TRANSFER") {
    const byUser = new Map<string, ActivityRow[]>();
    for (const e of events) byUser.set(e.userKey, [...(byUser.get(e.userKey) ?? []), e]);
    for (const list of byUser.values()) {
      for (const dlp of list.filter((e) => e.type === "DLP_EVENT")) {
        const t = dlp.occurredAt.getTime();
        const moves = list.filter((e) => (e.type === "USB_COPY" || e.type === "CLOUD_COPY") && e.occurredAt.getTime() >= t && e.occurredAt.getTime() - t <= 60 * 60_000);
        if (moves.length > 0) out.push(draft(rule, setting, dlp.id, [dlp, ...moves], rule.alertTitle(1, 1)));
      }
    }
  } else if (rule.key === "COMBO_PROTECTION_OFF_THEN_TRANSFER") {
    const byUser = new Map<string, ActivityRow[]>();
    for (const e of events) byUser.set(e.userKey, [...(byUser.get(e.userKey) ?? []), e]);
    for (const list of byUser.values()) {
      for (const off of list.filter((e) => e.type === "SECURITY_OFF")) {
        const t = off.occurredAt.getTime();
        const moves = list.filter((e) => (e.type === "USB_COPY" || e.type === "CLOUD_COPY") && e.occurredAt.getTime() >= t && e.occurredAt.getTime() - t <= 2 * 60 * 60_000);
        if (moves.length > 0) out.push(draft(rule, setting, off.id, [off, ...moves], rule.alertTitle(1, 1)));
      }
    }
  } else if (rule.key === "COMBO_SCREENSHOT_EXFIL") {
    // Both events carry the screenshot's own id as detail.captureId.
    const byCapture = new Map<string, ActivityRow[]>();
    for (const e of events) {
      const captureId = String(detailOf(e).captureId ?? "");
      if (captureId) byCapture.set(captureId, [...(byCapture.get(captureId) ?? []), e]);
    }
    for (const [captureId, list] of byCapture) {
      const shared = list.some((e) => e.type === "SCREENSHOT_OPENED" && SHARING_APPS.has(String(detailOf(e).process ?? "").toLowerCase()));
      const quickDelete = list.some((e) => e.type === "SCREENSHOT_DELETED" && Number(detailOf(e).minutesAfter ?? Infinity) <= QUICK_DELETE_MINUTES);
      if (shared && quickDelete) out.push(draft(rule, setting, captureId, list, rule.alertTitle(1, 1)));
    }
  }
  return out;
}

// ---- baselines

const BASELINE_LABEL: Record<string, string> = {
  USB_COPY: "files copied to USB",
  CLOUD_COPY: "files put in cloud-sync folders",
  SHARE_COPY: "files copied to network drives",
  SCREENSHOT: "screenshots",
  DLP_EVENT: "DLP matches",
  FILES_DELETED: "files deleted",
  FAILED_LOGON: "failed sign-ins",
};
export const BASELINE_DAYS = 30;
const BASELINE_MIN_HISTORY_DAYS = 7; // need at least a week of the user's own history
const BASELINE_SIGMA = 3;

// Today's total per user and activity type against that user's own daily totals over the
// previous 30 days (days without activity count as 0, from the user's first active day).
// Flags a day at least `threshold` big and above mean + 3 standard deviations, and at least
// three times the usual amount.
export function evaluateBaselines(events: ActivityRow[], settings: UserRiskSettings, now = new Date()): AlertDraft[] {
  const rule = RULES.find((r) => r.key === "UNUSUAL_ACTIVITY")!;
  const setting = ruleSetting(settings, rule);
  if (!setting.enabled) return [];
  const minimum = setting.threshold ?? rule.defaults.threshold ?? 20;
  const excluded = new Set(settings.excludedUsers.map((u) => normaliseUserKey(u)));
  const today = localParts(now, settings.timezone).day;
  const weight = (e: ActivityRow) => (e.type === "FILES_DELETED" ? Number(detailOf(e).count ?? 1) : 1);

  // user|type -> day -> total, and today's events
  const totals = new Map<string, Map<string, number>>();
  const todays = new Map<string, ActivityRow[]>();
  const firstDay = new Map<string, string>();
  for (const e of events) {
    if (excluded.has(e.userKey) || !(rule.types as string[]).includes(e.type)) continue;
    const day = localParts(e.occurredAt, settings.timezone).day;
    const key = `${e.userKey}|${e.type}`;
    const byDay = totals.get(key) ?? new Map<string, number>();
    byDay.set(day, (byDay.get(day) ?? 0) + weight(e));
    totals.set(key, byDay);
    if (day === today) todays.set(key, [...(todays.get(key) ?? []), e]);
    if (!firstDay.has(e.userKey) || day < firstDay.get(e.userKey)!) firstDay.set(e.userKey, day);
  }

  const out: AlertDraft[] = [];
  for (const [key, todayEvents] of todays) {
    const [userKey, type] = [key.slice(0, key.lastIndexOf("|")), key.slice(key.lastIndexOf("|") + 1)];
    const byDay = totals.get(key)!;
    const value = byDay.get(today) ?? 0;
    if (value < minimum) continue;
    // Previous days of this user's history, oldest first, zero-filled.
    const history: number[] = [];
    const start = firstDay.get(userKey)!;
    for (let i = BASELINE_DAYS; i >= 1; i--) {
      const day = localParts(new Date(now.getTime() - i * 24 * 60 * 60_000), settings.timezone).day;
      if (day >= start) history.push(byDay.get(day) ?? 0);
    }
    if (history.length < BASELINE_MIN_HISTORY_DAYS) continue;
    const mean = history.reduce((s, v) => s + v, 0) / history.length;
    const sd = Math.sqrt(history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length);
    if (value <= mean + BASELINE_SIGMA * sd || value < 3 * Math.max(mean, 1)) continue;
    const usual = mean < 1 ? "usually none" : `usually about ${Math.round(mean)} a day`;
    out.push(draft(rule, setting, `${type}|${today}`, todayEvents, `Unusual: ${value} ${BASELINE_LABEL[type] ?? type} today (${usual})`));
  }
  return out;
}

// "SSSIL\Kundan" / "kundan@corp.local" / "Kundan" -> "kundan". Email senders stay full addresses.
export function normaliseUserKey(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v.includes("@") && !v.includes("\\")) return v;
  return v.slice(v.lastIndexOf("\\") + 1);
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Which user an identity belongs to: Windows names as they are; an email sender becomes the
// Windows user it is linked to (manually, or automatically by matching name), else stays itself.
export function identityResolver(settings: Pick<UserRiskSettings, "autoLinkEmails" | "identityLinks">, windowsUserKeys: string[]) {
  const manual = new Map(settings.identityLinks.map((l) => [l.email.toLowerCase(), normaliseUserKey(l.userKey)]));
  const byCompact = new Map<string, string>();
  for (const k of windowsUserKeys) if (!k.includes("@") && compact(k)) byCompact.set(compact(k), k);
  return (rawUsername: string): { userKey: string; auto: boolean } => {
    const key = normaliseUserKey(rawUsername);
    if (!key.includes("@")) return { userKey: key, auto: false };
    const linked = manual.get(key);
    if (linked) return { userKey: linked, auto: false };
    if (settings.autoLinkEmails) {
      const hit = byCompact.get(compact(key.split("@")[0]));
      if (hit) return { userKey: hit, auto: true };
    }
    return { userKey: key, auto: false };
  };
}

// Risk score 0-100: points of the user's alerts in the last 7 days, each fading linearly to
// zero over those 7 days. Alerts closed as false positives don't count.
export function riskScore(alerts: { points: number; windowEnd: Date; status: string }[], now = new Date()): number {
  const WEEK = 7 * 24 * 60 * 60_000;
  let total = 0;
  for (const a of alerts) {
    if (a.status === "CLOSED_FALSE") continue;
    const age = now.getTime() - a.windowEnd.getTime();
    if (age < 0 || age > WEEK) continue;
    total += a.points * (1 - age / WEEK);
  }
  return Math.min(100, Math.round(total));
}

export function riskLevel(score: number): UserRiskSeverity {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}
