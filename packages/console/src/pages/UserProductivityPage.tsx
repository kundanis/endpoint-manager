import { useState } from "react";
import { useAgentUserProductivityDailyLog, useAgentUserSessions, useUserProductivitySummary } from "../api/hooks";
import StatusBadge from "../components/StatusBadge";
import EndpointLabel from "../components/EndpointLabel";

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

export default function UserProductivityPage() {
  const { data: summary } = useUserProductivitySummary();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const { data: sessions } = useAgentUserSessions(selectedAgentId);
  const { data: dailyLogs } = useAgentUserProductivityDailyLog(selectedAgentId, fromDate || undefined, toDate || undefined);

  const selectedHostname = summary?.find((a) => a.agentId === selectedAgentId)?.hostname;
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  function selectAgent(agentId: string) {
    setSelectedAgentId((prev) => (prev === agentId ? undefined : agentId));
    setFromDate("");
    setToDate("");
  }

  return (
    <div>
      <h2>User Productivity</h2>
      <p>
        Tracks each endpoint's logon/logoff activity and active-vs-idle time via Windows session enumeration
        (<code>quser</code>) on a 5-minute cycle. Always-on, passive tracking — not a policy, so every enrolled
        endpoint reports this automatically.
      </p>
      <p className="hint">Today: {todayLabel}</p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Active users</th>
            <th>Active time today</th>
            <th>Idle time today</th>
            <th>First login today</th>
            <th>Last logout today</th>
          </tr>
        </thead>
        <tbody>
          {summary?.map((a) => (
            <tr
              key={a.agentId}
              className={`clickable-row${a.agentId === selectedAgentId ? " selected-row" : ""}`}
              onClick={() => selectAgent(a.agentId)}
            >
              <td>
                <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
              </td>
              <td>
                {a.activeUsernames.length > 0 ? (
                  <StatusBadge kind="pass" label={a.activeUsernames.join(", ")} />
                ) : (
                  "—"
                )}
              </td>
              <td>{formatDuration(a.totalActiveSecondsToday)}</td>
              <td>{formatDuration(a.totalIdleSecondsToday)}</td>
              <td>{a.firstLoginAtToday ? new Date(a.firstLoginAtToday).toLocaleTimeString() : "—"}</td>
              <td>{a.lastLogoutAtToday ? new Date(a.lastLogoutAtToday).toLocaleTimeString() : "—"}</td>
            </tr>
          ))}
          {summary?.length === 0 && (
            <tr>
              <td colSpan={6}>No session activity recorded yet today.</td>
            </tr>
          )}
        </tbody>
      </table>

      {selectedAgentId && (
        <div className="panel">
          <h2>Session history — {selectedHostname}</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Login</th>
                <th>Logout</th>
                <th>Active</th>
                <th>Idle</th>
                <th>Total on endpoint</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions?.map((s) => (
                <tr key={s.id}>
                  <td>{s.username}</td>
                  <td>{new Date(s.loginAt).toLocaleString()}</td>
                  <td>{s.logoutAt ? new Date(s.logoutAt).toLocaleString() : "—"}</td>
                  <td>{formatDuration(s.activeSecondsTotal)}</td>
                  <td>{formatDuration(s.idleSecondsTotal)}</td>
                  <td>{formatDuration(s.activeSecondsTotal + s.idleSecondsTotal)}</td>
                  <td>
                    {s.isActive ? (
                      <StatusBadge kind="pass" label="Active" />
                    ) : (
                      <StatusBadge kind="warn" label="Logged out" />
                    )}
                  </td>
                </tr>
              ))}
              {sessions?.length === 0 && (
                <tr>
                  <td colSpan={7}>No sessions recorded for this endpoint yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedAgentId && (
        <div className="panel">
          <h2>Daily history — {selectedHostname}</h2>
          <p className="hint">
            One row per user per calendar day, saved as each scan comes in — the historical record survives even
            after individual login sessions age out. Shows the last 10 working days by default, or pick a custom
            range below.
          </p>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", marginBottom: "1rem" }}>
            <label>
              From
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </label>
            {(fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                }}
              >
                Clear (last 10 working days)
              </button>
            )}
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>First login</th>
                <th>Last logout</th>
                <th>Active</th>
                <th>Idle</th>
                <th>Total on endpoint</th>
              </tr>
            </thead>
            <tbody>
              {dailyLogs?.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.logDate).toLocaleDateString()}</td>
                  <td>{l.username}</td>
                  <td>{new Date(l.firstLoginAt).toLocaleTimeString()}</td>
                  <td>
                    {l.lastLogoutAt ? (
                      new Date(l.lastLogoutAt).toLocaleTimeString()
                    ) : isToday(l.logDate) ? (
                      "—"
                    ) : (
                      <span title="Never signed out this day — session carried on to the next day">
                        Still signed in (last seen {new Date(l.lastSeenAt).toLocaleTimeString()})
                      </span>
                    )}
                  </td>
                  <td>{formatDuration(l.activeSecondsTotal)}</td>
                  <td>{formatDuration(l.idleSecondsTotal)}</td>
                  <td>{formatDuration(l.activeSecondsTotal + l.idleSecondsTotal)}</td>
                </tr>
              ))}
              {dailyLogs?.length === 0 && (
                <tr>
                  <td colSpan={7}>No daily history recorded for this endpoint yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
