import { useEffect, useState, type FormEvent } from "react";
import {
  useAddCommandBlockRule,
  useAgents,
  useAssetGroups,
  useAssignCommandBlockPolicy,
  useCommandBlockAgentBreakdown,
  useCommandBlockAssignments,
  useCommandBlockPolicies,
  useCommandBlockPolicy,
  useCreateCommandBlockPolicy,
  useDeleteCommandBlockPolicy,
  useDeleteCommandBlockRule,
  useUnassignCommandBlockPolicy,
  useUpdateCommandBlockPolicy,
  useUpdateCommandBlockRule,
  type CommandBlockRuleInput,
} from "../api/hooks";
import type { CommandBlockPolicyDetail, CommandBlockRuleView } from "../api/types";
import StatusBadge from "../components/StatusBadge";

const BLANK_RULE_FORM: CommandBlockRuleInput = { ruleType: "COMMAND_PATTERN", value: "", label: "" };

const RULE_TYPE_LABELS: Record<NonNullable<CommandBlockRuleInput["ruleType"]>, string> = {
  COMMAND_PATTERN: "Regex pattern",
  EXACT_COMMAND_LINE: "Exact command line",
  PROCESS_NAME: "Process (.exe) name",
};

const RULE_TYPE_HINTS: Record<NonNullable<CommandBlockRuleInput["ruleType"]>, string> = {
  COMMAND_PATTERN:
    "Matched as a regex (case-insensitive) against a running process's full command line — the most powerful option, but the easiest to write too broadly.",
  EXACT_COMMAND_LINE:
    "Matched only when the process's full command line is exactly this string (case-insensitive, no regex) — precise, no false-positive risk from partial matches.",
  PROCESS_NAME:
    'Matched only against the executable\'s bare name, e.g. "nc.exe" — matches regardless of arguments or path.',
};

const RULE_TYPE_PLACEHOLDERS: Record<NonNullable<CommandBlockRuleInput["ruleType"]>, string> = {
  COMMAND_PATTERN: "diskpart|format\\s+[a-z]:",
  EXACT_COMMAND_LINE: "C:\\Windows\\System32\\diskpart.exe",
  PROCESS_NAME: "nc.exe",
};

function RulesPanel({ policy }: { policy: CommandBlockPolicyDetail }) {
  const addRule = useAddCommandBlockRule();
  const updateRule = useUpdateCommandBlockRule();
  const deleteRule = useDeleteCommandBlockRule();

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<CommandBlockRuleInput>(BLANK_RULE_FORM);

  const isEditing = editingRuleId !== null;
  const pending = isEditing ? updateRule.isPending : addRule.isPending;
  const mutationError = isEditing ? updateRule.error : addRule.error;
  const ruleType = form.ruleType ?? "COMMAND_PATTERN";

  function startEdit(rule: CommandBlockRuleView) {
    setEditingRuleId(rule.id);
    setForm({ ruleType: rule.ruleType, value: rule.value, label: rule.label ?? "" });
  }

  function cancelEdit() {
    setEditingRuleId(null);
    setForm(BLANK_RULE_FORM);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body: CommandBlockRuleInput = { ruleType, value: form.value, label: (form.label ?? "").trim() || null };
    if (editingRuleId) {
      updateRule.mutate({ policyId: policy.id, ruleId: editingRuleId, ...body }, { onSuccess: cancelEdit });
    } else {
      addRule.mutate({ policyId: policy.id, ...body }, { onSuccess: () => setForm(BLANK_RULE_FORM) });
    }
  }

  return (
    <div className="panel">
      <h2>Blocked command rules ({policy.rules.length})</h2>
      <p className="hint">
        A short, hardcoded safety net (browsers, explorer.exe, and other core OS/desktop processes) can never be
        matched or killed by any rule here, regardless of type or content.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Value</th>
            <th>Label</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {policy.rules.map((r) => (
            <tr key={r.id} className={r.id === editingRuleId ? "selected-row" : ""}>
              <td>{RULE_TYPE_LABELS[r.ruleType]}</td>
              <td className="mono-cell">{r.value}</td>
              <td>{r.label ?? "—"}</td>
              <td>
                <button type="button" onClick={() => startEdit(r)}>
                  Edit
                </button>{" "}
                <button
                  type="button"
                  onClick={() => deleteRule.mutate({ policyId: policy.id, ruleId: r.id })}
                  disabled={deleteRule.isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {policy.rules.length === 0 && (
            <tr>
              <td colSpan={4}>No rules yet — add one below. A policy with no rules never blocks anything.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card accent-orange">
        <h3>{isEditing ? "Edit rule" : "Add rule"}</h3>
        <form onSubmit={handleSubmit}>
          <label>
            Rule type
            <select
              value={ruleType}
              onChange={(e) => setForm((prev) => ({ ...prev, ruleType: e.target.value as CommandBlockRuleInput["ruleType"] }))}
            >
              <option value="COMMAND_PATTERN">Regex pattern</option>
              <option value="EXACT_COMMAND_LINE">Exact command line</option>
              <option value="PROCESS_NAME">Process (.exe) name</option>
            </select>
          </label>

          <label>
            {RULE_TYPE_LABELS[ruleType]}
            <input
              type="text"
              value={form.value}
              onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              placeholder={RULE_TYPE_PLACEHOLDERS[ruleType]}
              required
            />
          </label>
          <p className="hint">{RULE_TYPE_HINTS[ruleType]} Checked every 20 seconds.</p>

          <label>
            Label (optional)
            <input
              type="text"
              value={form.label ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder='Friendly name, e.g. "Disk formatting tools"'
            />
          </label>

          {mutationError && <p className="error-text">{(mutationError as Error).message}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" disabled={pending || !form.value.trim()}>
              {pending ? "Saving…" : isEditing ? "Save changes" : "Add rule"}
            </button>
            {isEditing && (
              <button type="button" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function PolicySettingsPanel({ policy }: { policy: CommandBlockPolicyDetail }) {
  const updatePolicy = useUpdateCommandBlockPolicy();
  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description ?? "");
  const [enforcementMode, setEnforcementMode] = useState<"ALERT_ONLY" | "BLOCK">(policy.enforcementMode);

  useEffect(() => {
    setName(policy.name);
    setDescription(policy.description ?? "");
    setEnforcementMode(policy.enforcementMode);
  }, [policy.id, policy.name, policy.description, policy.enforcementMode]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    updatePolicy.mutate({ id: policy.id, name, description: description.trim() || null, enforcementMode });
  }

  return (
    <form className="card accent-blue" onSubmit={handleSave}>
      <h2>Policy settings</h2>
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Description
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Enforcement mode
        <select value={enforcementMode} onChange={(e) => setEnforcementMode(e.target.value as "ALERT_ONLY" | "BLOCK")}>
          <option value="ALERT_ONLY">Alert only (log matches, never kill)</option>
          <option value="BLOCK">Block (kill matched processes)</option>
        </select>
      </label>
      <p className="hint">
        Alert-only lets you test new rules against real traffic — matches are logged as events but nothing is
        killed — before switching to Block once you've confirmed there are no false positives.
      </p>
      {updatePolicy.isError && <p className="error-text">{(updatePolicy.error as Error).message}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <button type="submit" disabled={updatePolicy.isPending || !name.trim()}>
          {updatePolicy.isPending ? "Saving…" : "Save policy"}
        </button>
        {updatePolicy.isSuccess && <span style={{ color: "var(--online)", fontSize: "0.85rem" }}>Saved</span>}
      </div>
    </form>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: assignments } = useCommandBlockAssignments(policyId);
  const assign = useAssignCommandBlockPolicy();
  const unassign = useUnassignCommandBlockPolicy();

  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  function handleAssign() {
    assign.mutate(
      { policyId, agentIds: selectedAgentIds, groupIds: selectedGroupIds },
      { onSuccess: () => { setSelectedAgentIds([]); setSelectedGroupIds([]); } },
    );
  }

  return (
    <div className="panel">
      <h2>Assignment</h2>

      <h3>Currently assigned</h3>
      <ul>
        {assignments?.map((a) => (
          <li key={a.id}>
            {a.hostname ?? `Group: ${a.groupName}`}{" "}
            <button type="button" onClick={() => unassign.mutate({ policyId, assignmentId: a.id })} disabled={unassign.isPending}>
              Remove
            </button>
          </li>
        ))}
        {assignments?.length === 0 && <li>Not assigned to any endpoint or group yet.</li>}
      </ul>

      <h3>Assign to</h3>
      <fieldset>
        <legend>Endpoints</legend>
        {agents?.map((agent) => (
          <label key={agent.id} className="checkbox-row">
            <input type="checkbox" checked={selectedAgentIds.includes(agent.id)} onChange={() => toggleAgent(agent.id)} />
            {agent.hostname}
          </label>
        ))}
        {agents?.length === 0 && <p>No endpoints enrolled yet.</p>}
      </fieldset>

      {groups && groups.length > 0 && (
        <fieldset>
          <legend>Groups</legend>
          {groups.map((g) => (
            <label key={g.id} className="checkbox-row">
              <input type="checkbox" checked={selectedGroupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
              {g.name} ({g.memberCount})
            </label>
          ))}
        </fieldset>
      )}

      {assign.isError && <p className="error-text">{(assign.error as Error).message}</p>}
      <button
        type="button"
        onClick={handleAssign}
        disabled={assign.isPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
      >
        {assign.isPending ? "Assigning…" : "Assign"}
      </button>
    </div>
  );
}

function ActivityPanel({ policyId }: { policyId: string }) {
  const { data: breakdown } = useCommandBlockAgentBreakdown(policyId);
  const agents = breakdown?.agents ?? [];

  return (
    <div className="panel">
      <h2>Activity</h2>

      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Assigned devices</div>
          <div className="tile-value">{agents.length}</div>
        </div>
        <div className="tile accent-critical">
          <div className="tile-label">Matches (alerted + blocked)</div>
          <div className="tile-value">{agents.reduce((sum, a) => sum + a.eventCount, 0)}</div>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Events</th>
            <th>Last event</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.agentId}>
              <td>{a.hostname}</td>
              <td>
                {a.eventCount > 0 ? (
                  <StatusBadge kind="fail" label={`${a.eventCount} event(s)`} />
                ) : (
                  <StatusBadge kind="pass" label="No activity" />
                )}
              </td>
              <td>{a.lastEventAt ? new Date(a.lastEventAt).toLocaleString() : "—"}</td>
            </tr>
          ))}
          {agents.length === 0 && (
            <tr>
              <td colSpan={3}>Not assigned to any endpoint yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function CommandBlockPage() {
  const { data: policies } = useCommandBlockPolicies();
  const createPolicy = useCreateCommandBlockPolicy();
  const updatePolicy = useUpdateCommandBlockPolicy();
  const deletePolicy = useDeleteCommandBlockPolicy();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [enforcementMode, setEnforcementMode] = useState<"ALERT_ONLY" | "BLOCK">("ALERT_ONLY");

  const { data: policy } = useCommandBlockPolicy(selectedId);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createPolicy.mutate(
      { name, description: description.trim() || null, enforcementMode },
      {
        onSuccess: (result) => {
          setSelectedId(result.id);
          setName("");
          setDescription("");
          setEnforcementMode("ALERT_ONLY");
        },
      },
    );
  }

  function toggleEnabled(id: string, enabled: boolean) {
    updatePolicy.mutate({ id, enabled });
  }

  function handleDelete(id: string) {
    deletePolicy.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(undefined);
      },
    });
  }

  return (
    <div>
      <h2>Command Blocking</h2>
      <p>
        Block specific commands from running on assigned endpoints. Every 20 seconds the agent scans all running
        processes against every assigned rule (regex, exact command line, or exact process name); any match is
        logged, and killed immediately unless the owning policy is in alert-only mode. Because this is a
        best-effort periodic scan, a matching program can run briefly (up to one scan interval) before being
        caught. Browsers and core OS/desktop processes can never be matched or killed by any rule, regardless of
        content.
      </p>
      <p className="error-text" style={{ fontSize: "0.85rem" }}>
        Matched command lines are stored unmasked, since they are the audit signal needed to understand what was
        blocked — be aware they can occasionally contain a secret (e.g. a password on a "net use" command).
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "3rem" }}>Enabled</th>
            <th>Name</th>
            <th>Mode</th>
            <th>Rules</th>
            <th>Assigned endpoints</th>
            <th>Events</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {policies?.map((p) => (
            <tr key={p.id} className="clickable-row" onClick={() => setSelectedId(p.id)}>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => toggleEnabled(p.id, e.target.checked)}
                  title="Enabled — paused policies are skipped entirely and don't affect any device"
                />
              </td>
              <td>{p.name}</td>
              <td>
                {p.enforcementMode === "BLOCK" ? (
                  <StatusBadge kind="fail" label="Block" />
                ) : (
                  <StatusBadge kind="pass" label="Alert only" />
                )}
              </td>
              <td>{p.ruleCount}</td>
              <td>{p.assignedAgentCount}</td>
              <td>{p.eventCount}</td>
              <td>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(p.id);
                  }}
                  disabled={deletePolicy.isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {policies?.length === 0 && (
            <tr>
              <td colSpan={7}>No policies yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="panel" onSubmit={handleCreate}>
        <h2>New policy</h2>
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Description
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Enforcement mode
          <select value={enforcementMode} onChange={(e) => setEnforcementMode(e.target.value as "ALERT_ONLY" | "BLOCK")}>
            <option value="ALERT_ONLY">Alert only (log matches, never kill)</option>
            <option value="BLOCK">Block (kill matched processes)</option>
          </select>
        </label>
        {createPolicy.isError && <p className="error-text">{(createPolicy.error as Error).message}</p>}
        <button type="submit" disabled={createPolicy.isPending || !name.trim()}>
          {createPolicy.isPending ? "Creating…" : "Create policy"}
        </button>
      </form>

      {policy && (
        <>
          <PolicySettingsPanel policy={policy} />
          <RulesPanel policy={policy} />
          <AssignmentPanel policyId={policy.id} />
          <ActivityPanel policyId={policy.id} />
        </>
      )}
    </div>
  );
}
