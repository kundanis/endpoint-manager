import { useState, type FormEvent } from "react";
import {
  useAgents,
  useAssetGroups,
  useDispatchCommand,
  useDispatchPatchJob,
  usePatchJob,
  usePatchJobs,
  usePatchSummary,
} from "../api/hooks";

function formatBytes(bytes: string | null): string {
  if (!bytes) return "—";
  return `${(Number(bytes) / 1024 ** 2).toFixed(1)} MB`;
}

function severityBadgeClass(severity: string | null): string {
  const s = (severity ?? "").toUpperCase();
  if (s === "CRITICAL" || s === "HIGH") return "danger";
  if (s === "IMPORTANT" || s === "MEDIUM" || s === "MODERATE") return "warn";
  if (s === "LOW") return "online";
  return "offline";
}

export default function PatchesPage() {
  const { data: summary } = usePatchSummary();
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: jobs } = usePatchJobs();
  const dispatchPatch = useDispatchPatchJob();
  const dispatchCommand = useDispatchCommand();

  const [selectedUpdateIds, setSelectedUpdateIds] = useState<string[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
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
      { updateIds: selectedUpdateIds, agentIds: selectedAgentIds, groupIds: selectedGroupIds },
      { onSuccess: (result) => setSelectedJobId(result.jobId) },
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
      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>Title</th>
            <th>Severity</th>
            <th>KB</th>
            <th>Size</th>
            <th>Missing on</th>
          </tr>
        </thead>
        <tbody>
          {summary?.map((item) => (
            <tr key={item.patchDefinitionId}>
              <td>
                <input
                  type="checkbox"
                  checked={selectedUpdateIds.includes(item.updateId)}
                  onChange={() => toggleUpdate(item.updateId)}
                />
              </td>
              <td>{item.title}</td>
              <td>
                {item.severity ? (
                  <span className={`status-badge ${severityBadgeClass(item.severity)}`}>{item.severity}</span>
                ) : (
                  "—"
                )}
              </td>
              <td>{item.kbArticleIds.join(", ") || "—"}</td>
              <td>{formatBytes(item.sizeBytes)}</td>
              <td>{item.missingAgentCount} endpoint(s)</td>
            </tr>
          ))}
          {summary?.length === 0 && (
            <tr>
              <td colSpan={6}>No missing patches detected yet — endpoints scan on their own multi-hour cycle.</td>
            </tr>
          )}
        </tbody>
      </table>

      {selectedUpdateIds.length > 0 && (
        <form className="panel" onSubmit={handleDispatch}>
          <h2>Deploy {selectedUpdateIds.length} selected update(s)</h2>
          <fieldset>
            <legend>Target endpoints</legend>
            {agents?.map((agent) => (
              <label key={agent.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selectedAgentIds.includes(agent.id)}
                  onChange={() => toggleAgent(agent.id)}
                />
                {agent.hostname} <span className={`status-badge ${agent.status.toLowerCase()}`}>{agent.status}</span>
              </label>
            ))}
            {agents?.length === 0 && <p>No endpoints enrolled yet.</p>}
          </fieldset>
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
          {dispatchPatch.isError && <p className="error-text">{(dispatchPatch.error as Error).message}</p>}
          <button
            type="submit"
            disabled={dispatchPatch.isPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
          >
            {dispatchPatch.isPending ? "Dispatching…" : "Dispatch"}
          </button>
        </form>
      )}

      <h2>Patch jobs</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Updates</th>
            <th>Groups</th>
            <th>Created</th>
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
                {Object.entries(job.taskCounts)
                  .map(([status, count]) => `${status}: ${count}`)
                  .join(", ")}
              </td>
            </tr>
          ))}
          {jobs?.length === 0 && (
            <tr>
              <td colSpan={4}>No patch jobs dispatched yet.</td>
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
                  <td>{task.hostname}</td>
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
