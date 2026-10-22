import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, History, SearchX } from "lucide-react";
import { useUserRiskUser, useUserTimeline } from "../api/hooks";
import EndpointLabel from "../components/EndpointLabel";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Pagination, Skeleton, Toolbar, usePagedList } from "../components/ui";
import { csvDate, downloadCsv } from "../csv";
import { formatDateTime } from "../format";
import { AlertsTable, exportAlerts, RiskBadge, SEVERITY_LABEL } from "./UserRiskPage";

// One user's risk: current score and its 14-day trend, their alerts (with investigation), and
// everything they did across modules, newest first.

const TYPE_LABEL: Record<string, string> = {
  SCREENSHOT: "Screenshot",
  SCREENSHOT_DELETED: "Screenshot deleted",
  SCREENSHOT_OPENED: "Screenshot opened",
  USB_COPY: "Copied to USB",
  CLOUD_COPY: "Copied to cloud folder",
  SHARE_COPY: "Copied to network drive",
  DLP_EVENT: "DLP match",
  EMAIL_BLOCKED: "Email stopped",
  USB_DEVICE_BLOCKED: "USB device blocked",
  APP_BLOCKED: "Application blocked",
  COMMAND_BLOCKED: "Command blocked",
  EDR_DETECTION: "Threat detection",
  LOGON: "Sign-in",
  FAILED_LOGON: "Failed sign-in",
  ADMIN_GROUP_ADD: "Made administrator",
  LOG_CLEARED: "Event log cleared",
  SECURITY_OFF: "Protection turned off",
  SOFTWARE_INSTALLED: "Software installed",
  FILES_DELETED: "Files deleted",
};

const TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: "All activity", types: [] },
  { label: "Screenshots", types: ["SCREENSHOT", "SCREENSHOT_DELETED", "SCREENSHOT_OPENED"] },
  { label: "File copies", types: ["USB_COPY", "CLOUD_COPY", "SHARE_COPY"] },
  { label: "DLP and email", types: ["DLP_EVENT", "EMAIL_BLOCKED"] },
  { label: "Blocked actions", types: ["USB_DEVICE_BLOCKED", "APP_BLOCKED", "COMMAND_BLOCKED"] },
  { label: "Threats", types: ["EDR_DETECTION"] },
  { label: "Sign-ins", types: ["LOGON", "FAILED_LOGON"] },
  { label: "Endpoint changes", types: ["ADMIN_GROUP_ADD", "LOG_CLEARED", "SECURITY_OFF", "SOFTWARE_INSTALLED", "FILES_DELETED"] },
];

function ScoreTrend({ history }: { history: { day: string; score: number }[] }) {
  return (
    <div className="app-risk-trend" role="img" aria-label={`Risk score over the last ${history.length} days: ${history.map((h) => h.score).join(", ")}`}>
      {history.map((h) => (
        <div key={h.day} className="app-risk-trend-col" title={`${h.day}: ${h.score}`}>
          <div
            className={`app-risk-trend-bar ${h.score >= 75 ? "is-crit" : h.score >= 50 ? "is-high" : h.score >= 25 ? "is-med" : "is-low"}`}
            style={{ height: `${Math.max(2, h.score)}%` }}
          />
          <span className="app-risk-trend-day">{h.day.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

export default function UserRiskUserPage() {
  const { userKey = "" } = useParams();
  const { data: user, isLoading, error } = useUserRiskUser(userKey);
  const [days, setDays] = useState(7);
  const [group, setGroup] = useState(0);
  const { data: timeline, isLoading: timelineLoading } = useUserTimeline(userKey, days, TYPE_GROUPS[group].types);
  const paged = usePagedList(timeline ?? [], 50);

  const back = (
    <Link className="ep-link" to="/user-risk/users">
      <ArrowLeft size={14} strokeWidth={1.7} aria-hidden /> All users
    </Link>
  );

  if (isLoading) return <Skeleton />;
  if (error || !user)
    return (
      <div className="app-stack">
        {back}
        <Alert tone="critical" title="Couldn't load this user">
          {(error as Error | undefined)?.message ?? "No activity recorded for this user."}
        </Alert>
      </div>
    );

  const open = user.alerts.filter((a) => a.status === "NEW" || a.status === "INVESTIGATING").length;

  return (
    <div className="app-stack">
      {back}
      <PageHeader
        title={user.username}
        description={`Risk ${user.score} of 100 (${SEVERITY_LABEL[user.level].toLowerCase()}) · ${user.alerts.length} ${user.alerts.length === 1 ? "alert" : "alerts"}, ${open} open`}
        actions={
          <>
            <RiskBadge score={user.score} level={user.level} />
            <Button icon={Download} disabled={user.alerts.length === 0} onClick={() => exportAlerts(`user-risk-${user.userKey}-alerts.csv`, user.alerts)}>
              Export alerts
            </Button>
          </>
        }
      />

      <Card title="Risk score, last 14 days" hint="End-of-day score">
        <ScoreTrend history={user.history} />
      </Card>

      <Card flush title="Alerts" hint={`${user.alerts.length} total`}>
        {user.alerts.length === 0 ? (
          <EmptyState icon={History} title="No alerts for this user" />
        ) : (
          <AlertsTable alerts={user.alerts} showUser={false} />
        )}
      </Card>

      <Card flush title="Activity timeline" hint={timeline ? `${timeline.length}${timeline.length === 1000 ? "+" : ""} events` : undefined}>
        <Toolbar>
          <select className="ep-select" aria-label="Activity type" value={group} onChange={(e) => setGroup(Number(e.target.value))}>
            {TYPE_GROUPS.map((g, i) => (
              <option key={g.label} value={i}>
                {g.label}
              </option>
            ))}
          </select>
          <select className="ep-select" aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <Button
            icon={Download}
            disabled={!timeline || timeline.length === 0}
            onClick={() =>
              downloadCsv(
                `user-risk-${user.userKey}-activity.csv`,
                ["When", "Type", "What", "Endpoint"],
                (timeline ?? []).map((e) => [csvDate(e.occurredAt), TYPE_LABEL[e.type] ?? e.type, e.summary, e.hostname ?? ""]),
              )
            }
          >
            Export CSV
          </Button>
        </Toolbar>
        {timelineLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : !timeline || timeline.length === 0 ? (
          <EmptyState icon={SearchX} title="No activity in this period" />
        ) : (
          <div className="app-table-wrap">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Type</th>
                  <th scope="col">What</th>
                  <th scope="col">Endpoint</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((e) => (
                  <tr key={e.id}>
                    <td className="ep-num" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(e.occurredAt)}
                    </td>
                    <td>
                      <Badge tone="neu">{TYPE_LABEL[e.type] ?? e.type}</Badge>
                    </td>
                    <td style={{ overflowWrap: "anywhere" }}>{e.summary}</td>
                    <td>{e.hostname ? <EndpointLabel hostname={e.hostname} agentId={e.agentId} hideUser /> : <span className="app-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} noun="events" onPageChange={paged.setPage} onPageSizeChange={paged.setPageSize} />
          </div>
        )}
      </Card>
    </div>
  );
}
