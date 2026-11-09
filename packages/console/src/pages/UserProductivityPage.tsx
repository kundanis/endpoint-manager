import { useState } from "react";
import { AppWindow, Clock, Coffee, Globe, History, Monitor, SearchX, UserCheck, X } from "lucide-react";
import type { AppUsageKind } from "@em/shared";
import { useAgentUserProductivityDailyLog, useAgentUserSessions, useAppUsage, useUserProductivitySummary } from "../api/hooks";
import EndpointLabel from "../components/EndpointLabel";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Kpi,
  KpiStrip,
  Legend,
  PageHeader,
  Pagination,
  SearchInput,
  Segmented,
  Skeleton,
  Toolbar,
  usePagedList,
} from "../components/ui";
import { CHART_SEMANTIC, CHART_SERIES } from "../chartTheme";
import { formatDate, formatDateTime, formatTime } from "../format";

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function isToday(isoDate: string): boolean {
  const d = new Date(isoDate);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// Rows shown in the "active vs idle" chart; the full list is in the table below it.
const CHART_ROWS = 8;

const RIGHT = { textAlign: "right" } as const;

// Rows shown before "Show all" in the applications/websites card.
const USAGE_ROWS = 10;

// Time per application or website - for every endpoint (no agentId) or one, today by default.
// Collected by the Endpoint IQ icon on each PC (agent 0.2.23+): only the program's name and a
// website's domain, never window titles or page addresses.
function AppUsageCard({ agentId, hostname, from, to }: { agentId?: string; hostname?: string; from?: string; to?: string }) {
  const [kind, setKind] = useState<AppUsageKind>("APP");
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, error, refetch } = useAppUsage(kind, agentId, from, to);
  const rows = data ?? [];
  const total = rows.reduce((sum, r) => sum + r.activeSeconds, 0);
  const shown = showAll ? rows : rows.slice(0, USAGE_ROWS);
  const period = from || to ? "in the chosen dates" : "today";
  const noun = kind === "APP" ? "applications" : "websites";

  return (
    <Card
      title={
        hostname ? (
          <>
            Applications and websites — <span className="ep-mono">{hostname}</span>
          </>
        ) : (
          "Applications and websites today"
        )
      }
      hint={`active time ${period}, most used first`}
      actions={
        <Segmented
          label="Show"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setShowAll(false);
          }}
          options={[
            { value: "APP", label: "Applications" },
            { value: "WEB", label: "Websites" },
          ]}
        />
      }
    >
      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <Alert tone="critical" title={`Couldn't load ${noun}`} action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
          {(error as Error).message}
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState icon={kind === "APP" ? AppWindow : Globe} title={`No ${noun} recorded ${period}`}>
          The Endpoint IQ icon on each PC (agent 0.2.23 or later) reports the active {kind === "APP" ? "application" : "browser tab's website"}{" "}
          every 5 minutes while the user isn't idle.
        </EmptyState>
      ) : (
        <>
          <table className="ep-cov">
            <thead>
              <tr>
                <th scope="col">{kind === "APP" ? "Application" : "Website"}</th>
                <th scope="col">Share of time</th>
                <th scope="col" style={RIGHT}>
                  Active
                </th>
                <th scope="col" style={RIGHT}>
                  Users
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key}>
                  <td className="ep-n" style={{ width: 240 }}>
                    {r.label}
                    {kind === "APP" && r.label.toLowerCase() !== r.key && <small className="ep-mono">{r.key}.exe</small>}
                  </td>
                  <td>
                    <div className="ep-sbar" title={`${percent(r.activeSeconds, total)}% of the time recorded`}>
                      <i style={{ width: `${(r.activeSeconds / total) * 100}%`, background: CHART_SERIES[0] }} />
                    </div>
                  </td>
                  <td className="ep-t" style={{ width: 90 }}>
                    {formatDuration(r.activeSeconds)}
                  </td>
                  <td className="ep-t" style={{ width: 70 }}>
                    {r.users}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > USAGE_ROWS && (
            <div className="app-actions-row" style={{ marginTop: 12 }}>
              <Button size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? `Show top ${USAGE_ROWS}` : `Show all ${rows.length}`}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default function UserProductivityPage() {
  const { data: summary, isLoading, error, refetch } = useUserProductivitySummary();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const { data: sessions, isLoading: sessionsLoading } = useAgentUserSessions(selectedAgentId);
  const { data: dailyLogs, isLoading: dailyLoading } = useAgentUserProductivityDailyLog(selectedAgentId, fromDate || undefined, toDate || undefined);

  const selectedHostname = summary?.find((a) => a.agentId === selectedAgentId)?.hostname;
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const rows = summary ?? [];
  const term = search.trim().toLowerCase();
  const filteredRows = rows.filter(
    (a) => !term || a.hostname.toLowerCase().includes(term) || a.activeUsernames.some((u) => u.toLowerCase().includes(term)),
  );
  const paged = usePagedList(filteredRows, 25);
  const sessionsPaged = usePagedList(sessions ?? [], 25);
  const dailyPaged = usePagedList(dailyLogs ?? [], 25);

  const totalActive = rows.reduce((sum, a) => sum + a.totalActiveSecondsToday, 0);
  const totalIdle = rows.reduce((sum, a) => sum + a.totalIdleSecondsToday, 0);
  const activeUserCount = rows.reduce((sum, a) => sum + a.activeUsernames.length, 0);
  const endpointsWithUsers = rows.filter((a) => a.activeUsernames.length > 0).length;
  const chartRows = [...rows]
    .map((a) => ({ ...a, total: a.totalActiveSecondsToday + a.totalIdleSecondsToday }))
    .sort((a, b) => b.total - a.total)
    .slice(0, CHART_ROWS);

  function selectAgent(agentId: string) {
    setSelectedAgentId((prev) => (prev === agentId ? undefined : agentId));
    setFromDate("");
    setToDate("");
  }

  const description = (
    <>
      Logon/logoff activity and active vs idle time per endpoint, from Windows session enumeration (<span className="ep-mono">quser</span>) on a
      5-minute cycle, plus the time spent in each application and on each website (application name and website domain only). Always-on,
      passive tracking — not a policy, so every enrolled endpoint reports this automatically. Today: {todayLabel}
    </>
  );

  if (isLoading) {
    return (
      <>
        <PageHeader title="User productivity" description={description} />
        <Card>
          <Skeleton lines={6} />
        </Card>
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="User productivity" description={description} />
        <Alert tone="critical" title="Couldn't load user productivity" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
          {(error as Error).message}
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="User productivity" description={description} />

      <KpiStrip>
        <Kpi icon={Monitor} label="Endpoints reporting" value={rows.length} suffix="today" />
        <Kpi
          icon={UserCheck}
          label="Signed-in users"
          value={activeUserCount}
          suffix={`on ${endpointsWithUsers} of ${rows.length} endpoints`}
        />
        <Kpi
          icon={Clock}
          label="Active time today"
          value={formatDuration(totalActive)}
          suffix={`${percent(totalActive, totalActive + totalIdle)}%`}
          bar={[
            { value: totalActive, color: CHART_SEMANTIC.ok },
            { value: totalIdle, color: CHART_SEMANTIC.neutral },
          ]}
        />
        <Kpi icon={Coffee} label="Idle time today" value={formatDuration(totalIdle)} suffix={`${percent(totalIdle, totalActive + totalIdle)}%`} />
      </KpiStrip>

      <Card
        title="Active vs idle today"
        hint={rows.length > CHART_ROWS ? `top ${CHART_ROWS} endpoints by time signed in` : "time signed in per endpoint"}
        actions={
          <Legend
            items={[
              { label: "Active", color: CHART_SEMANTIC.ok },
              { label: "Idle", color: CHART_SEMANTIC.neutral },
            ]}
          />
        }
      >
        {chartRows.every((a) => a.total === 0) ? (
          <EmptyState icon={Clock} title="No session activity recorded yet today">
            Endpoints report signed-in time every 5 minutes; check back once users sign in.
          </EmptyState>
        ) : (
          <table className="ep-cov">
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">Active vs idle</th>
                <th scope="col" style={RIGHT}>
                  Active
                </th>
                <th scope="col" style={RIGHT}>
                  Idle
                </th>
              </tr>
            </thead>
            <tbody>
              {chartRows.map((a) => (
                <tr key={a.agentId} className="app-clickable" onClick={() => selectAgent(a.agentId)}>
                  <td className="ep-n" style={{ width: 190 }}>
                    {a.hostname}
                    <small>{a.activeUsernames.length > 0 ? a.activeUsernames.join(", ") : "No one signed in"}</small>
                  </td>
                  <td>
                    {a.total > 0 ? (
                      <div className="ep-sbar">
                        <i style={{ width: `${(a.totalActiveSecondsToday / a.total) * 100}%`, background: CHART_SEMANTIC.ok }} />
                        <i style={{ width: `${(a.totalIdleSecondsToday / a.total) * 100}%`, background: CHART_SEMANTIC.neutral }} />
                      </div>
                    ) : (
                      <span className="ep-nodata">No signed-in time today</span>
                    )}
                  </td>
                  <td className="ep-t" style={{ width: 90 }}>
                    {formatDuration(a.totalActiveSecondsToday)}
                  </td>
                  <td className="ep-t" style={{ width: 90 }}>
                    {formatDuration(a.totalIdleSecondsToday)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <AppUsageCard />

      <Card flush title="Endpoints today" hint="select an endpoint to see its session and daily history">
        <Toolbar>
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search hostname or user…" />
        </Toolbar>
        {rows.length === 0 ? (
          <EmptyState icon={Monitor} title="No session activity recorded yet today">
            Every enrolled endpoint reports automatically; rows appear after its first 5-minute scan.
          </EmptyState>
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No endpoints match this search"
            action={
              <Button size="sm" onClick={() => setSearch("")}>
                Clear search
              </Button>
            }
          />
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Endpoint</th>
                    <th scope="col">Active users</th>
                    <th scope="col" style={RIGHT}>
                      Active time today
                    </th>
                    <th scope="col" style={RIGHT}>
                      Idle time today
                    </th>
                    <th scope="col">First login today</th>
                    <th scope="col">Last logout today</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.pageItems.map((a) => (
                    <tr
                      key={a.agentId}
                      className={`app-clickable ${a.agentId === selectedAgentId ? "ep-sel" : ""}`}
                      onClick={() => selectAgent(a.agentId)}
                      aria-selected={a.agentId === selectedAgentId}
                    >
                      <td>
                        <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
                      </td>
                      <td>
                        {a.activeUsernames.length > 0 ? (
                          <Badge tone="ok">{a.activeUsernames.join(", ")}</Badge>
                        ) : (
                          <span className="app-muted">—</span>
                        )}
                      </td>
                      <td className="ep-num" style={RIGHT}>
                        {formatDuration(a.totalActiveSecondsToday)}
                      </td>
                      <td className="ep-num" style={RIGHT}>
                        {formatDuration(a.totalIdleSecondsToday)}
                      </td>
                      <td className="app-muted">{formatTime(a.firstLoginAtToday)}</td>
                      <td className="app-muted">{formatTime(a.lastLogoutAtToday)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              noun="endpoints"
              onPageChange={paged.setPage}
              onPageSizeChange={paged.setPageSize}
            />
          </>
        )}
      </Card>

      {selectedAgentId && (
        <Card
          flush
          title={
            <>
              Session history — <span className="ep-mono">{selectedHostname}</span>
            </>
          }
          actions={<IconButton icon={X} label="Close endpoint history" onClick={() => setSelectedAgentId(undefined)} />}
        >
          {sessionsLoading ? (
            <div className="ep-cb">
              <Skeleton />
            </div>
          ) : !sessions || sessions.length === 0 ? (
            <EmptyState icon={History} title="No sessions recorded for this endpoint yet">
              Sessions appear after the next 5-minute scan once a user signs in.
            </EmptyState>
          ) : (
            <>
              <div className="app-table-scroll">
                <table className="ep-tbl">
                  <thead>
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col">Login</th>
                      <th scope="col">Logout</th>
                      <th scope="col" style={RIGHT}>
                        Active
                      </th>
                      <th scope="col" style={RIGHT}>
                        Idle
                      </th>
                      <th scope="col" style={RIGHT}>
                        Total on endpoint
                      </th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionsPaged.pageItems.map((s) => (
                      <tr key={s.id}>
                        <td className="ep-mono">{s.username}</td>
                        <td className="app-muted">{formatDateTime(s.loginAt)}</td>
                        <td className="app-muted">{formatDateTime(s.logoutAt)}</td>
                        <td className="ep-num" style={RIGHT}>
                          {formatDuration(s.activeSecondsTotal)}
                        </td>
                        <td className="ep-num" style={RIGHT}>
                          {formatDuration(s.idleSecondsTotal)}
                        </td>
                        <td className="ep-num" style={RIGHT}>
                          {formatDuration(s.activeSecondsTotal + s.idleSecondsTotal)}
                        </td>
                        <td>{s.isActive ? <Badge tone="ok">Active</Badge> : <Badge tone="med">Logged out</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={sessionsPaged.page}
                pageSize={sessionsPaged.pageSize}
                total={sessionsPaged.total}
                noun="sessions"
                onPageChange={sessionsPaged.setPage}
                onPageSizeChange={sessionsPaged.setPageSize}
              />
            </>
          )}
        </Card>
      )}

      {selectedAgentId && (
        <AppUsageCard key={selectedAgentId} agentId={selectedAgentId} hostname={selectedHostname} from={fromDate || undefined} to={toDate || undefined} />
      )}

      {selectedAgentId && (
        <Card
          flush
          title={
            <>
              Daily history — <span className="ep-mono">{selectedHostname}</span>
            </>
          }
        >
          <div className="ep-cb" style={{ paddingTop: 0 }}>
            <p className="app-text">
              One row per user per calendar day, saved as each scan comes in — the historical record survives even after
              individual login sessions age out. Shows the last 10 working days by default, or pick a custom range below.
            </p>
          </div>
          <Toolbar
            right={
              (fromDate || toDate) && (
                <Button
                  size="sm"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                  }}
                >
                  Clear (last 10 working days)
                </Button>
              )
            }
          >
            <Field label="From" htmlFor="up-from-date">
              <input id="up-from-date" className="ep-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="up-to-date">
              <input id="up-to-date" className="ep-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </Field>
          </Toolbar>
          {dailyLoading ? (
            <div className="ep-cb">
              <Skeleton />
            </div>
          ) : !dailyLogs || dailyLogs.length === 0 ? (
            <EmptyState icon={History} title="No daily history recorded for this endpoint yet">
              {fromDate || toDate ? "Try a wider date range, or clear it to see the last 10 working days." : "A row is saved per user per day as scans come in."}
            </EmptyState>
          ) : (
            <>
              <div className="app-table-scroll">
                <table className="ep-tbl">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">User</th>
                      <th scope="col">First login</th>
                      <th scope="col">Last logout</th>
                      <th scope="col" style={RIGHT}>
                        Active
                      </th>
                      <th scope="col" style={RIGHT}>
                        Idle
                      </th>
                      <th scope="col" style={RIGHT}>
                        Total on endpoint
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyPaged.pageItems.map((l) => (
                      <tr key={l.id}>
                        <td>{formatDate(l.logDate)}</td>
                        <td className="ep-mono">{l.username}</td>
                        <td className="app-muted">{formatDateTime(l.firstLoginAt)}</td>
                        <td className="app-muted">
                          {l.lastLogoutAt ? (
                            formatDateTime(l.lastLogoutAt)
                          ) : isToday(l.logDate) ? (
                            "—"
                          ) : (
                            <span title="Never signed out this day — session carried on to the next day">
                              Still signed in (last seen {formatDateTime(l.lastSeenAt)})
                            </span>
                          )}
                        </td>
                        <td className="ep-num" style={RIGHT}>
                          {formatDuration(l.activeSecondsTotal)}
                        </td>
                        <td className="ep-num" style={RIGHT}>
                          {formatDuration(l.idleSecondsTotal)}
                        </td>
                        <td className="ep-num" style={RIGHT}>
                          {formatDuration(l.activeSecondsTotal + l.idleSecondsTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={dailyPaged.page}
                pageSize={dailyPaged.pageSize}
                total={dailyPaged.total}
                noun="days"
                onPageChange={dailyPaged.setPage}
                onPageSizeChange={dailyPaged.setPageSize}
              />
            </>
          )}
        </Card>
      )}
    </>
  );
}
