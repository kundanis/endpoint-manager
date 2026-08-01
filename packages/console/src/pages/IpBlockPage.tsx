import { useEffect, useState, type FormEvent } from "react";
import {
  useAddIpBlockRule,
  useAgents,
  useAssetGroups,
  useAssignIpBlockPolicy,
  useCreateIpBlockPolicy,
  useDeleteIpBlockPolicy,
  useDeleteIpBlockRule,
  useIpBlockAgentBreakdown,
  useIpBlockAssignments,
  useIpBlockPolicies,
  useIpBlockPolicy,
  useUnassignIpBlockPolicy,
  useUpdateIpBlockPolicy,
  useUpdateIpBlockRule,
  type IpBlockRuleInput,
} from "../api/hooks";
import type { IpBlockPolicyDetail, IpBlockRuleView } from "../api/types";
import StatusBadge from "../components/StatusBadge";

const BLANK_RULE_FORM: IpBlockRuleInput = { ruleType: "IP_ADDRESS", value: "", label: "" };

// Splits on comma or semicolon so a whole list of addresses can be pasted into the same
// field at once — safe here because a value is always a plain IP or CIDR range.
function splitBulkValues(raw: string): string[] {
  return [...new Set(raw.split(/[;,]/).map((v) => v.trim()).filter(Boolean))];
}

function RulesPanel({ policy }: { policy: IpBlockPolicyDetail }) {
  const addRule = useAddIpBlockRule();
  const updateRule = useUpdateIpBlockRule();
  const deleteRule = useDeleteIpBlockRule();

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<IpBlockRuleInput>(BLANK_RULE_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const isEditing = editingRuleId !== null;
  const pending = isEditing ? updateRule.isPending : isSubmitting;
  const mutationError = isEditing ? updateRule.error : null;

  function startEdit(rule: IpBlockRuleView) {
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
      updateRule.mutate(
        { policyId: policy.id, ruleId: editingRuleId, ruleType: "IP_ADDRESS", value: form.value.trim(), label },
        { onSuccess: cancelEdit },
      );
      return;
    }

    const values = splitBulkValues(form.value);
    if (values.length === 0) return;

    setIsSubmitting(true);
    const failures: string[] = [];
    for (const value of values) {
      try {
        await addRule.mutateAsync({ policyId: policy.id, ruleType: "IP_ADDRESS", value, label });
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
      <h2>Blocked addresses ({policy.rules.length})</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>IP / CIDR</th>
            <th>Label</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {policy.rules.map((r) => (
            <tr key={r.id} className={r.id === editingRuleId ? "selected-row" : ""}>
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
              <td colSpan={3}>No addresses yet — add one below. A policy with no addresses never blocks anything.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card accent-orange">
        <h3>{isEditing ? "Edit address" : "Add address"}</h3>
        <form onSubmit={handleSubmit}>
          <label>
            IP address or CIDR range{!isEditing && " (comma or semicolon-separate multiple)"}
            <input
              type="text"
              value={form.value}
              onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              placeholder={isEditing ? "203.0.113.5 or 203.0.113.0/24" : "203.0.113.5, 198.51.100.0/24"}
              required
            />
          </label>
          <p className="hint">
            Blocked via two Windows Firewall rules (inbound + outbound) that this tool owns exclusively — they win
            over the endpoint's general firewall policy regardless of what else it allows.
          </p>

          <label>
            Label (optional)
            <input
              type="text"
              value={form.label ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder={isEditing ? 'Friendly name, e.g. "Known C2 server"' : "Applied to every address added from this batch"}
            />
          </label>

          {mutationError && <p className="error-text">{(mutationError as Error).message}</p>}
          {bulkError && <p className="error-text">{bulkError}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" disabled={pending || !form.value.trim()}>
              {pending ? "Saving…" : isEditing ? "Save changes" : "Add address"}
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

function PolicySettingsPanel({ policy }: { policy: IpBlockPolicyDetail }) {
  const updatePolicy = useUpdateIpBlockPolicy();
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

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: assignments } = useIpBlockAssignments(policyId);
  const assign = useAssignIpBlockPolicy();
  const unassign = useUnassignIpBlockPolicy();

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
  const { data: breakdown } = useIpBlockAgentBreakdown(policyId);
  const agents = breakdown?.agents ?? [];
  const failedCount = agents.filter((a) => a.lastSyncStatus === "FAILED").length;

  return (
    <div className="panel">
      <h2>Sync status</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
        No block-event log exists for this module — asserting a firewall rule has no convenient "a connection was
        just blocked" signal. This shows whether each endpoint last applied the current address list successfully.
      </p>

      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Assigned devices</div>
          <div className="tile-value">{agents.length}</div>
        </div>
        <div className="tile accent-critical">
          <div className="tile-label">Failed to sync</div>
          <div className="tile-value">{failedCount}</div>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Status</th>
            <th>Last synced</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.agentId}>
              <td>{a.hostname}</td>
              <td>
                {a.lastSyncStatus === "SUCCESS" ? (
                  <StatusBadge kind="pass" label="Synced" />
                ) : a.lastSyncStatus === "FAILED" ? (
                  <StatusBadge kind="fail" label={a.lastSyncError ?? "Failed"} />
                ) : (
                  <StatusBadge kind="warn" label="Not synced yet" />
                )}
              </td>
              <td>{a.lastSyncedAt ? new Date(a.lastSyncedAt).toLocaleString() : "—"}</td>
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

export default function IpBlockPage() {
  const { data: policies } = useIpBlockPolicies();
  const createPolicy = useCreateIpBlockPolicy();
  const updatePolicy = useUpdateIpBlockPolicy();
  const deletePolicy = useDeleteIpBlockPolicy();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: policy } = useIpBlockPolicy(selectedId);

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
      <h2>IP Blocking</h2>
      <p>
        Block specific IP addresses or CIDR ranges on assigned endpoints — regardless of what the endpoint's general
        firewall policy otherwise allows. Enforced via two dedicated Windows Firewall rules (inbound + outbound)
        that this tool owns exclusively and re-applies on every sync; an explicit block rule always wins over an
        allow rule in Windows Firewall, order and specificity aside.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "3rem" }}>Enabled</th>
            <th>Name</th>
            <th>Addresses</th>
            <th>Assigned endpoints</th>
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
              <td>{p.ruleCount}</td>
              <td>{p.assignedAgentCount}</td>
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
              <td colSpan={5}>No policies yet.</td>
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
          <RulesPanel policy={policy} />
          <AssignmentPanel policyId={policy.id} />
          <ActivityPanel policyId={policy.id} />
        </>
      )}
    </div>
  );
}
