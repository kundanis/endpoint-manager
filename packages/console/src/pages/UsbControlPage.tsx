import { useEffect, useState, type FormEvent } from "react";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import BulkPolicyAssignPanel from "../components/BulkPolicyAssignPanel";
import {
  useAddUsbControlRule,
  useAgents,
  useAssetGroups,
  useAssignUsbControlPolicy,
  useCreateUsbControlPolicy,
  useDeleteUsbControlPolicy,
  useDeleteUsbControlRule,
  useUsbControlAgentBreakdown,
  useUsbControlAssignments,
  useUsbControlPolicies,
  useUsbControlPolicy,
  useUnassignUsbControlPolicy,
  useUpdateUsbControlPolicy,
  useUpdateUsbControlRule,
  type UsbControlRuleInput,
} from "../api/hooks";
import type { UsbControlPolicyDetail, UsbControlRuleView } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import EndpointLabel, { EndpointStatusDot } from "../components/EndpointLabel";

const BLANK_RULE_FORM: UsbControlRuleInput = { ruleType: "USB_SERIAL", value: "", label: "" };

function splitBulkValues(raw: string): string[] {
  return [...new Set(raw.split(/[;,]/).map((v) => v.trim()).filter(Boolean))];
}

function RulesPanel({ policy }: { policy: UsbControlPolicyDetail }) {
  const addRule = useAddUsbControlRule();
  const updateRule = useUpdateUsbControlRule();
  const deleteRule = useDeleteUsbControlRule();

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<UsbControlRuleInput>(BLANK_RULE_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const isEditing = editingRuleId !== null;
  const pending = isEditing ? updateRule.isPending : isSubmitting;
  const mutationError = isEditing ? updateRule.error : null;

  function startEdit(rule: UsbControlRuleView) {
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
        { policyId: policy.id, ruleId: editingRuleId, ruleType: "USB_SERIAL", value: form.value.trim(), label },
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
        await addRule.mutateAsync({ policyId: policy.id, ruleType: "USB_SERIAL", value, label });
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
      <h2>Allowed serial numbers ({policy.rules.length})</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Serial number</th>
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
              <td colSpan={3}>
                No serial numbers yet — a policy with none disables every USB storage device on its assigned endpoints.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card accent-orange">
        <h3>{isEditing ? "Edit serial number" : "Add serial number"}</h3>
        <form onSubmit={handleSubmit}>
          <label>
            USB drive serial number{!isEditing && " (comma or semicolon-separate multiple)"}
            <input
              type="text"
              value={form.value}
              onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              placeholder={isEditing ? "E.g. E1A2B3C4D5E6F7" : "E1A2B3C4D5E6F7, 001A2B3C"}
              required
            />
          </label>
          <p className="hint">
            Read from the drive's own PnP device ID. Any USB storage device whose serial isn't in this list is
            disabled on the endpoint shortly after it's inserted.
          </p>

          <label>
            Label (optional)
            <input
              type="text"
              value={form.label ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder={isEditing ? 'Friendly name, e.g. "IT-issued backup drive"' : "Applied to every serial added from this batch"}
            />
          </label>

          {mutationError && <p className="error-text">{(mutationError as Error).message}</p>}
          {bulkError && <p className="error-text">{bulkError}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" disabled={pending || !form.value.trim()}>
              {pending ? "Saving…" : isEditing ? "Save changes" : "Add serial number"}
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

function PolicySettingsPanel({ policy }: { policy: UsbControlPolicyDetail }) {
  const updatePolicy = useUpdateUsbControlPolicy();
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
  const { data: assignments } = useUsbControlAssignments(policyId);
  const assign = useAssignUsbControlPolicy();
  const unassign = useUnassignUsbControlPolicy();

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
      <h2>USB Device Control — {policyName} — Assignment</h2>

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
  const { data: breakdown } = useUsbControlAgentBreakdown(policyId);
  const agents = breakdown?.agents ?? [];
  const failedCount = agents.filter((a) => a.lastSyncStatus === "FAILED").length;

  return (
    <div className="panel">
      <h2>USB Device Control — {policyName} — Sync status</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
        Shows whether each endpoint last applied the current serial whitelist successfully. Disabled-device history
        is on each endpoint's own detail page.
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
            <th>Group</th>
            <th>User</th>
            <th>Status</th>
            <th>Last synced</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.agentId}>
              <td>
                <EndpointStatusDot hostname={a.hostname} agentId={a.agentId} />
                {a.hostname}
              </td>
              <td>{a.groupName ?? "—"}</td>
              <td>{a.lastLoggedOnUser ?? "—"}</td>
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
              <td colSpan={5}>Not assigned to any endpoint yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function UsbControlPage() {
  const { data: policies } = useUsbControlPolicies();
  const createPolicy = useCreateUsbControlPolicy();
  const updatePolicy = useUpdateUsbControlPolicy();
  const deletePolicy = useDeleteUsbControlPolicy();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const bulkAssign = useAssignUsbControlPolicy();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: policy } = useUsbControlPolicy(selectedId);

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
      <h2>USB Device Control</h2>
      <p>
        Whitelist specific USB storage devices by serial number on assigned endpoints — any USB drive not on the
        list is disabled shortly after it's inserted. Enforced by an agent poll loop that disables the specific
        Windows PnP device instance of any unrecognized drive, and reported as an audit event on the endpoint's own
        detail page.
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
            <th>Serial numbers</th>
            <th>Assigned endpoints</th>
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
