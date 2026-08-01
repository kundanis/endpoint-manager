import { useState, type FormEvent } from "react";
import type { Shell } from "@em/shared";
import {
  useAgents,
  useAssetGroups,
  useBulkQuarantine,
  useBulkRelease,
  useCommandJob,
  useCommandJobs,
  useCommandTemplates,
  useCreateCommandTemplate,
  useDeleteCommandTemplate,
  useDispatchCommand,
  useDispatchCommandTemplate,
  useUpdateCommandTemplate,
} from "../api/hooks";
import type { CommandTemplateView } from "../api/types";
import Collapsible from "../components/Collapsible";

const ISOLATE_OPTION = "isolate";
const RELEASE_OPTION = "release";
const CUSTOM_OPTION = "custom";
const TEMPLATE_PREFIX = "template:";

function ManageTemplatesPanel() {
  const { data: templates } = useCommandTemplates();
  const create = useCreateCommandTemplate();
  const update = useUpdateCommandTemplate();
  const del = useDeleteCommandTemplate();

  const [editingId, setEditingId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shell, setShell] = useState<Shell>("powershell");
  const [script, setScript] = useState("");

  function resetForm() {
    setEditingId(undefined);
    setName("");
    setDescription("");
    setShell("powershell");
    setScript("");
  }

  function startEdit(t: CommandTemplateView) {
    setEditingId(t.id);
    setName(t.name);
    setDescription(t.description ?? "");
    setShell(t.shell);
    setScript(t.script);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = { name, description: description.trim() || undefined, shell, script };
    if (editingId) {
      update.mutate(
        { id: editingId, name, description: description.trim() || null, shell, script },
        { onSuccess: () => resetForm() },
      );
    } else {
      create.mutate(body, { onSuccess: () => resetForm() });
    }
  }

  function handleDelete(t: CommandTemplateView) {
    if (!window.confirm(`Delete predefined command "${t.name}"? This cannot be undone.`)) return;
    del.mutate(t.id, { onSuccess: () => editingId === t.id && resetForm() });
  }

  const mutation = editingId ? update : create;

  return (
    <Collapsible title="Manage predefined commands" defaultOpen={false}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Shell</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {templates?.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.description ?? "—"}</td>
              <td>{t.shell}</td>
              <td style={{ display: "flex", gap: "0.4rem" }}>
                <button type="button" onClick={() => startEdit(t)}>
                  Edit
                </button>
                <button type="button" onClick={() => handleDelete(t)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {templates?.length === 0 && (
            <tr>
              <td colSpan={4}>No predefined commands yet — add one below.</td>
            </tr>
          )}
        </tbody>
      </table>

      <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
        <h3>{editingId ? "Edit predefined command" : "Add predefined command"}</h3>
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Description
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Shell
          <select value={shell} onChange={(e) => setShell(e.target.value as Shell)}>
            <option value="powershell">PowerShell</option>
            <option value="cmd">cmd</option>
          </select>
        </label>
        <label>
          Script
          <textarea rows={5} className="mono-cell" value={script} onChange={(e) => setScript(e.target.value)} required />
        </label>
        {mutation.isError && <p className="error-text">{(mutation.error as Error).message}</p>}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="submit" disabled={mutation.isPending || !name.trim() || !script.trim()}>
            {mutation.isPending ? "Saving…" : editingId ? "Save changes" : "Add predefined command"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </Collapsible>
  );
}

export default function CommandsPage() {
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: jobs } = useCommandJobs();
  const { data: templates } = useCommandTemplates();
  const dispatch = useDispatchCommand();
  const dispatchTemplate = useDispatchCommandTemplate();
  const bulkQuarantine = useBulkQuarantine();
  const bulkRelease = useBulkRelease();

  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [predefined, setPredefined] = useState<string>(CUSTOM_OPTION);
  const [shell, setShell] = useState<Shell>("powershell");
  const [script, setScript] = useState("");
  const [timeoutSec, setTimeoutSec] = useState(120);
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();

  const { data: jobDetail } = useCommandJob(selectedJobId);

  const targetCount = new Set(selectedAgentIds).size + selectedGroupIds.length;
  const selectedTemplate = predefined.startsWith(TEMPLATE_PREFIX)
    ? templates?.find((t) => t.id === predefined.slice(TEMPLATE_PREFIX.length))
    : undefined;

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (predefined === ISOLATE_OPTION) {
      if (!window.confirm(`Isolate ${targetCount} target(s) from the network? This locks down outbound access to DNS and this server only, until released.`)) return;
      bulkQuarantine.mutate(
        { agentIds: selectedAgentIds, groupIds: selectedGroupIds },
        { onSuccess: (result) => setSelectedJobId(result.jobId) },
      );
      return;
    }

    if (predefined === RELEASE_OPTION) {
      if (!window.confirm(`Release ${targetCount} target(s) from quarantine, restoring normal network access?`)) return;
      bulkRelease.mutate(
        { agentIds: selectedAgentIds, groupIds: selectedGroupIds },
        { onSuccess: (result) => setSelectedJobId(result.jobId) },
      );
      return;
    }

    if (selectedTemplate) {
      dispatchTemplate.mutate(
        { id: selectedTemplate.id, agentIds: selectedAgentIds, groupIds: selectedGroupIds },
        { onSuccess: (result) => setSelectedJobId(result.jobId) },
      );
      return;
    }

    dispatch.mutate(
      { agentIds: selectedAgentIds, groupIds: selectedGroupIds, shell, script, timeoutSec },
      { onSuccess: (result) => setSelectedJobId(result.jobId) },
    );
  }

  const isCustom = predefined === CUSTOM_OPTION;
  const dispatchPending = dispatch.isPending || dispatchTemplate.isPending || bulkQuarantine.isPending || bulkRelease.isPending;
  const dispatchError = dispatch.error ?? dispatchTemplate.error ?? bulkQuarantine.error ?? bulkRelease.error;

  return (
    <div>
      <h1>Commands</h1>

      <form className="panel" onSubmit={handleSubmit}>
        <h2>Dispatch a command</h2>
        <fieldset>
          <legend>Target endpoints</legend>
          {agents?.map((agent) => (
            <label key={agent.id} className="checkbox-row">
              <input type="checkbox" checked={selectedAgentIds.includes(agent.id)} onChange={() => toggleAgent(agent.id)} />
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

        <label>
          Predefined command
          <select value={predefined} onChange={(e) => setPredefined(e.target.value)}>
            <option value={CUSTOM_OPTION}>— Custom script —</option>
            <option value={ISOLATE_OPTION}>⚠ Isolate from network</option>
            <option value={RELEASE_OPTION}>Release from quarantine</option>
            {templates?.map((t) => (
              <option key={t.id} value={`${TEMPLATE_PREFIX}${t.id}`}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        {predefined === ISOLATE_OPTION && (
          <p>Locks down outbound network access on every selected endpoint to DNS and this server only, until released. Reuses the same mechanism as the per-endpoint Quarantine action.</p>
        )}
        {predefined === RELEASE_OPTION && <p>Restores normal outbound network access on every selected endpoint.</p>}
        {selectedTemplate?.description && <p>{selectedTemplate.description}</p>}

        {isCustom && (
          <>
            <label>
              Shell
              <select value={shell} onChange={(e) => setShell(e.target.value as Shell)}>
                <option value="powershell">PowerShell</option>
                <option value="cmd">cmd</option>
              </select>
            </label>

            <label>
              Script
              <textarea rows={5} value={script} onChange={(e) => setScript(e.target.value)} required />
            </label>

            <label>
              Timeout (seconds)
              <input
                type="number"
                min={1}
                max={900}
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(Number(e.target.value))}
              />
            </label>
          </>
        )}

        {dispatchError && <p className="error-text">{(dispatchError as Error).message}</p>}
        <button type="submit" disabled={dispatchPending || targetCount === 0}>
          {dispatchPending ? "Dispatching…" : "Dispatch"}
        </button>
      </form>

      <ManageTemplatesPanel />

      <h2>Recent jobs</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Script</th>
            <th>Shell</th>
            <th>Groups</th>
            <th>Created</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs?.map((job) => (
            <tr key={job.id} className="clickable-row" onClick={() => setSelectedJobId(job.id)}>
              <td className="mono-cell">{job.script.slice(0, 60)}</td>
              <td>{job.shell}</td>
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
              <td colSpan={5}>No commands dispatched yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {jobDetail && (
        <div className="panel">
          <h2>Job detail</h2>
          <p className="mono-cell">{jobDetail.script}</p>
          {jobDetail.targetGroupNames.length > 0 && <p>Targeted groups: {jobDetail.targetGroupNames.join(", ")}</p>}
          <table className="data-table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Exit code</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              {jobDetail.tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.hostname}</td>
                  <td>{task.status}</td>
                  <td>{task.exitCode ?? "—"}</td>
                  <td>
                    {task.stdout && <pre className="output-block">{task.stdout}</pre>}
                    {task.stderr && <pre className="output-block error-text">{task.stderr}</pre>}
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
