import { Fragment, useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { Bell, ChevronDown, ChevronRight, Download, RefreshCw, SearchX, ShieldAlert, UserCheck, Users } from "lucide-react";
import {
  useRunUserRisk,
  useSaveUserRiskSettings,
  useUpdateUserRiskAlert,
  useUserRiskAlertEvents,
  useUserRiskAlerts,
  useUserRiskIdentities,
  useUserRiskNotifications,
  useSaveUserRiskNotifications,
  useTestUserRiskEmail,
  useUserRiskOverview,
  useUserRiskSettings,
  useUserRiskUsers,
} from "../api/hooks";
import type { UserRiskAlert, UserRiskAlertStatus, UserRiskNotificationsInput, UserRiskRuleSetting, UserRiskSettings, UserRiskSeverity } from "../api/types";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  FormFooter,
  FormGrid,
  IconButton,
  Kpi,
  KpiStrip,
  PageHeader,
  Pagination,
  Skeleton,
  Switch,
  Tabs,
  Tag,
  Toolbar,
  usePagedList,
  useToast,
} from "../components/ui";
import type { BadgeTone } from "../components/ui/status";
import { csvDate, downloadCsv } from "../csv";
import { formatDateTime } from "../format";

// Identity Governance -> User Risk. Activity from every module is combined per user; built-in
// rules raise alerts, and each user's risk score (0-100) is the sum of their recent alerts'
// points, fading over 7 days. Tabs: Risky users / Alerts / Rules & settings; a user opens their
// own page with score trend, alerts and the full activity timeline.

export const SEVERITY_TONE: Record<UserRiskSeverity, BadgeTone> = { CRITICAL: "crit", HIGH: "high", MEDIUM: "med", LOW: "low" };
export const SEVERITY_LABEL: Record<UserRiskSeverity, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
const STATUS_LABEL: Record<UserRiskAlertStatus, string> = {
  NEW: "New",
  INVESTIGATING: "Investigating",
  CLOSED_TRUE: "Closed - confirmed",
  CLOSED_FALSE: "Closed - false positive",
};
const STATUS_TONE: Record<UserRiskAlertStatus, BadgeTone> = { NEW: "high", INVESTIGATING: "med", CLOSED_TRUE: "neu", CLOSED_FALSE: "ok" };

export function RiskBadge({ score, level }: { score: number; level: UserRiskSeverity }) {
  return (
    <Badge tone={SEVERITY_TONE[level]}>
      <span className="ep-num">{score}</span> · {SEVERITY_LABEL[level]}
    </Badge>
  );
}

export function exportAlerts(filename: string, alerts: UserRiskAlert[]) {
  downloadCsv(
    filename,
    ["When", "User", "Alert", "Rule", "Severity", "Status", "Points", "Events", "Details", "Notes"],
    alerts.map((a) => [
      csvDate(a.windowEnd),
      a.username,
      a.title,
      a.ruleTitle,
      SEVERITY_LABEL[a.severity],
      STATUS_LABEL[a.status],
      a.points,
      a.eventCount,
      a.detail,
      a.notes.map((n) => `${csvDate(n.at)} ${n.by}: ${n.text}`).join(" | "),
    ]),
  );
}

export const userPath = (userKey: string) => `/user-risk/user/${encodeURIComponent(userKey)}`;

const TABS = [
  { to: "users", label: "Risky users" },
  { to: "alerts", label: "Alerts" },
  { to: "settings", label: "Rules & settings" },
];

export default function UserRiskPage() {
  const run = useRunUserRisk();
  const toast = useToast();
  return (
    <>
      <PageHeader
        title="User Risk"
        description="Combines activity from screen capture, data movement, DLP, EPM blocking, threat detection and sign-ins into one risk score per user, and raises alerts for suspicious patterns."
        actions={
          <Button
            icon={RefreshCw}
            disabled={run.isPending}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: (r) => toast(`Updated: ${r.collected} new ${r.collected === 1 ? "activity" : "activities"}, ${r.alerts} new ${r.alerts === 1 ? "alert" : "alerts"}.`),
              })
            }
          >
            {run.isPending ? "Updating…" : "Update now"}
          </Button>
        }
      />
      <Tabs items={TABS} />
      <Outlet />
    </>
  );
}

const PERIODS = [
  { days: 1, label: "Last 24 hours" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
];

type LevelFilter = "all" | UserRiskSeverity;

export function UserRiskUsersTab() {
  const [days, setDays] = useState(7);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const { data: overview } = useUserRiskOverview();
  const { data: users, isLoading, error } = useUserRiskUsers(days);
  const navigate = useNavigate();

  const term = search.trim().toLowerCase();
  const rows = (users ?? [])
    .filter((u) => level === "all" || u.level === level)
    .filter((u) => !term || u.username.toLowerCase().includes(term) || u.endpoints.some((h) => h.toLowerCase().includes(term)));
  const paged = usePagedList(rows, 25);
  const openAlerts = Object.values(overview?.openAlerts ?? {}).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <div className="app-stack">
      <KpiStrip>
        <Kpi
          icon={ShieldAlert}
          label="Critical risk"
          value={overview?.usersByLevel.CRITICAL ?? "—"}
          suffix="users"
          valueTone={overview && overview.usersByLevel.CRITICAL > 0 ? "critical" : undefined}
          active={level === "CRITICAL"}
          onClick={() => setLevel("CRITICAL")}
        />
        <Kpi
          icon={ShieldAlert}
          label="High risk"
          value={overview?.usersByLevel.HIGH ?? "—"}
          suffix="users"
          valueTone={overview && overview.usersByLevel.HIGH > 0 ? "warning" : undefined}
          active={level === "HIGH"}
          onClick={() => setLevel("HIGH")}
        />
        <Kpi icon={Users} label="Monitored users" value={overview?.monitoredUsers ?? "—"} footer="with activity in 7 days" active={level === "all"} onClick={() => setLevel("all")} />
        <Kpi icon={Bell} label="Open alerts" value={openAlerts} to="/user-risk/alerts" footer={overview?.lastRunAt ? `Updated ${formatDateTime(overview.lastRunAt)}` : "Not run yet"} />
      </KpiStrip>

      <Card flush title="Users" hint="Score 0-100 from the last 7 days of alerts, fading with age">
        <Toolbar>
          <input type="search" className="ep-input" placeholder="Search user or endpoint…" aria-label="Search user or endpoint" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="ep-select" aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((p) => (
              <option key={p.days} value={p.days}>
                {p.label}
              </option>
            ))}
          </select>
          <Button
            icon={Download}
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                "user-risk-users.csv",
                ["User", "Endpoints", "Risk score", "Risk level", "Alerts", "Open alerts", "Main signals", "Last activity"],
                rows.map((u) => [u.username, u.endpoints.join("; "), u.score, SEVERITY_LABEL[u.level], u.alertCount, u.openAlertCount, u.topRules.map((r) => r.title).join("; "), csvDate(u.lastActivityAt)]),
              )
            }
          >
            Export CSV
          </Button>
        </Toolbar>
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert tone="critical" title="Couldn't load users">
              {(error as Error).message}
            </Alert>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={(users?.length ?? 0) > 0 ? SearchX : UserCheck} title={(users?.length ?? 0) > 0 ? "No user matches" : "No user activity yet"}>
            {(users?.length ?? 0) > 0
              ? "Change the search or the risk filter."
              : "Activity appears here as endpoints report screenshots, file copies, DLP matches, blocked apps, threats and sign-ins. Select Update now to collect immediately."}
          </EmptyState>
        ) : (
          <div className="app-table-wrap">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Endpoints</th>
                  <th scope="col">Risk</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Alerts
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Open
                  </th>
                  <th scope="col">Main signals</th>
                  <th scope="col">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((u) => (
                  <tr key={u.userKey} className="app-clickable" onClick={() => navigate(userPath(u.userKey))}>
                    <td className="ep-host">
                      <Link className="ep-link" to={userPath(u.userKey)} onClick={(e) => e.stopPropagation()}>
                        <b>{u.username}</b>
                      </Link>
                    </td>
                    <td className="ep-mono">{u.endpoints.join(", ") || "—"}</td>
                    <td>
                      <RiskBadge score={u.score} level={u.level} />
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {u.alertCount}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {u.openAlertCount > 0 ? <Badge tone="high">{u.openAlertCount}</Badge> : <span className="app-muted">0</span>}
                    </td>
                    <td>
                      {u.topRules.length > 0 ? (
                        <div className="app-badge-row">
                          {u.topRules.map((r) => (
                            <Tag key={r.ruleKey}>
                              {r.title}
                              {r.count > 1 ? ` ×${r.count}` : ""}
                            </Tag>
                          ))}
                        </div>
                      ) : (
                        <span className="app-muted">—</span>
                      )}
                    </td>
                    <td className="app-muted">{formatDateTime(u.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} noun="users" onPageChange={paged.setPage} onPageSizeChange={paged.setPageSize} />
          </div>
        )}
      </Card>
    </div>
  );
}

// ---- Alerts

function AlertDetail({ alert }: { alert: UserRiskAlert }) {
  const { data: events, isLoading } = useUserRiskAlertEvents(alert.id);
  const update = useUpdateUserRiskAlert();
  const [note, setNote] = useState("");

  return (
    <div className="app-stack">
      <div className="app-stack-sm">
        <span className="app-subhead">What Happened</span>
        {isLoading ? (
          <Skeleton lines={3} />
        ) : !events || events.length === 0 ? (
          <span className="app-muted">The activity behind this alert is older than the retention period.</span>
        ) : (
          <table className="ep-tbl">
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="ep-num" style={{ whiteSpace: "nowrap" }}>
                    {formatDateTime(e.occurredAt)}
                  </td>
                  <td>{e.summary}</td>
                  <td className="ep-mono">{e.hostname ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {alert.eventCount > (events?.length ?? 0) && events && events.length > 0 && <span className="app-muted">Showing the first {events.length} of {alert.eventCount}.</span>}
      </div>

      <div className="app-stack-sm">
        <span className="app-subhead">Investigation</span>
        {alert.notes.length > 0 && (
          <ul className="app-stack-sm" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {alert.notes.map((n, i) => (
              <li key={i}>
                <span className="app-muted">
                  {formatDateTime(n.at)} · {n.by}:
                </span>{" "}
                {n.text}
              </li>
            ))}
          </ul>
        )}
        <div className="app-actions-row">
          <select
            className="ep-select"
            aria-label="Alert status"
            value={alert.status}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ id: alert.id, status: e.target.value })}
          >
            {(Object.keys(STATUS_LABEL) as UserRiskAlertStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <input className="ep-input" placeholder="Add a note…" aria-label="Add a note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          <Button
            size="sm"
            disabled={!note.trim() || update.isPending}
            onClick={() => update.mutate({ id: alert.id, note: note.trim() }, { onSuccess: () => setNote("") })}
          >
            Add note
          </Button>
        </div>
        {update.isError && <Alert tone="critical">{(update.error as Error).message}</Alert>}
      </div>
    </div>
  );
}

export function AlertsTable({ alerts, showUser = true }: { alerts: UserRiskAlert[]; showUser?: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const paged = usePagedList(alerts, 25);
  const cols = showUser ? 7 : 6;
  return (
    <div className="app-table-wrap">
      <table className="ep-tbl">
        <thead>
          <tr>
            <th scope="col">
              <span className="app-vh">Expand</span>
            </th>
            <th scope="col">When</th>
            {showUser && <th scope="col">User</th>}
            <th scope="col">Alert</th>
            <th scope="col">Severity</th>
            <th scope="col">Status</th>
            <th scope="col" style={{ textAlign: "right" }}>
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {paged.pageItems.map((a) => {
            const open = expanded === a.id;
            return (
              <Fragment key={a.id}>
                <tr>
                  <td className="ep-cb">
                    <IconButton icon={open ? ChevronDown : ChevronRight} label={open ? `Hide details of ${a.title}` : `Show details of ${a.title}`} onClick={() => setExpanded(open ? null : a.id)} />
                  </td>
                  <td className="ep-num" style={{ whiteSpace: "nowrap" }}>
                    {formatDateTime(a.windowEnd)}
                  </td>
                  {showUser && (
                    <td>
                      <Link className="ep-link" to={userPath(a.userKey)}>
                        {a.username}
                      </Link>
                    </td>
                  )}
                  <td>
                    <b>{a.title}</b>
                    <span className="app-row-sub">{a.ruleTitle}</span>
                  </td>
                  <td>
                    <Badge tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</Badge>
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                  </td>
                  <td className="ep-num" style={{ textAlign: "right" }}>
                    {a.points}
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={cols} style={{ background: "var(--ep-surface-2)" }}>
                      <AlertDetail alert={a} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} noun="alerts" onPageChange={paged.setPage} onPageSizeChange={paged.setPageSize} />
    </div>
  );
}

export function UserRiskAlertsTab() {
  const [status, setStatus] = useState("OPEN");
  const [severity, setSeverity] = useState("");
  const [days, setDays] = useState(30);
  const { data: alerts, isLoading, error } = useUserRiskAlerts({ days, status, severity });

  return (
    <Card flush title="Alerts" hint={alerts ? `${alerts.length} shown` : undefined}>
      <Toolbar>
        <select className="ep-select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="OPEN">Status: Open (new + investigating)</option>
          <option value="">Status: All</option>
          {(Object.keys(STATUS_LABEL) as UserRiskAlertStatus[]).map((s) => (
            <option key={s} value={s}>
              Status: {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select className="ep-select" aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">Severity: All</option>
          {(Object.keys(SEVERITY_LABEL) as UserRiskSeverity[]).map((s) => (
            <option key={s} value={s}>
              Severity: {SEVERITY_LABEL[s]}
            </option>
          ))}
        </select>
        <select className="ep-select" aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
        <Button icon={Download} disabled={!alerts || alerts.length === 0} onClick={() => exportAlerts("user-risk-alerts.csv", alerts ?? [])}>
          Export CSV
        </Button>
      </Toolbar>
      {isLoading ? (
        <div className="ep-cb">
          <Skeleton />
        </div>
      ) : error ? (
        <div className="ep-cb">
          <Alert tone="critical" title="Couldn't load alerts">
            {(error as Error).message}
          </Alert>
        </div>
      ) : !alerts || alerts.length === 0 ? (
        <EmptyState icon={Bell} title="No alerts">
          Nothing matches these filters.
        </EmptyState>
      ) : (
        <AlertsTable alerts={alerts} />
      )}
    </Card>
  );
}

// ---- Rules & settings

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SEVERITIES: UserRiskSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// Alert emails and the weekly summary, over the organisation's own SMTP server.
function EmailNotifications() {
  const { data } = useUserRiskNotifications();
  const save = useSaveUserRiskNotifications();
  const test = useTestUserRiskEmail();
  const toast = useToast();
  const [form, setForm] = useState<UserRiskNotificationsInput | null>(null);
  const [recipientsText, setRecipientsText] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!data) return;
    const { smtp, lastError: _e, lastSentAt: _s, ...rest } = data;
    setForm({ ...rest, smtp: { host: smtp.host, port: smtp.port, secure: smtp.secure, username: smtp.username, from: smtp.from } });
    setRecipientsText(data.recipients.join("\n"));
  }, [data]);

  if (!data || !form) return <Skeleton lines={4} />;
  const set = (patch: Partial<UserRiskNotificationsInput>) => setForm({ ...form, ...patch });
  const setSmtp = (patch: Partial<UserRiskNotificationsInput["smtp"]>) => setForm({ ...form, smtp: { ...form.smtp, ...patch } });

  function handleSave() {
    const recipients = recipientsText
      .split(/[\r\n,;]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    save.mutate(
      { ...form!, recipients, smtp: { ...form!.smtp, ...(password ? { password } : {}) } },
      { onSuccess: () => (setPassword(""), toast("Email settings saved.")) },
    );
  }

  return (
    <Card title="Email Notifications" hint="Alert emails and a weekly summary, sent through your own mail server">
      <div className="app-stack">
        <Check checked={form.enabled} onChange={(c) => set({ enabled: c })} label="Send email notifications" />
        <FormGrid>
          <Field label="Recipients" htmlFor="ur-mail-to" span2 help="One per line, e.g. the IT security team or HR.">
            <textarea id="ur-mail-to" className="ep-textarea ep-mono" rows={2} value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)} />
          </Field>
          <Field label="Email me about alerts of" htmlFor="ur-mail-sev">
            <select id="ur-mail-sev" className="ep-select" value={form.minSeverity} onChange={(e) => set({ minSeverity: e.target.value as UserRiskSeverity })}>
              <option value="CRITICAL">Critical only</option>
              <option value="HIGH">High and critical</option>
              <option value="MEDIUM">Medium and above</option>
              <option value="LOW">Every alert</option>
            </select>
          </Field>
          <Field label="Console address for links" htmlFor="ur-mail-url" help="Optional, e.g. https://epp.company.com">
            <input id="ur-mail-url" className="ep-input" value={form.consoleUrl ?? ""} onChange={(e) => set({ consoleUrl: e.target.value.trim() || null })} />
          </Field>
        </FormGrid>
        <div className="app-actions-row">
          <Check checked={form.weeklyDigest} onChange={(c) => set({ weeklyDigest: c })} label="Weekly summary of the riskiest users, every" />
          <select className="ep-select" aria-label="Summary day" value={form.digestWeekday} onChange={(e) => set({ digestWeekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <select className="ep-select" aria-label="Summary time" value={form.digestHour} onChange={(e) => set({ digestHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>

        <span className="app-subhead">Mail Server (SMTP)</span>
        <FormGrid>
          <Field label="Server" htmlFor="ur-smtp-host" help="e.g. smtp.office365.com or smtp.gmail.com">
            <input id="ur-smtp-host" className="ep-input" value={form.smtp.host} onChange={(e) => setSmtp({ host: e.target.value })} />
          </Field>
          <Field label="Port" htmlFor="ur-smtp-port" help="587 (STARTTLS) or 465 (TLS)">
            <input
              id="ur-smtp-port"
              type="number"
              className="ep-input"
              value={form.smtp.port}
              onChange={(e) => {
                const port = Math.floor(Number(e.target.value) || 0);
                setSmtp({ port, secure: port === 465 ? true : port === 587 ? false : form.smtp.secure });
              }}
            />
          </Field>
          <Field label="Sign-in name" htmlFor="ur-smtp-user" help="Leave blank for a relay without sign-in.">
            <input id="ur-smtp-user" className="ep-input" autoComplete="off" value={form.smtp.username ?? ""} onChange={(e) => setSmtp({ username: e.target.value.trim() || null })} />
          </Field>
          <Field label="Password" htmlFor="ur-smtp-pass" help={data.smtp.passwordSet ? "Saved. Type a new one to replace it." : "Stored encrypted."}>
            <input id="ur-smtp-pass" type="password" className="ep-input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={data.smtp.passwordSet ? "••••••••" : ""} />
          </Field>
          <Field label="Send from" htmlFor="ur-smtp-from" help="Usually the sign-in mailbox, e.g. alerts@company.com">
            <input id="ur-smtp-from" className="ep-input" value={form.smtp.from} onChange={(e) => setSmtp({ from: e.target.value })} />
          </Field>
          <Field label="Encryption" htmlFor="ur-smtp-secure">
            <select id="ur-smtp-secure" className="ep-select" value={form.smtp.secure ? "tls" : "starttls"} onChange={(e) => setSmtp({ secure: e.target.value === "tls" })}>
              <option value="starttls">STARTTLS (port 587 / 25)</option>
              <option value="tls">TLS (port 465)</option>
            </select>
          </Field>
        </FormGrid>
        {data.lastError && <Alert tone="critical" title="Last email failed">{data.lastError}</Alert>}
        {data.lastSentAt && !data.lastError && <span className="app-muted">Last email sent {formatDateTime(data.lastSentAt)}.</span>}
        {save.isError && <Alert tone="critical">{(save.error as Error).message}</Alert>}
        {test.isError && <Alert tone="critical">{(test.error as Error).message}</Alert>}
        <div className="app-actions-row app-end">
          <Button disabled={test.isPending} onClick={() => test.mutate(undefined, { onSuccess: () => toast("Test email sent. Check the recipients' inboxes.") })}>
            {test.isPending ? "Sending…" : "Send test email"}
          </Button>
          <Button variant="primary" disabled={save.isPending} onClick={handleSave}>
            {save.isPending ? "Saving…" : "Save email settings"}
          </Button>
        </div>
        <span className="app-muted">Save first, then send a test. Microsoft 365 and Google need SMTP sign-in allowed for the sending mailbox (or an app password).</span>
      </div>
    </Card>
  );
}

const SEPARATE = "__separate";

// Email senders (from email blocking) linked to Windows users, so one person has one score.
function IdentityLinks({ settings, onChange }: { settings: UserRiskSettings; onChange: (next: UserRiskSettings) => void }) {
  const { data } = useUserRiskIdentities();
  const manual = new Map(settings.identityLinks.map((l) => [l.email, l.userKey]));

  function choose(email: string, value: string) {
    const rest = settings.identityLinks.filter((l) => l.email !== email);
    const link = value === "" ? null : { email, userKey: value === SEPARATE ? email : value };
    onChange({ ...settings, identityLinks: link ? [...rest, link] : rest });
  }

  return (
    <Card title="Email Addresses" hint="Email blocking reports senders by address; link each to the Windows user it belongs to">
      <div className="app-stack">
        <Check
          checked={settings.autoLinkEmails}
          onChange={(c) => onChange({ ...settings, autoLinkEmails: c })}
          label="Link automatically when the names match"
          hint="kundan.zamwar@company.com goes with Windows user “kundan zamwar” (dots, spaces and case ignored)"
        />
        {!data ? (
          <Skeleton lines={2} />
        ) : data.emails.length === 0 ? (
          <span className="app-muted">No email senders recorded yet.</span>
        ) : (
          <div className="app-table-wrap">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Email address</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Activity
                  </th>
                  <th scope="col">Belongs to</th>
                </tr>
              </thead>
              <tbody>
                {data.emails.map((e) => {
                  const m = manual.get(e.email);
                  const value = m === undefined ? "" : m === e.email ? SEPARATE : m;
                  return (
                    <tr key={e.email}>
                      <td className="ep-mono">{e.email}</td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {e.activityCount}
                      </td>
                      <td>
                        <select className="ep-select" aria-label={`User for ${e.email}`} value={value} onChange={(ev) => choose(e.email, ev.target.value)}>
                          <option value="">{e.auto && m === undefined ? `Automatic: ${e.linkedTo}` : settings.autoLinkEmails ? "Automatic (no match)" : "Not linked"}</option>
                          <option value={SEPARATE}>Keep separate</option>
                          {data.windowsUsers.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

export function UserRiskSettingsTab() {
  const { data, isLoading, error } = useUserRiskSettings();
  const save = useSaveUserRiskSettings();
  const toast = useToast();
  const [settings, setSettings] = useState<UserRiskSettings | null>(null);
  const [excludedText, setExcludedText] = useState("");

  useEffect(() => {
    if (data) {
      setSettings(data.settings);
      setExcludedText(data.settings.excludedUsers.join("\n"));
    }
  }, [data]);

  if (isLoading || !settings || !data) return error ? <Alert tone="critical">{(error as Error).message}</Alert> : <Skeleton />;

  const setRule = (key: string, patch: Partial<UserRiskRuleSetting>) =>
    setSettings({ ...settings, rules: { ...settings.rules, [key]: { ...data.rules.find((r) => r.key === key)!.setting, ...settings.rules[key], ...patch } } });
  const ruleOf = (key: string) => ({ ...data.rules.find((r) => r.key === key)!.setting, ...settings.rules[key] });

  function handleSave() {
    const excludedUsers = excludedText
      .split(/\r?\n|,/)
      .map((u) => u.trim())
      .filter(Boolean);
    save.mutate({ ...settings!, excludedUsers }, { onSuccess: () => toast("User risk settings saved. They apply from the next update.") });
  }

  const categories = [...new Set(data.rules.map((r) => r.category))];

  return (
    <div className="app-stack">
      <Card title="Working Hours and Users">
        <div className="app-stack">
          <FormGrid>
            <Field label="Time zone" htmlFor="ur-tz" help="Used for working hours and per-day counts, e.g. Asia/Kolkata.">
              <input id="ur-tz" className="ep-input" value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} />
            </Field>
            <Field label="Keep activity for (days)" htmlFor="ur-retention" help="Alerts are kept for a year.">
              <input
                id="ur-retention"
                type="number"
                min={7}
                max={730}
                className="ep-input"
                value={settings.retentionDays}
                onChange={(e) => setSettings({ ...settings, retentionDays: Math.floor(Number(e.target.value) || 0) })}
              />
            </Field>
            <Field label="Working hours start" htmlFor="ur-start">
              <select id="ur-start" className="ep-select" value={settings.workStartHour} onChange={(e) => setSettings({ ...settings, workStartHour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Working hours end" htmlFor="ur-end">
              <select id="ur-end" className="ep-select" value={settings.workEndHour} onChange={(e) => setSettings({ ...settings, workEndHour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </Field>
          </FormGrid>
          <div className="app-stack-sm" role="group" aria-label="Working days">
            <span className="app-subhead">Working Days</span>
            <div className="app-badge-row">
              {WEEKDAYS.map((d, i) => (
                <Check
                  key={d}
                  label={d}
                  checked={settings.workDays.includes(i)}
                  onChange={(c) => setSettings({ ...settings, workDays: c ? [...settings.workDays, i].sort() : settings.workDays.filter((x) => x !== i) })}
                />
              ))}
            </div>
          </div>
          <Field label="Excluded users" htmlFor="ur-excluded" help="One per line, e.g. IT administrators or service accounts. Their activity is still recorded but never raises alerts.">
            <textarea id="ur-excluded" className="ep-textarea ep-mono" rows={3} value={excludedText} onChange={(e) => setExcludedText(e.target.value)} />
          </Field>
        </div>
      </Card>

      <IdentityLinks settings={settings} onChange={setSettings} />

      <Card flush title="Rules" hint="Points add to the user's risk score; 75+ is critical, 50+ high, 25+ medium">
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">On</th>
                <th scope="col">Threshold</th>
                <th scope="col">Severity</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <Fragment key={cat}>
                  <tr>
                    <td colSpan={5} style={{ background: "var(--ep-surface-2)" }}>
                      <span className="app-subhead">{cat}</span>
                    </td>
                  </tr>
                  {data.rules
                    .filter((r) => r.category === cat)
                    .map((r) => {
                      const s = ruleOf(r.key);
                      return (
                        <tr key={r.key}>
                          <td>
                            <b>{r.title}</b>
                            <span className="app-row-sub">{r.description}</span>
                          </td>
                          <td>
                            <Switch checked={s.enabled} onChange={(enabled) => setRule(r.key, { enabled })} label={s.enabled ? "On" : "Off"} />
                          </td>
                          <td>
                            {r.kind === "count" || r.kind === "baseline" ? (
                              <input
                                type="number"
                                min={1}
                                className="ep-input"
                                style={{ width: 96 }}
                                aria-label={`${r.title}: ${r.thresholdLabel}`}
                                title={r.thresholdLabel ?? undefined}
                                value={s.threshold ?? 1}
                                onChange={(e) => setRule(r.key, { threshold: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                              />
                            ) : (
                              <span className="app-muted">Each time</span>
                            )}
                            {r.thresholdLabel && <span className="app-row-sub">{r.thresholdLabel}</span>}
                          </td>
                          <td>
                            <select className="ep-select" aria-label={`${r.title}: severity`} value={s.severity} onChange={(e) => setRule(r.key, { severity: e.target.value as UserRiskSeverity })}>
                              {SEVERITIES.map((sev) => (
                                <option key={sev} value={sev}>
                                  {SEVERITY_LABEL[sev]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              className="ep-input"
                              style={{ width: 80 }}
                              aria-label={`${r.title}: points`}
                              value={s.points}
                              onChange={(e) => setRule(r.key, { points: Math.min(100, Math.max(0, Math.floor(Number(e.target.value) || 0))) })}
                            />
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {save.isError && <Alert tone="critical">{(save.error as Error).message}</Alert>}
      <FormFooter>
        {save.isSuccess && !save.isPending && <span className="app-saved">Saved</span>}
        <Button variant="primary" onClick={handleSave} disabled={save.isPending || settings.workDays.length === 0}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </FormFooter>

      <EmailNotifications />
    </div>
  );
}
