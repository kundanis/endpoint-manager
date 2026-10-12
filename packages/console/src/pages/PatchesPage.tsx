import { Fragment, useState, type FormEvent } from "react";
import type { NormalizedSeverity } from "../api/types";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import {
  useAgents,
  useAgentsMissingPatch,
  useAssetGroups,
  useAutoPatchPolicies,
  useCreateAutoPatchPolicy,
  useDeleteAutoPatchPolicy,
  useDispatchCommand,
  useDispatchPatchJob,
  usePatchJob,
  usePatchJobs,
  usePatchSummary,
  useUpdateAutoPatchPolicy,
} from "../api/hooks";
import EndpointLabel from "../components/EndpointLabel";

// Per-patch drill-down: the endpoints this update is missing on, each selectable, with a
// one-click dispatch of just this patch to the chosen machines.
function MissingPatchEndpoints({ patchDefinitionId, updateId, title }: { patchDefinitionId: string; updateId: string; title: string }) {
  const { data: missing } = useAgentsMissingPatch(patchDefinitionId);
  const dispatch = useDispatchPatchJob();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);

  if (!missing) return <p style={{ color: "var(--text-muted)" }}>Loading endpoints…</p>;
  if (missing.length === 0) return <p style={{ color: "var(--text-muted)" }}>No endpoints are missing this patch right now.</p>;

  const allSelected = missing.length > 0 && missing.every((m) => selected.has(m.agentId));
  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(missing!.map((m) => m.agentId)));
  }
  function handleDispatch() {
    const agentIds = [...selected];
    if (agentIds.length === 0) return;
    setJobId(null);
    dispatch.mutate(
      { updateIds: [updateId], agentIds, groupIds: [] },
      { onSuccess: (r) => { setJobId(r.jobId); setSelected(new Set()); } },
    );
  }

  return (
    <div style={{ padding: "0.25rem 0 0.5rem" }}>
      <table className="data-table" style={{ margin: "0.25rem 0" }}>
        <thead>
          <tr>
            <th style={{ width: "2rem" }}><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" /></th>
            <th>Endpoint missing "{title}"</th>
            <th>Detected</th>
          </tr>
        </thead>
        <tbody>
          {missing.map((m) => (
            <tr key={m.agentId}>
              <td><input type="checkbox" checked={selected.has(m.agentId)} onChange={() => toggle(m.agentId)} /></td>
              <td><EndpointLabel hostname={m.hostname} agentId={m.agentId} /></td>
              <td>{new Date(m.detectedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={handleDispatch} disabled={selected.size === 0 || dispatch.isPending}>
        {dispatch.isPending ? "Dispatching…" : `Dispatch to selected (${selected.size})`}
      </button>
      {jobId && <span style={{ marginLeft: "0.6rem", fontSize: "0.85rem" }}>Dispatched. Each endpoint installs on its next check-in; track progress under Recent patch jobs below.</span>}
      {dispatch.isError && <span className="error-text" style={{ marginLeft: "0.6rem" }}>{(dispatch.error as Error).message}</span>}
    </div>
  );
}

function formatBytes(bytes: string | null): string {
  if (!bytes) return "—";
  return `${(Number(bytes) / 1024 ** 2).toFixed(1)} MB`;
}

function severityBadgeClass(severity: NormalizedSeverity): string {
  if (severity === "CRITICAL" || severity === "HIGH") return "danger";
  if (severity === "MEDIUM") return "warn";
  if (severity === "LOW") return "online";
  return "offline";
}

const NORMALIZED_SEVERITIES: NormalizedSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
const SEVERITY_LABELS: Record<NormalizedSeverity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNKNOWN: "Unknown",
};

function AutomaticModePanel() {
  const { data: policies } = useAutoPatchPolicies();
  const { data: groups } = useAssetGroups();
  const createPolicy = useCreateAutoPatchPolicy();
  const updatePolicy = useUpdateAutoPatchPolicy();
  const deletePolicy = useDeleteAutoPatchPolicy();

  const [minSeverity, setMinSeverity] = useState<NormalizedSeverity>("CRITICAL");
  const [groupIds, setGroupIds] = useState<string[]>([]);

  function toggleGroup(groupId: string) {
    setGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createPolicy.mutate({ minSeverity, groupIds, enabled: true }, { onSuccess: () => setGroupIds([]) });
  }

  return (
    <div className="panel">
      <h2>Automatic mode</h2>
      <p className="hint">
        A standing policy that auto-dispatches any currently-missing patch at or above the chosen severity, on its
        own — no manual selection needed. Leave "Target groups" empty to cover every enrolled endpoint. Checked
        roughly every couple of minutes.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Enabled</th>
            <th>Minimum severity</th>
            <th>Target groups</th>
            <th>Last ran</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {policies?.map((p) => (
            <tr key={p.id}>
              <td>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => updatePolicy.mutate({ id: p.id, enabled: e.target.checked })}
                />
              </td>
              <td>
                <span className={`status-badge ${severityBadgeClass(p.minSeverity)}`}>
                  {SEVERITY_LABELS[p.minSeverity]}
                </span>{" "}
                and above
              </td>
              <td>{p.groupNames.join(", ") || "All endpoints"}</td>
              <td>{p.lastRunAt ? new Date(p.lastRunAt).toLocaleString() : "Not yet run"}</td>
              <td>
                <button type="button" onClick={() => deletePolicy.mutate(p.id)} disabled={deletePolicy.isPending}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {policies?.length === 0 && (
            <tr>
              <td colSpan={5}>No automatic-mode policies yet — everything is manual dispatch.</td>
            </tr>
          )}
        </tbody>
      </table>

      <form onSubmit={handleCreate} style={{ marginTop: "1rem" }}>
        <label>
          Minimum severity to auto-deploy
          <select value={minSeverity} onChange={(e) => setMinSeverity(e.target.value as NormalizedSeverity)}>
            {NORMALIZED_SEVERITIES.filter((s) => s !== "UNKNOWN").map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]} and above
              </option>
            ))}
          </select>
        </label>
        {groups && groups.length > 0 && (
          <fieldset>
            <legend>Target groups (leave blank for all endpoints)</legend>
            {groups.map((g) => (
              <label key={g.id} className="checkbox-row">
                <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                {g.name} ({g.memberCount})
              </label>
            ))}
          </fieldset>
        )}
        {createPolicy.isError && <p className="error-text">{(createPolicy.error as Error).message}</p>}
        <button type="submit" disabled={createPolicy.isPending}>
          {createPolicy.isPending ? "Adding…" : "Add policy"}
        </button>
      </form>
    </div>
  );
}

export default function PatchesPage() {
  const [environmentFilter, setEnvironmentFilter] = useState("");
  const { data: summary } = usePatchSummary(environmentFilter || undefined);
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: jobs } = usePatchJobs();
  const dispatchPatch = useDispatchPatchJob();
  const dispatchCommand = useDispatchCommand();

  const [selectedUpdateIds, setSelectedUpdateIds] = useState<string[]>([]);
  const [expandedPatchId, setExpandedPatchId] = useState<string | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();

  const { data: jobDetail } = usePatchJob(selectedJobId);

  function toggleUpdate(updateId: string) {
    setSelectedUpdateIds((prev) => (prev.includes(updateId) ? prev.filter((id) => id !== updateId) : [...prev, updateId]));
  }

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  function handleDispatch(e: FormEvent) {
    e.preventDefault();
    dispatchPatch.mutate(
      {
        updateIds: selectedUpdateIds,
        agentIds: selectedAgentIds,
        groupIds: selectedGroupIds,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      },
      { onSuccess: (result) => { setSelectedJobId(result.jobId); setScheduledAt(""); } },
    );
  }

  function rebootNow(agentId: string) {
    dispatchCommand.mutate({
      agentIds: [agentId],
      shell: "powershell",
      script: 'shutdown /r /t 60 /c "Applying Windows updates"',
      timeoutSec: 30,
    });
  }

  return (
    <div>
      <h1>Patches</h1>

      <h2>Missing across the fleet</h2>
      <label style={{ display: "inline-block", marginBottom: "0.75rem" }}>
        Environment
        <select value={environmentFilter} onChange={(e) => setEnvironmentFilter(e.target.value)}>
          <option value="">All endpoints</option>
          {groups?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>Title</th>
            <th>Severity</th>
            <th>KB</th>
            <th>Size</th>
            <th>Missing on</th>
            <th>Detected</th>
          </tr>
        </thead>
        <tbody>
          {summary?.map((item) => {
            const isExpanded = expandedPatchId === item.patchDefinitionId;
            return (
              <Fragment key={item.patchDefinitionId}>
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedUpdateIds.includes(item.updateId)}
                      onChange={() => toggleUpdate(item.updateId)}
                      title="Add to the dispatch form below"
                    />
                  </td>
                  <td>{item.title}</td>
                  <td>
                    {item.severity ? (
                      <span className={`status-badge ${severityBadgeClass(item.normalizedSeverity)}`}>{item.severity}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{item.kbArticleIds.join(", ") || "—"}</td>
                  <td>{formatBytes(item.sizeBytes)}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setExpandedPatchId(isExpanded ? null : item.patchDefinitionId)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", padding: 0, font: "inherit", textDecoration: "underline" }}
                      title="Show the endpoints missing this patch and dispatch to selected"
                    >
                      {isExpanded ? "▾ " : "▸ "}{item.missingAgentCount} endpoint(s)
                    </button>
                  </td>
                  <td>{new Date(item.firstSeenAt).toLocaleDateString()}</td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={7} style={{ background: "var(--stripe)" }}>
                      <MissingPatchEndpoints patchDefinitionId={item.patchDefinitionId} updateId={item.updateId} title={item.title} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {summary?.length === 0 && (
            <tr>
              <td colSpan={7}>No missing patches detected yet — endpoints scan on their own multi-hour cycle.</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="hint">
        Sorted newest first by when each update was first detected as missing across the fleet — the closest available
        proxy for a release date, since no vendor update catalog is synced into this system.
      </p>

      {selectedUpdateIds.length > 0 && (
        <form className="panel" onSubmit={handleDispatch}>
          <h2>Deploy {selectedUpdateIds.length} selected update(s)</h2>
          {groups && groups.length > 0 && (
            <fieldset>
              <legend>Target groups</legend>
              {groups.map((g) => (
                <label key={g.id} className="checkbox-row">
                  <input type="checkbox" checked={selectedGroupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                  {g.name} ({g.memberCount})
                </label>
              ))}
            </fieldset>
          )}
          <EndpointCheckboxList
            agents={agents}
            selectedAgentIds={selectedAgentIds}
            onToggle={toggleAgent}
            selectedGroupIds={selectedGroupIds}
            legend="Target endpoints"
            renderExtra={(agent) => <span className={`status-badge ${agent.status.toLowerCase()}`}>{agent.status}</span>}
          />
          <label>
            Schedule for (leave blank to dispatch immediately)
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </label>
          {dispatchPatch.isError && <p className="error-text">{(dispatchPatch.error as Error).message}</p>}
          <button
            type="submit"
            disabled={dispatchPatch.isPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
          >
            {dispatchPatch.isPending ? "Dispatching…" : scheduledAt ? "Schedule" : "Dispatch"}
          </button>
        </form>
      )}

      <AutomaticModePanel />

      <h2>Patch jobs</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Updates</th>
            <th>Groups</th>
            <th>Created</th>
            <th>Timing</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs?.map((job) => (
            <tr key={job.id} className="clickable-row" onClick={() => setSelectedJobId(job.id)}>
              <td>{job.updateIds.length} update(s)</td>
              <td>{job.targetGroupNames.join(", ") || "—"}</td>
              <td>{new Date(job.createdAt).toLocaleString()}</td>
              <td>
                {job.scheduledAt ? (
                  <span className="status-badge warn">Scheduled for {new Date(job.scheduledAt).toLocaleString()}</span>
                ) : (
                  "Immediate"
                )}
              </td>
              <td>
                {Object.entries(job.taskCounts)
                  .map(([status, count]) => `${status}: ${count}`)
                  .join(", ")}
              </td>
            </tr>
          ))}
          {jobs?.length === 0 && (
            <tr>
              <td colSpan={5}>No patch jobs dispatched yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {jobDetail && (
        <div className="panel">
          <h2>Patch job detail</h2>
          {jobDetail.targetGroupNames.length > 0 && <p>Targeted groups: {jobDetail.targetGroupNames.join(", ")}</p>}
          <table className="data-table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Reboot</th>
                <th>Results</th>
                <th>Message</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobDetail.tasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <EndpointLabel hostname={task.hostname} agentId={task.agentId} />
                  </td>
                  <td>{task.status}</td>
                  <td>{task.rebootRequired ? <span className="status-badge warn">Required</span> : "—"}</td>
                  <td>
                    {task.results.map((r) => (
                      <div key={r.updateId} className="mono-cell">
                        {r.updateId.slice(0, 8)}… → code {r.resultCode}
                      </div>
                    ))}
                  </td>
                  <td>{task.message ?? "—"}</td>
                  <td>
                    {task.rebootRequired && (
                      <button type="button" onClick={() => rebootNow(task.agentId)} disabled={dispatchCommand.isPending}>
                        Reboot now
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
