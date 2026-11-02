import { useState, type FormEvent } from "react";
import { AppWindow, ListChecks, Pencil, Plus, Trash2, Users } from "lucide-react";
import type { AppControlRuleType } from "@em/shared";
import BulkPolicyAssignPanel from "../components/BulkPolicyAssignPanel";
import {
  useAddAppControlRule,
  useAppControlAgentBreakdown,
  useAppControlAssignments,
  useAppControlPolicies,
  useAppControlPolicy,
  useAssignAppControlPolicy,
  useCreateAppControlPolicy,
  useDeleteAppControlPolicy,
  useDeleteAppControlRule,
  useUnassignAppControlPolicy,
  useUpdateAppControlPolicy,
  useUpdateAppControlRule,
  type AppControlRuleInput,
} from "../api/hooks";
import AddFromDataTypes from "../components/AddFromDataTypes";
import type { AppControlPolicyDetail, AppControlRuleView } from "../api/types";
import EndpointLabel from "../components/EndpointLabel";
import {
  AssignmentEditor,
  NewPolicyDialog,
  PolicyDetail,
  PolicySettingsForm,
  SectionHeader,
} from "../components/policy";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormGrid,
  IconButton,
  Pagination,
  RowMenu,
  Skeleton,
  Switch,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatDateTime, pluralize } from "../format";

// Policy page template (EPM / DLP): section header → policy list → selected policy's tabs.

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
  const confirmDelete = useConfirm();

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
    <div className="app-stack">
      <AddFromDataTypes target="appControl" policyId={policy.id} />
      {policy.rules.length === 0 ? (
        <EmptyState icon={ListChecks} title="No rules yet">
          Add one below. A policy with no rules never blocks anything.
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
                  <td className="ep-mono">{r.value}</td>
                  <td>{r.label ?? <span className="app-muted">—</span>}</td>
                  <td>
                    <div className="app-cell-actions">
                      <IconButton icon={Pencil} label={`Edit ${r.value}`} onClick={() => startEdit(r)} />
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${r.value}`}
                        onClick={async () => {
                          const ok = await confirmDelete({
                            title: `Remove ${r.value}?`,
                            body: "Endpoints assigned to this policy stop enforcing it at their next sync.",
                            confirmLabel: "Remove rule",
                            tone: "danger",
                          });
                          if (ok) deleteRule.mutate({ policyId: policy.id, ruleId: r.id });
                        }}
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
          <Field label="Rule type" htmlFor="appctl-rule-type" help={RULE_TYPE_HINT[form.ruleType]}>
            <select
              id="appctl-rule-type"
              className="ep-select"
              value={form.ruleType}
              onChange={(e) => setForm((prev) => ({ ...prev, ruleType: e.target.value as AppControlRuleType, value: "" }))}
            >
              {RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RULE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Value"
            htmlFor="appctl-rule-value"
            required
            help={isEditing ? undefined : "Separate several with commas or semicolons."}
          >
            <input
              id="appctl-rule-value"
              type="text"
              className="ep-input ep-mono"
              value={form.value}
              onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              placeholder={isEditing ? undefined : 'e.g. ".vbs, .js, .ps1"'}
              required
            />
          </Field>
          <Field label="Label" htmlFor="appctl-rule-label" help={isEditing ? undefined : "Applied to every rule added from this batch."}>
            <input
              id="appctl-rule-label"
              type="text"
              className="ep-input"
              value={form.label ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder={isEditing ? 'Friendly name shown on the rule list, e.g. "BitTorrent client"' : "Optional"}
            />
          </Field>
        </FormGrid>
        {!!mutationError && <Alert tone="critical">{(mutationError as Error).message}</Alert>}
        {bulkError && <Alert tone="critical">{bulkError}</Alert>}
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

function SettingsPanel({ policy }: { policy: AppControlPolicyDetail }) {
  const updatePolicy = useUpdateAppControlPolicy();
  return (
    <PolicySettingsForm
      policyId={policy.id}
      name={policy.name}
      description={policy.description}
      onSave={(values) => updatePolicy.mutate({ id: policy.id, ...values })}
      pending={updatePolicy.isPending}
      error={updatePolicy.error}
      saved={updatePolicy.isSuccess}
    />
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = useAppControlAssignments(policyId);
  const assign = useAssignAppControlPolicy();
  const unassign = useUnassignAppControlPolicy();
  return (
    <AssignmentEditor
      blocking
      assignments={assignments}
      onUnassign={(assignmentId) => unassign.mutate({ policyId, assignmentId })}
      unassignPending={unassign.isPending}
      onAssign={(agentIds, groupIds, done) => assign.mutate({ policyId, agentIds, groupIds }, { onSuccess: done })}
      assignPending={assign.isPending}
      assignError={assign.error}
    />
  );
}

function ActivityPanel({ policyId }: { policyId: string }) {
  const { data: breakdown, isLoading, isError, error, refetch } = useAppControlAgentBreakdown(policyId);
  const agents = breakdown?.agents ?? [];
  const totalEvents = agents.reduce((sum, a) => sum + a.eventCount, 0);
  const paged = usePagedList(agents, 25);

  if (isLoading) return <Skeleton />;
  if (isError) {
    return (
      <Alert
        tone="critical"
        title="Couldn't load activity"
        action={
          <Button size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        }
      >
        {(error as Error).message}
      </Alert>
    );
  }

  return (
    <div className="app-stack">
      <div className="app-badge-row">
        <Badge tone="neu">{pluralize(agents.length, "assigned device")}</Badge>
        <Badge tone={totalEvents > 0 ? "med" : "neu"}>{pluralize(totalEvents, "block event")}</Badge>
      </div>
      {agents.length === 0 ? (
        <EmptyState icon={Users} title="Not assigned to any endpoint yet">
          Assign the policy to see each endpoint's block events here.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">Events</th>
                <th scope="col">Last event</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((a) => (
                <tr key={a.agentId}>
                  <td>
                    <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
                  </td>
                  <td>
                    {a.eventCount > 0 ? (
                      <Badge tone="med">{pluralize(a.eventCount, "event")}</Badge>
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
            <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} noun="endpoints" onPageChange={paged.setPage} />
          )}
        </div>
      )}
    </div>
  );
}

export default function AppControlPage() {
  const { data: policies, isLoading, isError, error, refetch } = useAppControlPolicies();
  const createPolicy = useCreateAppControlPolicy();
  const updatePolicy = useUpdateAppControlPolicy();
  const deletePolicy = useDeleteAppControlPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const bulkAssign = useAssignAppControlPolicy();

  const { data: policy } = useAppControlPolicy(selectedId);

  function togglePolicySelect(id: string) {
    setSelectedPolicyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAllPolicies() {
    setSelectedPolicyIds((prev) => (policies && prev.length === policies.length ? [] : (policies?.map((p) => p.id) ?? [])));
  }

  function toggleEnabled(id: string, enabled: boolean) {
    updatePolicy.mutate({ id, enabled });
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm({
      title: `Delete policy "${name}"?`,
      body: "Its rules stop being enforced on every assigned endpoint at their next sync. This cannot be undone.",
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

  const allSelected = !!policies && policies.length > 0 && selectedPolicyIds.length === policies.length;

  return (
    <>
      <SectionHeader
        title="Application control"
        description={
          <>
            Restrict which software, utilities, and file extensions are allowed to execute on assigned endpoints. Each
            rule blocks either a file extension (e.g. blocking script types like <span className="ep-mono">.vbs</span>)
            or a specific executable by filename or path. Enforcement uses Windows Software Restriction Policy in
            additive-deny mode — everything stays allowed by default except what a rule explicitly blocks, so a
            misconfigured policy can never accidentally lock out an entire endpoint.
          </>
        }
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        }
      />

      <Card flush title="Policies" hint={policies ? `${policies.length} total` : undefined}>
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : isError ? (
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
            icon={AppWindow}
            title="No application control policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, add the extensions or executables to block, then assign it to groups or endpoints.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th className="ep-cb" scope="col">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAllPolicies} aria-label="Select all policies" />
                  </th>
                  <th scope="col">Policy</th>
                  <th scope="col">Status</th>
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
                  <tr
                    key={p.id}
                    className={`app-clickable ${selectedPolicyIds.includes(p.id) || p.id === selectedId ? "ep-sel" : ""}`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <td className="ep-cb" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedPolicyIds.includes(p.id)}
                        onChange={() => togglePolicySelect(p.id)}
                        aria-label={`Select ${p.name}`}
                      />
                    </td>
                    <td className="ep-host">
                      <b>{p.name}</b>
                      {p.description && <span className="app-row-sub">{p.description}</span>}
                    </td>
                    {/* Paused policies are skipped entirely and don't affect any device. */}
                    <td onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={p.enabled}
                        onChange={(enabled) => toggleEnabled(p.id, enabled)}
                        label={p.enabled ? "Enabled" : "Paused"}
                      />
                    </td>
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
                            { label: "Delete policy", icon: Trash2, danger: true, dividerBefore: true, disabled: deletePolicy.isPending, onSelect: () => handleDelete(p.id, p.name) },
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

      <BulkPolicyAssignPanel
        policyIds={selectedPolicyIds}
        onAssign={(args) => bulkAssign.mutateAsync(args)}
        onDone={() => setSelectedPolicyIds([])}
      />

      {policy && (
        <PolicyDetail
          policyId={policy.id}
          name={policy.name}
          enabled={policy.enabled}
          meta={pluralize(policy.rules.length, "rule")}
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
          onCreate={(values) => createPolicy.mutateAsync(values).then((result) => setSelectedId(result.id))}
        />
      )}
    </>
  );
}
