import { useEffect, useState, type FormEvent } from "react";
import { ListChecks, Pencil, Plus, Terminal, Trash2, Users } from "lucide-react";
import BulkPolicyAssignPanel from "../components/BulkPolicyAssignPanel";
import {
  useAddCommandBlockRule,
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

type EnforcementMode = "ALERT_ONLY" | "BLOCK";

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

// Shared by the "New policy" dialog and the Settings tab.
function EnforcementModeField({ id, value, onChange, help }: { id: string; value: EnforcementMode; onChange: (mode: EnforcementMode) => void; help?: string }) {
  return (
    <Field label="Enforcement mode" htmlFor={id} help={help}>
      <select id={id} className="ep-select" value={value} onChange={(e) => onChange(e.target.value as EnforcementMode)}>
        <option value="ALERT_ONLY">Alert only (log matches, never kill)</option>
        <option value="BLOCK">Block (kill matched processes)</option>
      </select>
    </Field>
  );
}

function RulesPanel({ policy }: { policy: CommandBlockPolicyDetail }) {
  const addRule = useAddCommandBlockRule();
  const updateRule = useUpdateCommandBlockRule();
  const deleteRule = useDeleteCommandBlockRule();
  const confirmDelete = useConfirm();

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
    <div className="app-stack">
      <Alert tone="info">
        A short, hardcoded safety net (browsers, explorer.exe, and other core OS/desktop processes) can never be
        matched or killed by any rule here, regardless of type or content.
      </Alert>

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
                  <td>{RULE_TYPE_LABELS[r.ruleType]}</td>
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
          <Field label="Rule type" htmlFor="cmdblock-rule-type">
            <select
              id="cmdblock-rule-type"
              className="ep-select"
              value={ruleType}
              onChange={(e) => setForm((prev) => ({ ...prev, ruleType: e.target.value as CommandBlockRuleInput["ruleType"] }))}
            >
              <option value="COMMAND_PATTERN">Regex pattern</option>
              <option value="EXACT_COMMAND_LINE">Exact command line</option>
              <option value="PROCESS_NAME">Process (.exe) name</option>
            </select>
          </Field>
          <Field
            label={RULE_TYPE_LABELS[ruleType]}
            htmlFor="cmdblock-rule-value"
            required
            help={`${RULE_TYPE_HINTS[ruleType]} Checked every 20 seconds.`}
          >
            <input
              id="cmdblock-rule-value"
              type="text"
              className="ep-input ep-mono"
              value={form.value}
              onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              placeholder={RULE_TYPE_PLACEHOLDERS[ruleType]}
              required
            />
          </Field>
          <Field label="Label" htmlFor="cmdblock-rule-label">
            <input
              id="cmdblock-rule-label"
              type="text"
              className="ep-input"
              value={form.label ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder='Optional, e.g. "Disk formatting tools"'
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

function SettingsPanel({ policy }: { policy: CommandBlockPolicyDetail }) {
  const updatePolicy = useUpdateCommandBlockPolicy();
  const [enforcementMode, setEnforcementMode] = useState<EnforcementMode>(policy.enforcementMode);

  useEffect(() => {
    setEnforcementMode(policy.enforcementMode);
  }, [policy.id, policy.enforcementMode]);

  return (
    <PolicySettingsForm
      policyId={policy.id}
      name={policy.name}
      description={policy.description}
      onSave={(values) => updatePolicy.mutate({ id: policy.id, ...values, enforcementMode })}
      pending={updatePolicy.isPending}
      error={updatePolicy.error}
      saved={updatePolicy.isSuccess}
    >
      <EnforcementModeField
        id={`cmdblock-mode-${policy.id}`}
        value={enforcementMode}
        onChange={setEnforcementMode}
        help="Alert-only lets you test new rules against real traffic — matches are logged as events but nothing is killed — before switching to Block once you've confirmed there are no false positives."
      />
    </PolicySettingsForm>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = useCommandBlockAssignments(policyId);
  const assign = useAssignCommandBlockPolicy();
  const unassign = useUnassignCommandBlockPolicy();
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

function ActivityPanel({ policyId }: { policyId: string }) {
  const { data: breakdown, isLoading, isError, error, refetch } = useCommandBlockAgentBreakdown(policyId);
  const agents = breakdown?.agents ?? [];
  const totalMatches = agents.reduce((sum, a) => sum + a.eventCount, 0);
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
        <Badge tone={totalMatches > 0 ? "crit" : "neu"}>{pluralize(totalMatches, "match", "matches")} (alerted + blocked)</Badge>
      </div>
      {agents.length === 0 ? (
        <EmptyState icon={Users} title="Not assigned to any endpoint yet">
          Assign the policy to see each endpoint's matched commands here.
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
                      <Badge tone="crit">{pluralize(a.eventCount, "event")}</Badge>
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

export default function CommandBlockPage() {
  const { data: policies, isLoading, isError, error, refetch } = useCommandBlockPolicies();
  const createPolicy = useCreateCommandBlockPolicy();
  const updatePolicy = useUpdateCommandBlockPolicy();
  const deletePolicy = useDeleteCommandBlockPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const bulkAssign = useAssignCommandBlockPolicy();
  const [enforcementMode, setEnforcementMode] = useState<EnforcementMode>("ALERT_ONLY");

  const { data: policy } = useCommandBlockPolicy(selectedId);

  function togglePolicySelect(id: string) {
    setSelectedPolicyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAllPolicies() {
    setSelectedPolicyIds((prev) => (policies && prev.length === policies.length ? [] : (policies?.map((p) => p.id) ?? [])));
  }

  function openCreate() {
    setEnforcementMode("ALERT_ONLY");
    setCreating(true);
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
        title="Command blocking"
        description="Block specific commands from running on assigned endpoints. Every 20 seconds the agent scans all running processes against every assigned rule (regex, exact command line, or exact process name); any match is logged, and killed immediately unless the owning policy is in alert-only mode. Because this is a best-effort periodic scan, a matching program can run briefly (up to one scan interval) before being caught. Browsers and core OS/desktop processes can never be matched or killed by any rule, regardless of content."
        actions={
          <Button variant="primary" icon={Plus} onClick={openCreate}>
            New policy
          </Button>
        }
      />

      <Alert tone="warn">
        Matched command lines are stored unmasked, since they are the audit signal needed to understand what was
        blocked — be aware they can occasionally contain a secret (e.g. a password on a "net use" command).
      </Alert>

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
            icon={Terminal}
            title="No command blocking policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={openCreate}>
                New policy
              </Button>
            }
          >
            Create a policy, add the commands to block, then assign it to groups or endpoints.
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
                  <th scope="col">Mode</th>
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
                    <td>{p.enforcementMode === "BLOCK" ? <Badge tone="crit">Block</Badge> : <Badge tone="neu">Alert only</Badge>}</td>
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
          meta={`${policy.enforcementMode === "BLOCK" ? "Block" : "Alert only"} · ${pluralize(policy.rules.length, "rule")}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "rules", label: "Blocked commands", content: <RulesPanel policy={policy} /> },
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
            createPolicy.mutateAsync({ ...values, enforcementMode }).then((result) => {
              setSelectedId(result.id);
              setEnforcementMode("ALERT_ONLY");
            })
          }
        >
          <EnforcementModeField id="new-cmdblock-mode" value={enforcementMode} onChange={setEnforcementMode} />
        </NewPolicyDialog>
      )}
    </>
  );
}
