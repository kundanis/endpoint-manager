import { useEffect, useState, type FormEvent } from "react";
import { Activity, ListChecks, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import type { DlpEnforcementMode, DlpRuleType } from "@em/shared";
import {
  useAddDlpRule,
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
import AddFromDataTypes from "../components/AddFromDataTypes";
import type { DlpPolicyDetail, DlpRuleView } from "../api/types";
import EndpointLabel from "../components/EndpointLabel";
import { AssignmentEditor, NewPolicyDialog, PolicyDetail, PolicySettingsForm, SectionHeader } from "../components/policy";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  FormGrid,
  IconButton,
  Kpi,
  KpiStrip,
  Pagination,
  RowMenu,
  Skeleton,
  Switch,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatDateTime } from "../format";

// Policy page template (EPM / DLP): section header → policy list → selected policy's tabs.

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
  const confirm = useConfirm();

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

  function displayValue(r: DlpRuleView) {
    return r.ruleType === "CONTENT_PATTERN" ? (PII_PATTERN_OPTIONS.find((p) => p.key === r.value)?.label ?? r.value) : r.value;
  }

  async function handleDeleteRule(r: DlpRuleView) {
    const confirmed = await confirm({
      title: `Delete rule "${r.label ?? displayValue(r)}"?`,
      body: "Assigned endpoints stop applying it at their next sync.",
      confirmLabel: "Delete rule",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteRule.mutate({ policyId: policy.id, ruleId: r.id });
  }

  return (
    <div className="app-stack">
      <AddFromDataTypes target="dlp" policyId={policy.id} />
      {policy.rules.length === 0 ? (
        <EmptyState icon={ListChecks} title="No rules yet">
          Add one below. A policy with no rules never triggers.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Value</th>
                <th scope="col">Label</th>
                <th scope="col">
                  <span className="app-vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {policy.rules.map((r) => (
                <tr key={r.id} className={r.id === editingRuleId ? "ep-sel" : undefined}>
                  <td>{RULE_TYPE_LABEL[r.ruleType]}</td>
                  <td className={r.ruleType === "CONTENT_PATTERN" ? undefined : "ep-mono"}>{displayValue(r)}</td>
                  <td>{r.label ?? <span className="app-muted">—</span>}</td>
                  <td>
                    <div className="app-cell-actions">
                      <IconButton icon={Pencil} label={`Edit ${displayValue(r)}`} onClick={() => startEdit(r)} />
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${displayValue(r)}`}
                        onClick={() => handleDeleteRule(r)}
                        disabled={deleteRule.isPending}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleSubmit} className="app-inset-form">
        <span className="app-subhead">{isEditing ? "Edit rule" : "Add rule"}</span>
        <FormGrid>
          <Field label="Rule type" htmlFor="dlp-rule-type" help={RULE_TYPE_HINT[form.ruleType]}>
            <select
              id="dlp-rule-type"
              className="ep-select"
              value={form.ruleType}
              onChange={(e) => setForm((prev) => ({ ...prev, ruleType: e.target.value as DlpRuleType, value: "" }))}
            >
              {RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RULE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>

          {form.ruleType === "CONTENT_PATTERN" ? (
            <Field label="Identifier type" htmlFor="dlp-rule-value" required>
              <select
                id="dlp-rule-value"
                className="ep-select"
                value={form.value}
                onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
                required
              >
                <option value="" disabled>
                  Select...
                </option>
                {PII_PATTERN_OPTIONS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Value" htmlFor="dlp-rule-value" required>
              <input
                id="dlp-rule-value"
                type="text"
                className="ep-input ep-mono"
                value={form.value}
                onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
                required
              />
            </Field>
          )}

          <Field label="Label" htmlFor="dlp-rule-label" help="Optional. Friendly name shown on events.">
            <input
              id="dlp-rule-label"
              type="text"
              className="ep-input"
              value={form.label ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder='Friendly name shown on events, e.g. "Codename"'
            />
          </Field>
        </FormGrid>

        {!!mutationError && <Alert tone="critical">{(mutationError as Error).message}</Alert>}
        <div className="app-actions-row app-end">
          {isEditing && <Button onClick={cancelEdit}>Cancel</Button>}
          <Button type="submit" variant="primary" disabled={pending || !form.value.trim()}>
            {pending ? "Saving…" : isEditing ? "Save changes" : "Add rule"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// Enforcement mode + scope fields, shared by the settings form and the new-policy dialog.
function EnforcementFields({
  idPrefix,
  enforcementMode,
  onEnforcementModeChange,
  removableMediaOnly,
  onRemovableMediaOnlyChange,
  removableHint,
}: {
  idPrefix: string;
  enforcementMode: DlpEnforcementMode;
  onEnforcementModeChange: (mode: DlpEnforcementMode) => void;
  removableMediaOnly: boolean;
  onRemovableMediaOnlyChange: (value: boolean) => void;
  removableHint: string;
}) {
  return (
    <>
      <Field label="Enforcement mode" htmlFor={`${idPrefix}-mode`}>
        <select
          id={`${idPrefix}-mode`}
          className="ep-select"
          value={enforcementMode}
          onChange={(e) => onEnforcementModeChange(e.target.value as DlpEnforcementMode)}
        >
          {ENFORCEMENT_MODES.map((m) => (
            <option key={m} value={m}>
              {ENFORCEMENT_LABEL[m]}
            </option>
          ))}
        </select>
      </Field>
      <Check
        checked={removableMediaOnly}
        onChange={onRemovableMediaOnlyChange}
        label="Removable media only (USB drives etc.)"
        hint={removableHint}
      />
    </>
  );
}

function SettingsPanel({ policy }: { policy: DlpPolicyDetail }) {
  const updatePolicy = useUpdateDlpPolicy();
  const [enforcementMode, setEnforcementMode] = useState<DlpEnforcementMode>(policy.enforcementMode);
  const [removableMediaOnly, setRemovableMediaOnly] = useState(policy.removableMediaOnly);

  useEffect(() => {
    setEnforcementMode(policy.enforcementMode);
    setRemovableMediaOnly(policy.removableMediaOnly);
  }, [policy.id, policy.enforcementMode, policy.removableMediaOnly]);

  return (
    <PolicySettingsForm
      policyId={policy.id}
      name={policy.name}
      description={policy.description}
      onSave={(values) => updatePolicy.mutate({ id: policy.id, ...values, enforcementMode, removableMediaOnly })}
      pending={updatePolicy.isPending}
      error={updatePolicy.error}
      saved={updatePolicy.isSuccess}
    >
      <EnforcementFields
        idPrefix={`dlp-settings-${policy.id}`}
        enforcementMode={enforcementMode}
        onEnforcementModeChange={setEnforcementMode}
        removableMediaOnly={removableMediaOnly}
        onRemovableMediaOnlyChange={setRemovableMediaOnly}
        removableHint="Off applies to all file writes."
      />
    </PolicySettingsForm>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = useDlpAssignments(policyId);
  const assign = useAssignDlpPolicy();
  const unassign = useUnassignDlpPolicy();
  return (
    <AssignmentEditor
      assignments={assignments}
      onUnassign={(assignmentId) => unassign.mutate({ policyId, assignmentId })}
      unassignPending={unassign.isPending}
      onAssign={(agentIds, groupIds, done) => assign.mutate({ policyId, agentIds, groupIds }, { onSuccess: done })}
      assignPending={assign.isPending}
      assignError={assign.error}
    />
  );
}

type ActivityFilter = "all" | "blocked" | "alerted";

function ActivityPanel({ policyId }: { policyId: string }) {
  const { data: breakdown, isLoading } = useDlpAgentBreakdown(policyId);
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const agents = breakdown?.agents ?? [];
  const blockedTotal = agents.reduce((sum, a) => sum + a.blockedCount, 0);
  const alertedTotal = agents.reduce((sum, a) => sum + (a.eventCount - a.blockedCount), 0);
  const filtered = agents.filter((a) => {
    if (filter === "blocked") return a.blockedCount > 0;
    if (filter === "alerted") return a.eventCount - a.blockedCount > 0;
    return true;
  });
  const paged = usePagedList(filtered, 25);

  if (isLoading) return <Skeleton />;

  return (
    <div className="app-stack">
      <KpiStrip>
        <Kpi label="Total devices" value={<span className="ep-num">{agents.length}</span>} onClick={() => setFilter("all")} active={filter === "all"} />
        <Kpi
          label="Blocked events"
          value={<span className="ep-num">{blockedTotal}</span>}
          valueTone={blockedTotal > 0 ? "critical" : undefined}
          onClick={() => setFilter("blocked")}
          active={filter === "blocked"}
        />
        <Kpi
          label="Alerted events"
          value={<span className="ep-num">{alertedTotal}</span>}
          valueTone={alertedTotal > 0 ? "warning" : undefined}
          onClick={() => setFilter("alerted")}
          active={filter === "alerted"}
        />
      </KpiStrip>

      {filtered.length === 0 ? (
        agents.length === 0 ? (
          <EmptyState icon={Activity} title="Not assigned to any endpoint yet">
            Assign the policy on the Assignment tab to see each endpoint's events here.
          </EmptyState>
        ) : (
          <EmptyState
            icon={Activity}
            title="No devices match this filter"
            action={
              <Button size="sm" onClick={() => setFilter("all")}>
                Show all devices
              </Button>
            }
          />
        )
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Events
                </th>
                <th scope="col">Blocked</th>
                <th scope="col">Last event</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((a) => (
                <tr key={a.agentId}>
                  <td>
                    <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
                  </td>
                  <td className="ep-num" style={{ textAlign: "right" }}>
                    {a.eventCount}
                  </td>
                  <td>
                    {a.blockedCount > 0 ? (
                      <Badge tone="crit">{`${a.blockedCount} blocked`}</Badge>
                    ) : a.eventCount > 0 ? (
                      <Badge tone="med">Alerted only</Badge>
                    ) : (
                      <Badge tone="ok">No activity</Badge>
                    )}
                  </td>
                  <td className="app-muted">{formatDateTime(a.lastEventAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {paged.total > paged.pageSize && (
            <Pagination
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              noun="devices"
              onPageChange={paged.setPage}
              onPageSizeChange={paged.setPageSize}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function DlpContentPoliciesPage() {
  const { data: policies, isLoading, error, refetch } = useDlpPolicies();
  const createPolicy = useCreateDlpPolicy();
  const updatePolicy = useUpdateDlpPolicy();
  const deletePolicy = useDeleteDlpPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [enforcementMode, setEnforcementMode] = useState<DlpEnforcementMode>("ALERT_ONLY");
  const [removableMediaOnly, setRemovableMediaOnly] = useState(true);

  const { data: policy } = useDlpPolicy(selectedId);

  function toggleEnabled(id: string, enabled: boolean) {
    updatePolicy.mutate({ id, enabled });
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm({
      title: `Delete policy "${name}"?`,
      body: "Its rules stop applying on every assigned endpoint at their next sync. This cannot be undone.",
      confirmLabel: "Delete policy",
      tone: "danger",
    });
    if (!confirmed) return;
    deletePolicy.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(undefined);
      },
    });
  }

  return (
    <>
      <SectionHeader
        title="Content & file policies"
        description="Real-time data loss prevention — each policy is a set of rules you define (content keywords/patterns to detect, destination paths to always block, trusted processes to exempt, file types to restrict to) and can alert or block matching writes on assigned endpoints. Content matches only ever report masked previews, never the raw matched value."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        }
      />

      <Alert tone="warn">
        Block mode requires the native enforcement component to be installed on an endpoint. Until then, policies can
        be authored and assigned, but nothing is actually intercepted yet.
      </Alert>

      <Card flush title="Policies" hint={policies ? `${policies.length} total` : undefined}>
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load policies"
              action={
                <Button size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            >
              {(error as Error).message}
            </Alert>
          </div>
        ) : !policies || policies.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No content policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, add the rules to detect or block, then assign it to groups or endpoints.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Policy</th>
                  <th scope="col">Status</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Scope</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Rules
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Assigned endpoints
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Events
                  </th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} className={`app-clickable ${p.id === selectedId ? "ep-sel" : ""}`} onClick={() => setSelectedId(p.id)}>
                    <td className="ep-host">
                      <b>{p.name}</b>
                      {p.description && <span className="app-row-sub">{p.description}</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span title="Enabled — paused policies are skipped entirely and don't affect any device">
                        <Switch
                          checked={p.enabled}
                          onChange={(enabled) => toggleEnabled(p.id, enabled)}
                          label={p.enabled ? "Enabled" : "Paused"}
                        />
                      </span>
                    </td>
                    <td>
                      <Badge tone={p.enforcementMode === "BLOCK" ? "crit" : "med"}>{ENFORCEMENT_LABEL[p.enforcementMode]}</Badge>
                    </td>
                    <td>{p.removableMediaOnly ? "Removable media" : "All writes"}</td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.ruleCount}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.assignedAgentCount}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.eventCount}
                    </td>
                    <td>
                      <div className="app-cell-actions">
                        <RowMenu
                          label={`Actions for ${p.name}`}
                          items={[
                            { label: "Open policy", icon: Pencil, onSelect: () => setSelectedId(p.id) },
                            {
                              label: "Delete policy",
                              icon: Trash2,
                              danger: true,
                              dividerBefore: true,
                              disabled: deletePolicy.isPending,
                              onSelect: () => handleDelete(p.id, p.name),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {policy && (
        <PolicyDetail
          policyId={policy.id}
          name={policy.name}
          enabled={policy.enabled}
          meta={`${ENFORCEMENT_LABEL[policy.enforcementMode]} · ${policy.removableMediaOnly ? "Removable media" : "All writes"} · ${policy.rules.length} ${policy.rules.length === 1 ? "rule" : "rules"}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "rules", label: "Rules", content: <RulesPanel policy={policy} /> },
            { value: "assignment", label: "Assignment", content: <AssignmentPanel policyId={policy.id} /> },
            { value: "activity", label: "Activity", content: <ActivityPanel policyId={policy.id} /> },
            { value: "settings", label: "Settings", content: <SettingsPanel policy={policy} /> },
          ]}
        />
      )}

      {creating && (
        <NewPolicyDialog
          onClose={() => setCreating(false)}
          pending={createPolicy.isPending}
          error={createPolicy.error}
          onCreate={(values) =>
            createPolicy.mutateAsync({ ...values, enforcementMode, removableMediaOnly }).then((result) => setSelectedId(result.id))
          }
        >
          <EnforcementFields
            idPrefix="dlp-new"
            enforcementMode={enforcementMode}
            onEnforcementModeChange={setEnforcementMode}
            removableMediaOnly={removableMediaOnly}
            onRemovableMediaOnlyChange={setRemovableMediaOnly}
            removableHint="Uncheck to apply to all file writes."
          />
        </NewPolicyDialog>
      )}
    </>
  );
}
