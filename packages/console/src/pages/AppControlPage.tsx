import { useEffect, useState, type FormEvent } from "react";
import type { AppControlRuleType } from "@em/shared";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import BulkPolicyAssignPanel from "../components/BulkPolicyAssignPanel";
import {
  useAddAppControlRule,
  useAgents,
  useAppControlAgentBreakdown,
  useAppControlAssignments,
  useAppControlPolicies,
  useAppControlPolicy,
  useAssetGroups,
  useAssignAppControlPolicy,
  useCreateAppControlPolicy,
  useDeleteAppControlPolicy,
  useDeleteAppControlRule,
  useUnassignAppControlPolicy,
  useUpdateAppControlPolicy,
  useUpdateAppControlRule,
  type AppControlRuleInput,
} from "../api/hooks";
import type { AppControlPolicyDetail, AppControlRuleView } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import EndpointLabel from "../components/EndpointLabel";

const RULE_TYPES: AppControlRuleType[] = ["EXTENSION", "EXECUTABLE"];

const RULE_TYPE_LABEL: Record<AppControlRuleType, string> = {
  EXTENSION: "File extension",
  EXECUTABLE: "Executable / path",
};

const RULE_TYPE_HINT: Record<AppControlRuleType, string> = {
  EXTENSION: 'Extension including the dot, e.g. ".vbs" — blocks any file with that extension from running',
  EXECUTABLE: 'A filename, e.g. "utorrent.exe", or a full path, e.g. "C:\\Tools\\nc.exe"',
};

const BLANK_RULE_FORM: AppControlRuleInput = { ruleType: "EXTENSION", value: "", label: "" };

// Splits on comma or semicolon so a whole list can be pasted into the same field at once —
// safe here because a value is always a plain extension/filename/path, never an expression
// that could legitimately contain one of those characters (unlike Command Block's regex).
function splitBulkValues(raw: string): string[] {
  return [...new Set(raw.split(/[;,]/).map((v) => v.trim()).filter(Boolean))];
}

function RulesPanel({ policy }: { policy: AppControlPolicyDetail }) {
  const addRule = useAddAppControlRule();
  const updateRule = useUpdateAppControlRule();
  const deleteRule = useDeleteAppControlRule();

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<AppControlRuleInput>(BLANK_RULE_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const isEditing = editingRuleId !== null;
  const pending = isEditing ? updateRule.isPending : isSubmitting;
  const mutationError = isEditing ? updateRule.error : null;

  function startEdit(rule: AppControlRuleView) {
    setEditingRuleId(rule.id);
    setForm({ ruleType: rule.ruleType, value: rule.value, label: rule.label ?? "" });
  }

  function cancelEdit() {
    setEditingRuleId(null);
    setForm(BLANK_RULE_FORM);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBulkError(null);
    const label = (form.label ?? "").trim() || null;

    if (editingRuleId) {
      updateRule.mutate({ policyId: policy.id, ruleId: editingRuleId, ruleType: form.ruleType, value: form.value, label }, { onSuccess: cancelEdit });
      return;
    }

    const values = splitBulkValues(form.value);
    if (values.length === 0) return;

    setIsSubmitting(true);
    const failures: string[] = [];
    for (const value of values) {
      try {
        await addRule.mutateAsync({ policyId: policy.id, ruleType: form.ruleType, value, label });
      } catch (err) {
        failures.push(`${value} (${(err as Error).message})`);
      }
    }
    setIsSubmitting(false);
    if (failures.length > 0) {
      setBulkError(`Added ${values.length - failures.length} of ${values.length}. Failed: ${failures.join(", ")}`);
    } else {
      setForm(BLANK_RULE_FORM);
    }
  }

  return (
    <div className="panel">
      <h2>Rules ({policy.rules.length})</h2>
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
              <td>{RULE_TYPE_LABEL[r.ruleType]}</td>
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
              value={form.ruleType}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, ruleType: e.target.value as AppControlRuleType, value: "" }))
              }
            >
              {RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RULE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{RULE_TYPE_HINT[form.ruleType]}</p>

          <label>
            Value{!isEditing && " (comma or semicolon-separate multiple)"}
            <input
              type="text"
              value={form.value}
              onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              placeholder={isEditing ? undefined : 'e.g. ".vbs, .js, .ps1"'}
              required
            />
          </label>

          <label>
            Label (optional)
            <input
              type="text"
              value={form.label ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder={isEditing ? 'Friendly name shown on the rule list, e.g. "BitTorrent client"' : "Applied to every rule added from this batch"}
            />
          </label>

          {mutationError && <p className="error-text">{(mutationError as Error).message}</p>}
          {bulkError && <p className="error-text">{bulkError}</p>}
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

function PolicySettingsPanel({ policy }: { policy: AppControlPolicyDetail }) {
  const updatePolicy = useUpdateAppControlPolicy();
  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description ?? "");

  useEffect(() => {
    setName(policy.name);
    setDescription(policy.description ?? "");
  }, [policy.id, policy.name, policy.description]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    updatePolicy.mutate({ id: policy.id, name, description: description.trim() || null });
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

function AssignmentPanel({ policyId, policyName }: { policyId: string; policyName: string }) {
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: assignments } = useAppControlAssignments(policyId);
  const assign = useAssignAppControlPolicy();
  const unassign = useUnassignAppControlPolicy();

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
      <h2>Application Control — {policyName} — Assignment</h2>

      <h3>Currently assigned</h3>
      <ul>
        {assignments?.map((a) => (
          <li key={a.id}>
            {a.hostname ? <EndpointLabel hostname={a.hostname} agentId={a.agentId} /> : `Group: ${a.groupName}`}{" "}
            <button type="button" onClick={() => unassign.mutate({ policyId, assignmentId: a.id })} disabled={unassign.isPending}>
              Remove
            </button>
          </li>
        ))}
        {assignments?.length === 0 && <li>Not assigned to any endpoint or group yet.</li>}
      </ul>

      <h3>Assign to</h3>
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

      <EndpointCheckboxList
        agents={agents}
        selectedAgentIds={selectedAgentIds}
        onToggle={toggleAgent}
        selectedGroupIds={selectedGroupIds}
      />

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

function ActivityPanel({ policyId, policyName }: { policyId: string; policyName: string }) {
  const { data: breakdown } = useAppControlAgentBreakdown(policyId);
  const agents = breakdown?.agents ?? [];

  return (
    <div className="panel">
      <h2>Application Control — {policyName} — Activity</h2>

      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Assigned devices</div>
          <div className="tile-value">{agents.length}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Total block events</div>
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
              <td>
                <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
              </td>
              <td>
                {a.eventCount > 0 ? (
                  <StatusBadge kind="warn" label={`${a.eventCount} event(s)`} />
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

export default function AppControlPage() {
  const { data: policies } = useAppControlPolicies();
  const createPolicy = useCreateAppControlPolicy();
  const updatePolicy = useUpdateAppControlPolicy();
  const deletePolicy = useDeleteAppControlPolicy();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const bulkAssign = useAssignAppControlPolicy();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: policy } = useAppControlPolicy(selectedId);

  function togglePolicySelect(id: string) {
    setSelectedPolicyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAllPolicies() {
    setSelectedPolicyIds((prev) => (policies && prev.length === policies.length ? [] : (policies?.map((p) => p.id) ?? [])));
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createPolicy.mutate(
      { name, description: description.trim() || null },
      {
        onSuccess: (result) => {
          setSelectedId(result.id);
          setName("");
          setDescription("");
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
      <h2>Application Control</h2>
      <p>
        Restrict which software, utilities, and file extensions are allowed to execute on assigned endpoints. Each
        rule blocks either a file extension (e.g. blocking script types like <code>.vbs</code>) or a specific
        executable by filename or path. Enforcement uses Windows Software Restriction Policy in additive-deny mode —
        everything stays allowed by default except what a rule explicitly blocks, so a misconfigured policy can never
        accidentally lock out an entire endpoint.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "2rem" }}>
              <input
                type="checkbox"
                checked={!!policies && policies.length > 0 && selectedPolicyIds.length === policies.length}
                onChange={toggleSelectAllPolicies}
                title="Select all"
              />
            </th>
            <th style={{ width: "3rem" }}>Enabled</th>
            <th>Name</th>
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
                <input type="checkbox" checked={selectedPolicyIds.includes(p.id)} onChange={() => togglePolicySelect(p.id)} />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => toggleEnabled(p.id, e.target.checked)}
                  title="Enabled — paused policies are skipped entirely and don't affect any device"
                />
              </td>
              <td>{p.name}</td>
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

      <BulkPolicyAssignPanel
        policyIds={selectedPolicyIds}
        onAssign={(args) => bulkAssign.mutateAsync(args)}
        onDone={() => setSelectedPolicyIds([])}
      />

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
        {createPolicy.isError && <p className="error-text">{(createPolicy.error as Error).message}</p>}
        <button type="submit" disabled={createPolicy.isPending || !name.trim()}>
          {createPolicy.isPending ? "Creating…" : "Create policy"}
        </button>
      </form>

      {policy && (
        <>
          <PolicySettingsPanel policy={policy} />
          <RulesPanel policy={policy} />
          <AssignmentPanel policyId={policy.id} policyName={policy.name} />
          <ActivityPanel policyId={policy.id} policyName={policy.name} />
        </>
      )}
    </div>
  );
}
