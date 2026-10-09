import { useEffect, useState, type FormEvent } from "react";
import type { DlpEnforcementMode, DlpRuleType } from "@em/shared";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import {
  useAddDlpRule,
  useAgents,
  useAssetGroups,
  useAssignDlpPolicy,
  useCreateDlpPolicy,
  useDeleteDlpPolicy,
  useDeleteDlpRule,
  useDlpAgentBreakdown,
  useDlpAssignments,
  useDlpPolicies,
  useDlpPolicy,
  useUnassignDlpPolicy,
  useUpdateDlpPolicy,
  useUpdateDlpRule,
  type DlpRuleInput,
} from "../api/hooks";
import type { DlpPolicyDetail, DlpRuleView } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import EndpointLabel from "../components/EndpointLabel";

const ENFORCEMENT_MODES: DlpEnforcementMode[] = ["ALERT_ONLY", "BLOCK"];
const ENFORCEMENT_LABEL: Record<DlpEnforcementMode, string> = {
  ALERT_ONLY: "Alert only",
  BLOCK: "Block",
};

const RULE_TYPES: DlpRuleType[] = [
  "CONTENT_KEYWORD",
  "CONTENT_REGEX",
  "CONTENT_PATTERN",
  "BLOCKED_PATH",
  "TRUSTED_PROCESS",
  "FILE_EXTENSION",
];

const RULE_TYPE_LABEL: Record<DlpRuleType, string> = {
  CONTENT_KEYWORD: "Content keyword",
  CONTENT_REGEX: "Content regex",
  CONTENT_PATTERN: "Content identifier",
  BLOCKED_PATH: "Blocked destination path",
  TRUSTED_PROCESS: "Trusted process",
  FILE_EXTENSION: "File extension filter",
};

const RULE_TYPE_HINT: Record<DlpRuleType, string> = {
  CONTENT_KEYWORD: 'Literal text to match, e.g. "Project Falcon" (case-insensitive)',
  CONTENT_REGEX: "Custom regular expression to match against file content",
  CONTENT_PATTERN: "Pick a built-in identifier type to detect",
  BLOCKED_PATH: 'Path substring, e.g. "\\Dropbox\\" — write is blocked regardless of content',
  TRUSTED_PROCESS: 'Process image name, e.g. "veeam.exe" — writes from it are never inspected',
  FILE_EXTENSION: 'Extension including the dot, e.g. ".csv" — if any exist, only matching files are scanned',
};

// Display-only labels for the built-in identifier catalog (packages/shared/src/data/
// piiPatterns.ts) — duplicated here rather than importing the runtime array from
// @em/shared, since Vite/Rollup can't statically resolve a named re-export from that
// package's compiled CJS output (hit this exact issue earlier with a plain constant).
const PII_PATTERN_OPTIONS: { key: string; label: string }[] = [
  { key: "EMAIL", label: "Email address" },
  { key: "PHONE_INDIA", label: "Indian mobile number" },
  { key: "PHONE_GENERIC", label: "International phone number" },
  { key: "CREDIT_CARD", label: "Credit/debit card number" },
  { key: "IP_ADDRESS", label: "IP address" },
  { key: "IBAN", label: "IBAN (bank account)" },
  { key: "AADHAAR", label: "Aadhaar number" },
  { key: "PAN_INDIA", label: "PAN (Permanent Account Number)" },
  { key: "PASSPORT_INDIA", label: "Indian passport number" },
  { key: "GSTIN", label: "GSTIN (GST Identification Number)" },
  { key: "IFSC_CODE", label: "IFSC code (bank branch)" },
];

const BLANK_RULE_FORM: DlpRuleInput = { ruleType: "CONTENT_KEYWORD", value: "", label: "" };

function RulesPanel({ policy }: { policy: DlpPolicyDetail }) {
  const addRule = useAddDlpRule();
  const updateRule = useUpdateDlpRule();
  const deleteRule = useDeleteDlpRule();

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<DlpRuleInput>(BLANK_RULE_FORM);

  const isEditing = editingRuleId !== null;
  const pending = isEditing ? updateRule.isPending : addRule.isPending;
  const mutationError = isEditing ? updateRule.error : addRule.error;

  function startEdit(rule: DlpRuleView) {
    setEditingRuleId(rule.id);
    setForm({ ruleType: rule.ruleType, value: rule.value, label: rule.label ?? "" });
  }

  function cancelEdit() {
    setEditingRuleId(null);
    setForm(BLANK_RULE_FORM);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body: DlpRuleInput = { ruleType: form.ruleType, value: form.value, label: (form.label ?? "").trim() || null };
    if (editingRuleId) {
      updateRule.mutate({ policyId: policy.id, ruleId: editingRuleId, ...body }, { onSuccess: cancelEdit });
    } else {
      addRule.mutate({ policyId: policy.id, ...body }, { onSuccess: () => setForm(BLANK_RULE_FORM) });
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
              <td className="mono-cell">
                {r.ruleType === "CONTENT_PATTERN"
                  ? (PII_PATTERN_OPTIONS.find((p) => p.key === r.value)?.label ?? r.value)
                  : r.value}
              </td>
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
              <td colSpan={4}>No rules yet — add one below. A policy with no rules never triggers.</td>
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
                setForm((prev) => ({ ...prev, ruleType: e.target.value as DlpRuleType, value: "" }))
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

          {form.ruleType === "CONTENT_PATTERN" ? (
            <label>
              Identifier type
              <select value={form.value} onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))} required>
                <option value="" disabled>
                  Select...
                </option>
                {PII_PATTERN_OPTIONS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Value
              <input
                type="text"
                value={form.value}
                onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
                required
              />
            </label>
          )}

          <label>
            Label (optional)
            <input
              type="text"
              value={form.label ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder='Friendly name shown on events, e.g. "Codename"'
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

function PolicySettingsPanel({ policy }: { policy: DlpPolicyDetail }) {
  const updatePolicy = useUpdateDlpPolicy();
  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description ?? "");
  const [enforcementMode, setEnforcementMode] = useState<DlpEnforcementMode>(policy.enforcementMode);
  const [removableMediaOnly, setRemovableMediaOnly] = useState(policy.removableMediaOnly);

  useEffect(() => {
    setName(policy.name);
    setDescription(policy.description ?? "");
    setEnforcementMode(policy.enforcementMode);
    setRemovableMediaOnly(policy.removableMediaOnly);
  }, [policy.id, policy.name, policy.description, policy.enforcementMode, policy.removableMediaOnly]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    updatePolicy.mutate({ id: policy.id, name, description: description.trim() || null, enforcementMode, removableMediaOnly });
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
        <select value={enforcementMode} onChange={(e) => setEnforcementMode(e.target.value as DlpEnforcementMode)}>
          {ENFORCEMENT_MODES.map((m) => (
            <option key={m} value={m}>
              {ENFORCEMENT_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={removableMediaOnly} onChange={(e) => setRemovableMediaOnly(e.target.checked)} />
        Removable media only (USB drives etc.) — off applies to all file writes
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
  const { data: assignments } = useDlpAssignments(policyId);
  const assign = useAssignDlpPolicy();
  const unassign = useUnassignDlpPolicy();

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

type ActivityFilter = "all" | "blocked" | "alerted";

function ActivityPanel({ policyId }: { policyId: string }) {
  const { data: breakdown } = useDlpAgentBreakdown(policyId);
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const agents = breakdown?.agents ?? [];
  const blockedTotal = agents.reduce((sum, a) => sum + a.blockedCount, 0);
  const alertedTotal = agents.reduce((sum, a) => sum + (a.eventCount - a.blockedCount), 0);
  const filtered = agents.filter((a) => {
    if (filter === "blocked") return a.blockedCount > 0;
    if (filter === "alerted") return a.eventCount - a.blockedCount > 0;
    return true;
  });

  return (
    <div className="panel">
      <h2>Activity</h2>

      <div className="tiles">
        <div className={`tile ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          <div className="tile-label">Total devices</div>
          <div className="tile-value">{agents.length}</div>
        </div>
        <div className={`tile accent-critical ${filter === "blocked" ? "active" : ""}`} onClick={() => setFilter("blocked")}>
          <div className="tile-label">Blocked events</div>
          <div className="tile-value">{blockedTotal}</div>
        </div>
        <div className={`tile ${filter === "alerted" ? "active" : ""}`} onClick={() => setFilter("alerted")}>
          <div className="tile-label">Alerted events</div>
          <div className="tile-value">{alertedTotal}</div>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Events</th>
            <th>Blocked</th>
            <th>Last event</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <tr key={a.agentId}>
              <td>
                <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
              </td>
              <td>{a.eventCount}</td>
              <td>
                {a.blockedCount > 0 ? (
                  <StatusBadge kind="fail" label={`${a.blockedCount} blocked`} />
                ) : a.eventCount > 0 ? (
                  <StatusBadge kind="warn" label="Alerted only" />
                ) : (
                  <StatusBadge kind="pass" label="No activity" />
                )}
              </td>
              <td>{a.lastEventAt ? new Date(a.lastEventAt).toLocaleString() : "—"}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={4}>{agents.length === 0 ? "Not assigned to any endpoint yet." : "No devices match this filter."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function DlpContentPoliciesPage() {
  const { data: policies } = useDlpPolicies();
  const createPolicy = useCreateDlpPolicy();
  const updatePolicy = useUpdateDlpPolicy();
  const deletePolicy = useDeleteDlpPolicy();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [enforcementMode, setEnforcementMode] = useState<DlpEnforcementMode>("ALERT_ONLY");
  const [removableMediaOnly, setRemovableMediaOnly] = useState(true);

  const { data: policy } = useDlpPolicy(selectedId);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createPolicy.mutate(
      { name, description: description.trim() || null, enforcementMode, removableMediaOnly },
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
      <h2>Content &amp; File Policies</h2>
      <p>
        Real-time data loss prevention — each policy is a set of rules you define (content keywords/patterns to
        detect, destination paths to always block, trusted processes to exempt, file types to restrict to) and can
        alert or block matching writes on assigned endpoints. Content matches only ever report masked previews, never
        the raw matched value.
      </p>
      <p className="error-text" style={{ fontSize: "0.85rem" }}>
        Note: Block mode requires the native enforcement component to be installed on an endpoint. Until then,
        policies can be authored and assigned, but nothing is actually intercepted yet.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "3rem" }}>Enabled</th>
            <th>Name</th>
            <th>Mode</th>
            <th>Scope</th>
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
                <StatusBadge kind={p.enforcementMode === "BLOCK" ? "fail" : "warn"} label={ENFORCEMENT_LABEL[p.enforcementMode]} />
              </td>
              <td>{p.removableMediaOnly ? "Removable media" : "All writes"}</td>
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
              <td colSpan={8}>No policies yet.</td>
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
          <select value={enforcementMode} onChange={(e) => setEnforcementMode(e.target.value as DlpEnforcementMode)}>
            {ENFORCEMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {ENFORCEMENT_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={removableMediaOnly} onChange={(e) => setRemovableMediaOnly(e.target.checked)} />
          Removable media only (USB drives etc.) — uncheck to apply to all file writes
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
