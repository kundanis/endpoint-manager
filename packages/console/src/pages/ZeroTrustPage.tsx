import { useEffect, useState, type FormEvent } from "react";
import type { SecurityRuleOperator } from "@em/shared";
import {
  useAddZeroTrustCondition,
  useAgents,
  useAssetGroups,
  useAssignZeroTrustPolicy,
  useCreateZeroTrustPolicy,
  useDeleteZeroTrustCondition,
  useDeleteZeroTrustPolicy,
  useUnassignZeroTrustPolicy,
  useUpdateZeroTrustCondition,
  useUpdateZeroTrustPolicy,
  useZeroTrustAgentBreakdown,
  useZeroTrustAssignments,
  useZeroTrustPolicies,
  useZeroTrustPolicy,
} from "../api/hooks";
import type { ZeroTrustPolicyDetail } from "../api/types";
import StatusBadge from "../components/StatusBadge";

const OPERATORS: SecurityRuleOperator[] = ["EQUALS", "NOT_EQUALS", "GTE", "LTE", "CONTAINS", "REGEX_MATCH"];

const BLANK_CONDITION_FORM = {
  conditionKey: "",
  title: "",
  description: "",
  checkPowerShell: "",
  operator: "EQUALS" as SecurityRuleOperator,
  expectedValue: "",
};

function ConditionsPanel({ policy }: { policy: ZeroTrustPolicyDetail }) {
  const addCondition = useAddZeroTrustCondition();
  const updateCondition = useUpdateZeroTrustCondition();
  const deleteCondition = useDeleteZeroTrustCondition();

  const [editingConditionId, setEditingConditionId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_CONDITION_FORM);

  const isEditing = editingConditionId !== null;
  const pending = isEditing ? updateCondition.isPending : addCondition.isPending;
  const mutationError = isEditing ? updateCondition.error : addCondition.error;

  function toggleEnabled(conditionId: string, enabled: boolean) {
    updateCondition.mutate({ policyId: policy.id, conditionId, enabled });
  }

  function startEdit(conditionId: string) {
    const c = policy.conditions.find((x) => x.id === conditionId);
    if (!c) return;
    setEditingConditionId(conditionId);
    setForm({
      conditionKey: c.conditionKey,
      title: c.title,
      description: c.description ?? "",
      checkPowerShell: c.checkPowerShell,
      operator: c.operator,
      expectedValue: c.expectedValue,
    });
  }

  function cancelEdit() {
    setEditingConditionId(null);
    setForm(BLANK_CONDITION_FORM);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      conditionKey: form.conditionKey,
      title: form.title,
      description: form.description.trim() || null,
      checkPowerShell: form.checkPowerShell,
      operator: form.operator,
      expectedValue: form.expectedValue,
    };
    if (editingConditionId) {
      updateCondition.mutate(
        { policyId: policy.id, conditionId: editingConditionId, ...body },
        { onSuccess: cancelEdit },
      );
    } else {
      addCondition.mutate({ policyId: policy.id, ...body }, { onSuccess: () => setForm(BLANK_CONDITION_FORM) });
    }
  }

  return (
    <div className="panel">
      <h2>Conditions ({policy.conditions.length})</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "3rem" }}>Enabled</th>
            <th>Key</th>
            <th>Title</th>
            <th>Check</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {policy.conditions.map((c) => (
            <tr key={c.id} className={c.id === editingConditionId ? "selected-row" : ""}>
              <td>
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => toggleEnabled(c.id, e.target.checked)}
                  title="Enabled — checked conditions are evaluated by the agent and count toward the trust decision"
                />
              </td>
              <td className="mono-cell">{c.conditionKey}</td>
              <td>{c.title}</td>
              <td className="mono-cell">
                {c.operator} {c.expectedValue}
              </td>
              <td>
                <button type="button" onClick={() => startEdit(c.id)}>
                  Edit
                </button>{" "}
                <button
                  type="button"
                  onClick={() => deleteCondition.mutate({ policyId: policy.id, conditionId: c.id })}
                  disabled={deleteCondition.isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {policy.conditions.length === 0 && (
            <tr>
              <td colSpan={5}>No conditions yet — add one below.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card accent-blue">
        <h3>{isEditing ? `Edit condition: ${form.conditionKey}` : "Add condition"}</h3>
        <form onSubmit={handleSubmit}>
          <label>
            Condition key
            <input
              type="text"
              value={form.conditionKey}
              onChange={(e) => setForm((prev) => ({ ...prev, conditionKey: e.target.value }))}
              required
            />
          </label>
          <label>
            Title
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              required
            />
          </label>
          <label>
            Description
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </label>
          <label>
            Check PowerShell (must print the current value to stdout)
            <textarea
              rows={3}
              value={form.checkPowerShell}
              onChange={(e) => setForm((prev) => ({ ...prev, checkPowerShell: e.target.value }))}
              required
            />
          </label>
          <label>
            Operator
            <select
              value={form.operator}
              onChange={(e) => setForm((prev) => ({ ...prev, operator: e.target.value as SecurityRuleOperator }))}
            >
              {OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label>
            Expected value
            <input
              type="text"
              value={form.expectedValue}
              onChange={(e) => setForm((prev) => ({ ...prev, expectedValue: e.target.value }))}
              required
            />
          </label>
          {mutationError && <p className="error-text">{(mutationError as Error).message}</p>}
          <div className="actions" style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" disabled={pending}>
              {pending ? "Saving…" : isEditing ? "Save changes" : "Add condition"}
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

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: assignments } = useZeroTrustAssignments(policyId);
  const assign = useAssignZeroTrustPolicy();
  const unassign = useUnassignZeroTrustPolicy();

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
            {agent.hostname} {agent.osEditionLabel && <span style={{ color: "var(--text-muted)" }}>({agent.osEditionLabel})</span>}
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

type TrustFilter = "all" | "trusted" | "not-trusted";

function TrustPanel({ policyId }: { policyId: string }) {
  const { data: breakdown } = useZeroTrustAgentBreakdown(policyId);
  const [filter, setFilter] = useState<TrustFilter>("all");

  const agents = breakdown?.agents ?? [];
  const trustedCount = agents.filter((a) => a.trusted).length;
  const notTrustedCount = agents.filter((a) => !a.trusted).length;
  const filtered = agents.filter((a) => {
    if (filter === "trusted") return a.trusted;
    if (filter === "not-trusted") return !a.trusted;
    return true;
  });

  return (
    <div className="panel">
      <h2>Device trust</h2>

      <div className="tiles">
        <div className={`tile ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          <div className="tile-label">Total devices</div>
          <div className="tile-value">{agents.length}</div>
        </div>
        <div className={`tile accent-good ${filter === "trusted" ? "active" : ""}`} onClick={() => setFilter("trusted")}>
          <div className="tile-label">Trusted</div>
          <div className="tile-value">{trustedCount}</div>
        </div>
        <div
          className={`tile accent-critical ${filter === "not-trusted" ? "active" : ""}`}
          onClick={() => setFilter("not-trusted")}
        >
          <div className="tile-label">Not trusted</div>
          <div className="tile-value">{notTrustedCount}</div>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Scanned</th>
            <th>Compliant</th>
            <th>Non-compliant</th>
            <th>Error</th>
            <th>Trust status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <tr key={a.agentId}>
              <td>{a.hostname}</td>
              <td>{a.scanned ? "Yes" : "Pending first scan"}</td>
              <td>{a.passCount}</td>
              <td>{a.failCount}</td>
              <td>{a.errorCount}</td>
              <td>
                <StatusBadge kind={a.trusted ? "pass" : "fail"} label={a.trusted ? "Trusted" : "Not trusted"} />
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6}>{agents.length === 0 ? "Not assigned to any endpoint yet." : "No devices match this filter."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PolicySettingsPanel({ policy }: { policy: ZeroTrustPolicyDetail }) {
  const updatePolicy = useUpdateZeroTrustPolicy();
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

export default function ZeroTrustPage() {
  const { data: policies } = useZeroTrustPolicies();
  const createPolicy = useCreateZeroTrustPolicy();
  const updatePolicy = useUpdateZeroTrustPolicy();
  const deletePolicy = useDeleteZeroTrustPolicy();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: policy } = useZeroTrustPolicy(selectedId);

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
      <h1>Zero Trust</h1>
      <p>
        Define device-trust policies — a set of conditions checked directly on each assigned endpoint (OS/patch
        posture, firewall, disk encryption, required security agents, blacklisted processes). A device is "Trusted"
        only once every condition in the policy has been scanned and passes.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "3rem" }}>Enabled</th>
            <th>Name</th>
            <th>Conditions</th>
            <th>Assigned endpoints</th>
            <th>Compliance</th>
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
                  title="Enabled — paused policies are skipped entirely and don't affect any device's trust status"
                />
              </td>
              <td>{p.name}</td>
              <td>{p.conditionCount}</td>
              <td>{p.assignedAgentCount}</td>
              <td>{p.compliancePercent != null ? `${p.compliancePercent}%` : "—"}</td>
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
              <td colSpan={6}>No policies yet.</td>
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
        {createPolicy.isError && <p className="error-text">{(createPolicy.error as Error).message}</p>}
        <button type="submit" disabled={createPolicy.isPending || !name.trim()}>
          {createPolicy.isPending ? "Creating…" : "Create policy"}
        </button>
      </form>

      {policy && (
        <>
          <PolicySettingsPanel policy={policy} />
          <ConditionsPanel policy={policy} />
          <AssignmentPanel policyId={policy.id} />
          <TrustPanel policyId={policy.id} />
        </>
      )}
    </div>
  );
}
