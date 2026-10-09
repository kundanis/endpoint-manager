import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { SecurityRuleOperator } from "@em/shared";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import EndpointLabel, { EndpointOption } from "../components/EndpointLabel";
import {
  useAddZeroTrustCondition,
  useAgents,
  useAssetGroups,
  useAssignZeroTrustPolicy,
  useCreateZeroTrustPolicy,
  useDeleteZeroTrustCondition,
  useDeleteZeroTrustPolicy,
  useForceComplyZeroTrust,
  useRevokeZeroTrustOverride,
  useUnassignZeroTrustPolicy,
  useUpdateZeroTrustCondition,
  useUpdateZeroTrustPolicy,
  useZeroTrustAgentBreakdowns,
  useZeroTrustAssignments,
  useZeroTrustOverridableConditionKeys,
  useZeroTrustPolicies,
  useZeroTrustPolicy,
} from "../api/hooks";
import type { ZeroTrustPolicyDetail, ZeroTrustPolicySummary } from "../api/types";
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
        renderExtra={(agent) => agent.osEditionLabel && <span style={{ color: "var(--text-muted)" }}>({agent.osEditionLabel})</span>}
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

type FleetTrustFilter = { policyId: string; conditionId?: string } | null;

// Fleet-wide view across every enabled policy: a tile per policy with how many of its
// endpoints are NOT compliant, and under it a tile per condition with how many endpoints
// fail that condition. Clicking a tile narrows the table to exactly those endpoints;
// clearing the filter shows every endpoint/policy pair again.
function FleetTrustPanel({
  policies,
  initialFilter = null,
}: {
  policies: ZeroTrustPolicySummary[];
  initialFilter?: FleetTrustFilter;
}) {
  const results = useZeroTrustAgentBreakdowns(policies.map((p) => p.id));
  const [filter, setFilter] = useState<FleetTrustFilter>(initialFilter);

  const conditionTitleById = new Map(
    results.flatMap((r) => (r.data?.conditions ?? []).map((c) => [c.id, c.title] as const)),
  );
  const rows = policies.flatMap((p, i) =>
    (results[i]?.data?.agents ?? []).map((a) => ({ ...a, policyId: p.id, policyName: p.name })),
  );
  const visibleRows = !filter
    ? rows
    : rows.filter(
        (r) =>
          r.policyId === filter.policyId &&
          (filter.conditionId ? r.nonCompliantConditionIds.includes(filter.conditionId) : !r.trusted),
      );
  const filterLabel = !filter
    ? null
    : filter.conditionId
      ? `Fails condition: ${conditionTitleById.get(filter.conditionId) ?? "…"}`
      : `Not compliant with: ${policies.find((p) => p.id === filter.policyId)?.name ?? "…"}`;
  const loading = results.some((r) => r.isLoading);

  if (policies.length === 0) return null;

  const isActive = (f: FleetTrustFilter) =>
    filter?.policyId === f?.policyId && filter?.conditionId === f?.conditionId && !!filter === !!f;

  return (
    <div className="panel">
      <h2>Device trust — all enabled policies</h2>
      <p className="hint">
        Each policy tile shows how many assigned endpoints are not compliant. Click a policy to list those endpoints
        and see its conditions below; click a condition to list only the endpoints failing it.
      </p>

      <div className="tiles">
        <div className={`tile ${filter === null ? "active" : ""}`} onClick={() => setFilter(null)}>
          <div className="tile-label">All endpoints</div>
          <div className="tile-value">{new Set(rows.map((r) => r.agentId)).size}</div>
        </div>
        {policies.map((p, i) => {
          const agents = results[i]?.data?.agents ?? [];
          const notCompliant = agents.filter((a) => !a.trusted).length;
          return (
            <div
              key={p.id}
              className={`tile ${notCompliant > 0 ? "accent-critical" : "accent-good"} ${isActive({ policyId: p.id }) ? "active" : ""}`}
              onClick={() => setFilter({ policyId: p.id })}
              title={`Show the endpoints not compliant with "${p.name}"`}
            >
              <div className="tile-label">Policy: {p.name} — not compliant</div>
              <div className="tile-value">{results[i]?.data ? notCompliant : "…"}</div>
              <div className="tile-label">of {agents.length} assigned</div>
            </div>
          );
        })}
      </div>

      {policies.map((p, i) => {
        const data = results[i]?.data;
        // Only the clicked policy's conditions, shown once a policy (or one of its
        // conditions) is selected — "All endpoints" collapses them again.
        if (filter?.policyId !== p.id || !data || data.conditions.length === 0) return null;
        return (
          <div key={p.id}>
            <h3>Conditions — {p.name}</h3>
            <div className="tiles">
              {data.conditions.map((c) => {
                const failing = data.agents.filter((a) => a.nonCompliantConditionIds.includes(c.id)).length;
                return (
                  <div
                    key={c.id}
                    className={`tile ${failing > 0 ? "accent-critical" : "accent-good"} ${isActive({ policyId: p.id, conditionId: c.id }) ? "active" : ""}`}
                    onClick={() => setFilter({ policyId: p.id, conditionId: c.id })}
                    title={`Show the endpoints failing "${c.title}"`}
                  >
                    <div className="tile-label">{c.title} — not compliant</div>
                    <div className="tile-value">{failing}</div>
                    <div className="tile-label">of {data.agents.length} assigned</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {filterLabel && (
        <p>
          <span className="filter-chip">
            {filterLabel}{" "}
            <button type="button" aria-label="Clear filter" onClick={() => setFilter(null)}>
              ×
            </button>
          </span>
        </p>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Policy</th>
            <th>Scanned</th>
            <th>Compliant</th>
            <th>Non-compliant</th>
            <th>Error</th>
            <th>Failing conditions</th>
            <th>Trust status</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => (
            <tr key={`${r.policyId}-${r.agentId}`}>
              <td>
                <EndpointLabel hostname={r.hostname} agentId={r.agentId} />
              </td>
              <td>{r.policyName}</td>
              <td>{r.scanned ? "Yes" : "Pending first scan"}</td>
              <td>{r.passCount}</td>
              <td>{r.failCount}</td>
              <td>{r.errorCount}</td>
              <td>
                {r.nonCompliantConditionIds.length > 0
                  ? r.nonCompliantConditionIds.map((id) => conditionTitleById.get(id) ?? "…").join(", ")
                  : "—"}
              </td>
              <td>
                <StatusBadge kind={r.trusted ? "pass" : "fail"} label={r.trusted ? "Trusted" : "Not trusted"} />
              </td>
            </tr>
          ))}
          {visibleRows.length === 0 && (
            <tr>
              <td colSpan={8}>
                {loading
                  ? "Loading…"
                  : filter?.conditionId
                    ? "Every endpoint assigned to this policy passes this condition."
                    : filter
                      ? "Every endpoint assigned to this policy is compliant."
                      : "No enabled policy is assigned to any endpoint yet."}
              </td>
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

function OverridePanel() {
  const { data: agents } = useAgents();
  const { data: conditionKeys } = useZeroTrustOverridableConditionKeys();
  const forceComply = useForceComplyZeroTrust();
  const revoke = useRevokeZeroTrustOverride();

  const [hostnameFilter, setHostnameFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedConditionKeys, setSelectedConditionKeys] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const filteredAgents = useMemo(() => {
    const hostQ = hostnameFilter.trim().toLowerCase();
    const userQ = userFilter.trim().toLowerCase();
    return (agents ?? [])
      .filter((a) => !hostQ || a.hostname.toLowerCase().includes(hostQ))
      .filter((a) => !userQ || (a.inventory?.lastLoggedOnUser ?? "").toLowerCase().includes(userQ));
  }, [agents, hostnameFilter, userFilter]);

  function toggleConditionKey(key: string) {
    setSelectedConditionKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function handleForceComply() {
    forceComply.mutate(
      { agentIds: selectedAgentIds, conditionKeys: selectedConditionKeys },
      {
        onSuccess: (result) =>
          setLastResult(
            result.appliedCount > 0
              ? `Applied to ${result.appliedCount} device/check combination(s) currently failing.`
              : "Nothing applied — none of the selected devices are currently failing the selected checks.",
          ),
      },
    );
  }

  function handleRevoke() {
    revoke.mutate(
      { agentIds: selectedAgentIds, conditionKeys: selectedConditionKeys },
      {
        onSuccess: (result) =>
          setLastResult(
            result.revokedCount > 0
              ? `Revoked ${result.revokedCount} active override(s).`
              : "Nothing to revoke — none of the selected devices had an active override for the selected checks.",
          ),
      },
    );
  }

  const canSubmit = selectedAgentIds.length > 0 && selectedConditionKeys.length > 0;

  return (
    <div className="card accent-purple">
      <h2>Policy check override (bulk)</h2>
      <p>
        Force specific policy checks to stop counting against selected devices' compliance verdict, regardless of
        real posture — e.g. a known false positive while a fix rolls out. Applied "Force comply" only actually
        touches devices currently failing the checked category; "Revoke override" is safe to run on all selected
        devices even where nothing is active. Deliberately invisible everywhere else in the tool — no badge, no API
        field, no CSV column — this is the only place to apply or revoke it.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
        <label>
          Filter by host
          <input
            type="text"
            placeholder="Filter by hostname…"
            value={hostnameFilter}
            onChange={(e) => setHostnameFilter(e.target.value)}
          />
        </label>
        <label>
          Filter by user
          <input
            type="text"
            placeholder="Filter by logged-on user…"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          />
        </label>
      </div>
      <select
        multiple
        size={10}
        style={{ width: "100%" }}
        value={selectedAgentIds}
        onChange={(e) => setSelectedAgentIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
      >
        {filteredAgents.map((a) => (
          <EndpointOption key={a.id} value={a.id} hostname={a.hostname} agentId={a.id} />
        ))}
      </select>
      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Ctrl/Cmd-click or shift-click to select more than one.</p>

      <fieldset>
        <legend>Checks</legend>
        {conditionKeys?.map((c) => (
          <label key={c.conditionKey} className="checkbox-row">
            <input
              type="checkbox"
              checked={selectedConditionKeys.includes(c.conditionKey)}
              onChange={() => toggleConditionKey(c.conditionKey)}
            />
            {c.title}
          </label>
        ))}
        {conditionKeys?.length === 0 && <p>No conditions defined yet across any policy.</p>}
      </fieldset>

      {(forceComply.isError || revoke.isError) && (
        <p className="error-text">{((forceComply.error ?? revoke.error) as Error).message}</p>
      )}
      {lastResult && <p>{lastResult}</p>}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" onClick={handleForceComply} disabled={!canSubmit || forceComply.isPending}>
          {forceComply.isPending ? "Applying…" : "Force comply"}
        </button>
        <button type="button" onClick={handleRevoke} disabled={!canSubmit || revoke.isPending}>
          {revoke.isPending ? "Revoking…" : "Revoke override"}
        </button>
      </div>
    </div>
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

  // Dashboard deep link ?trust=not-trusted: with a single enabled policy, open the Device
  // trust panel already filtered to that policy's non-compliant endpoints.
  const [searchParams] = useSearchParams();
  const enabledPolicies = policies?.filter((p) => p.enabled) ?? [];
  const initialFleetFilter: FleetTrustFilter =
    searchParams.get("trust") === "not-trusted" && enabledPolicies.length === 1
      ? { policyId: enabledPolicies[0].id }
      : null;

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

      {/* Mounted once policies have loaded, so the deep-link initial filter is computed from real data. */}
      {policies && <FleetTrustPanel policies={enabledPolicies} initialFilter={initialFleetFilter} />}

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
        </>
      )}

      <OverridePanel />
    </div>
  );
}
