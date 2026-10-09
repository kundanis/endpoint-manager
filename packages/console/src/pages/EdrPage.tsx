import { useState } from "react";
import { useEdrAgents, useEdrEvents, useQuarantineAgent, useReleaseAgent, useSetEdrEnabled } from "../api/hooks";
import type { EdrAgentSummaryView } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import EndpointLabel, { EndpointOption } from "../components/EndpointLabel";

const CATEGORY_LABEL: Record<string, string> = {
  PROCESS: "Suspicious process",
  PERSISTENCE: "New persistence entry",
};

function DetailSummary({ category, detail }: { category: string; detail: Record<string, unknown> }) {
  if (category === "PROCESS") {
    return (
      <span className="mono-cell">
        {String(detail.processName)} (pid {String(detail.processId)})
        {detail.parentProcessName ? ` ← ${detail.parentProcessName}` : ""}
        {detail.commandLine ? `: ${detail.commandLine}` : ""}
      </span>
    );
  }
  return (
    <span className="mono-cell">
      {String(detail.location)} — {String(detail.name)}
      {detail.command ? `: ${detail.command}` : ""}
    </span>
  );
}

function AgentRow({ agent }: { agent: EdrAgentSummaryView }) {
  const setEnabled = useSetEdrEnabled();
  const quarantine = useQuarantineAgent();
  const release = useReleaseAgent();
  const [pending, setPending] = useState(false);

  function handleIsolateToggle() {
    if (agent.quarantined) {
      const confirmed = window.confirm(
        `Release ${agent.hostname} from quarantine?\n\nThis restores normal outbound network access on the endpoint.`,
      );
      if (!confirmed) return;
      setPending(true);
      release.mutate(agent.agentId, { onSettled: () => setPending(false) });
    } else {
      const confirmed = window.confirm(
        `Isolate ${agent.hostname}?\n\nThis locks the endpoint's firewall down to DNS and this server only — ` +
          `all other network access is blocked until you release it. The endpoint must be online to pick up the command.`,
      );
      if (!confirmed) return;
      setPending(true);
      quarantine.mutate(agent.agentId, { onSettled: () => setPending(false) });
    }
  }

  return (
    <tr>
      <td>
        <EndpointLabel hostname={agent.hostname} agentId={agent.agentId} />
      </td>
      <td>
        <input
          type="checkbox"
          checked={agent.edrEnabled}
          onChange={(e) => setEnabled.mutate({ agentId: agent.agentId, enabled: e.target.checked })}
          title="EDR-lite detection enabled on this endpoint"
        />
      </td>
      <td>{agent.eventCount}</td>
      <td>{agent.lastDetectedAt ? new Date(agent.lastDetectedAt).toLocaleString() : "—"}</td>
      <td>
        {agent.quarantined ? (
          <StatusBadge kind="lock" label="Quarantined" />
        ) : (
          <span style={{ color: "var(--text-muted)" }}>Normal</span>
        )}
      </td>
      <td>
        <button type="button" onClick={handleIsolateToggle} disabled={pending}>
          {pending ? "…" : agent.quarantined ? "Release" : "Isolate endpoint"}
        </button>
      </td>
    </tr>
  );
}

export default function EdrPage() {
  const { data: agents } = useEdrAgents();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const { data: events } = useEdrEvents(selectedAgentId);

  return (
    <div>
      <h2>EDR (Lite)</h2>
      <p>
        Built-in process-tree and command-line heuristics (Office/PDF/script apps spawning a command interpreter,
        LOLBin abuse patterns) plus a new-persistence-entry watch (Run keys, services, scheduled tasks), scanned
        every 30 seconds. <strong>This is poll-based detection, not real-time kernel/ETW interception</strong> — it
        can catch persistent or sloppy malware but will miss anything that finishes between scans. High-confidence
        process-tree matches are killed automatically; command-line heuristics are alert-only (a legitimate script
        can occasionally match one of these patterns).
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>EDR enabled</th>
            <th>Events</th>
            <th>Last detection</th>
            <th>Network status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {agents?.map((a) => <AgentRow key={a.agentId} agent={a} />)}
          {agents?.length === 0 && (
            <tr>
              <td colSpan={6}>No endpoints enrolled yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="panel">
        <h2>Events</h2>
        <label>
          Filter by endpoint
          <select value={selectedAgentId ?? ""} onChange={(e) => setSelectedAgentId(e.target.value || undefined)}>
            <option value="">All endpoints</option>
            {agents?.map((a) => (
              <EndpointOption key={a.agentId} value={a.agentId} hostname={a.hostname} agentId={a.agentId} />
            ))}
          </select>
        </label>

        <table className="data-table">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Category</th>
              <th>Severity</th>
              <th>Summary</th>
              <th>Detail</th>
              <th>Killed</th>
              <th>Detected</th>
            </tr>
          </thead>
          <tbody>
            {events?.map((e) => (
              <tr key={e.id}>
                <td>
                  <EndpointLabel hostname={e.hostname} agentId={e.agentId} />
                </td>
                <td>{CATEGORY_LABEL[e.category] ?? e.category}</td>
                <td>
                  {e.severity === "HIGH" ? (
                    <StatusBadge kind="fail" label="High" />
                  ) : (
                    <StatusBadge kind="warn" label="Medium" />
                  )}
                </td>
                <td>{e.summary}</td>
                <td>
                  <DetailSummary category={e.category} detail={e.detail} />
                </td>
                <td>{e.killed ? <StatusBadge kind="pass" label="Killed" /> : "—"}</td>
                <td>{new Date(e.detectedAt).toLocaleString()}</td>
              </tr>
            ))}
            {events?.length === 0 && (
              <tr>
                <td colSpan={7}>No detections yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
