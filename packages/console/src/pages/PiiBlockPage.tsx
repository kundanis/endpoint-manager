import { useEffect, useState, type FormEvent } from "react";
import type { PiiPatternKey } from "@em/shared";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import BulkPolicyAssignPanel from "../components/BulkPolicyAssignPanel";
import {
  useAddPiiBlockRule,
  useAgents,
  useAssetGroups,
  useAssignPiiBlockPolicy,
  useCreatePiiBlockPolicy,
  useDeletePiiBlockPolicy,
  useDeletePiiBlockRule,
  usePiiBlockAgentBreakdown,
  usePiiBlockAssignments,
  usePiiBlockPolicies,
  usePiiBlockPolicy,
  useUnassignPiiBlockPolicy,
  useUpdatePiiBlockPolicy,
} from "../api/hooks";
import type { PiiBlockPolicyDetail } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import EndpointLabel, { EndpointStatusDot } from "../components/EndpointLabel";

// Display-only copy of the built-in identifier catalog (packages/shared/src/data/
// piiPatterns.ts) — duplicated here rather than importing the runtime array from
// @em/shared, since Vite/Rollup can't statically resolve a named re-export from that
// package's compiled CJS output (same reason DlpPage.tsx keeps its own PII_PATTERN_OPTIONS).
const PII_PATTERN_OPTIONS: { key: PiiPatternKey; label: string; regulations: string[] }[] = [
  { key: "EMAIL", label: "Email address", regulations: ["DPDP", "GDPR"] },
  { key: "PHONE_INDIA", label: "Indian mobile number", regulations: ["DPDP"] },
  { key: "PHONE_GENERIC", label: "International phone number", regulations: ["GDPR"] },
  { key: "CREDIT_CARD", label: "Credit/debit card number", regulations: ["DPDP", "GDPR"] },
  { key: "IP_ADDRESS", label: "IP address", regulations: ["GDPR"] },
  { key: "IBAN", label: "IBAN (bank account)", regulations: ["GDPR"] },
  { key: "AADHAAR", label: "Aadhaar number", regulations: ["DPDP"] },
  { key: "PAN_INDIA", label: "PAN (Permanent Account Number)", regulations: ["DPDP"] },
  { key: "PASSPORT_INDIA", label: "Indian passport number", regulations: ["DPDP"] },
  { key: "GSTIN", label: "GSTIN (GST Identification Number)", regulations: ["DPDP"] },
  { key: "IFSC_CODE", label: "IFSC code (bank branch)", regulations: ["DPDP"] },
];

function RulesPanel({ policy }: { policy: PiiBlockPolicyDetail }) {
  const addRule = useAddPiiBlockRule();
  const deleteRule = useDeletePiiBlockRule();

  const usedKeys = new Set(policy.rules.map((r) => r.value));
  const availablePatterns = PII_PATTERN_OPTIONS.filter((p) => !usedKeys.has(p.key));
  const [selectedKey, setSelectedKey] = useState<PiiPatternKey | "">(availablePatterns[0]?.key ?? "");

  useEffect(() => {
    if (!availablePatterns.some((p) => p.key === selectedKey)) {
      setSelectedKey(availablePatterns[0]?.key ?? "");
    }
    // Only re-run when the available set actually changes (a rule added/removed) - not on
    // every selectedKey change, which would fight the user's own in-progress selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.rules.length]);

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!selectedKey) return;
    addRule.mutate({ policyId: policy.id, ruleType: "PII_PATTERN", value: selectedKey });
  }

  return (
    <div className="panel">
      <h2>Blocked PII categories ({policy.rules.length})</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Regulations</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {policy.rules.map((r) => {
            const def = PII_PATTERN_OPTIONS.find((p) => p.key === r.value);
            return (
              <tr key={r.id}>
                <td>{def?.label ?? r.value}</td>
                <td>{def?.regulations.join(", ") ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => deleteRule.mutate({ policyId: policy.id, ruleId: r.id })}
                    disabled={deleteRule.isPending}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
          {policy.rules.length === 0 && (
            <tr>
              <td colSpan={3}>No PII categories yet — add one below. A policy with no categories never blocks anything.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card accent-orange">
        <h3>Add PII category</h3>
        {availablePatterns.length > 0 ? (
          <form onSubmit={handleAdd}>
            <label>
              Category
              <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value as PiiPatternKey)}>
                {availablePatterns.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label} ({p.regulations.join("/")})
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              Blocks file writes, clipboard copies, and uploads containing this category of personal data on
              assigned endpoints.
            </p>
            {addRule.isError && <p className="error-text">{(addRule.error as Error).message}</p>}
            <button type="submit" disabled={addRule.isPending || !selectedKey}>
              {addRule.isPending ? "Adding…" : "Add category"}
            </button>
          </form>
        ) : (
          <p>Every PII category is already covered by this policy.</p>
        )}
      </div>
    </div>
  );
}

function PolicySettingsPanel({ policy }: { policy: PiiBlockPolicyDetail }) {
  const updatePolicy = useUpdatePiiBlockPolicy();
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
  const { data: assignments } = usePiiBlockAssignments(policyId);
  const assign = useAssignPiiBlockPolicy();
  const unassign = useUnassignPiiBlockPolicy();

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
      <h2>PII Data Blocking — {policyName} — Assignment</h2>

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
  const { data: breakdown } = usePiiBlockAgentBreakdown(policyId);
  const agents = breakdown?.agents ?? [];
  const failedCount = agents.filter((a) => a.lastSyncStatus === "FAILED").length;

  return (
    <div className="panel">
      <h2>PII Data Blocking — {policyName} — Sync status</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
        No block-event log exists for this module — this shows whether each endpoint last applied the current PII
        category list successfully.
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

export default function PiiBlockPage() {
  const { data: policies } = usePiiBlockPolicies();
  const createPolicy = useCreatePiiBlockPolicy();
  const updatePolicy = useUpdatePiiBlockPolicy();
  const deletePolicy = useDeletePiiBlockPolicy();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const bulkAssign = useAssignPiiBlockPolicy();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: policy } = usePiiBlockPolicy(selectedId);

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
      <h2>PII Data Blocking</h2>
      <p>
        Block file writes, clipboard copies, and uploads containing selected categories of personal data — email
        addresses, card numbers, government IDs, and similar — on assigned endpoints. Each policy is a list of PII
        categories from the same catalog Data Discovery and DLP already use, so a category means the same thing
        everywhere in this product.
      </p>
      <p className="hint">
        Note: agent-side enforcement for this module isn't wired up yet — policies can be authored and assigned now,
        ready for when it ships, but assigned endpoints won't actually block anything yet (same phased rollout as
        DLP's Block mode).
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
            <th>Categories</th>
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
