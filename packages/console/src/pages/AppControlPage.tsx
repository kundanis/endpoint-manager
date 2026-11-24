import { Fragment, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { AppWindow, ChevronDown, ChevronRight, ListChecks, Pencil, Plus, Trash2, Users } from "lucide-react";
import type { AppControlRuleType } from "@em/shared";
import BulkPolicyAssignPanel from "../components/BulkPolicyAssignPanel";
import {
  useAddAppControlRule,
  useAppControlAgentBreakdown,
  useAppControlPolicyAgentEvents,
  useAppControlAssignments,
  useAppControlFeatures,
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
import { AllowlistRulesPanel, AllowlistSettingsPanel } from "../components/AppAllowlist";
import UndefinedApplications from "../components/AppUndefined";
import type { AppControlPolicyDetail, AppControlRuleView } from "../api/types";
import EndpointLabel from "../components/EndpointLabel";
import {
  AssignmentEditor,
  NewPolicyDialog,
  PolicyDetail,
  PolicySettingsForm,
  SectionHeader,
  SyncStatusTable,
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
  Segmented,
  Skeleton,
  Switch,
  Tabs,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatDateTime, pluralize } from "../format";
import { useLinkedPolicySelection } from "../usePolicyLink";
import { useFeatureLicensed } from "../licenseFeatures";

// Policy page template (EPM / DLP): section header → policy list → selected policy's tabs.

const RULE_TYPES: AppControlRuleType[] = ["EXECUTABLE", "PRODUCT", "PUBLISHER", "EXTENSION"];
// Advanced application control (Windows AppLocker) - offered only when the server has it on.
const ADVANCED_RULE_TYPES: AppControlRuleType[] = ["DLL", "ALLOW_PATH"];

const RULE_TYPE_LABEL: Record<AppControlRuleType, string> = {
  EXECUTABLE: "Program name / path",
  PRODUCT: "Product name",
  PUBLISHER: "Publisher",
  EXTENSION: "Script type",
  DLL: "DLL file",
  ALLOW_PATH: "Allow (exception)",
  ALLOW_PUBLISHER: "Publisher (allow)",
  ALLOW_HASH: "File hash (allow)",
  ALLOW_CATALOG: "Common application (allow)",
};

const RULE_TYPE_HINT: Record<AppControlRuleType, string> = {
  EXECUTABLE: 'A program name, e.g. "AnyDesk.exe" (stopped before it opens, and caught when renamed), or a full path, e.g. "C:\\Tools\\nc.exe". * wildcards allowed.',
  PRODUCT: 'The product name stored in the program, e.g. "AnyDesk" or "Telegram Desktop" — catches renamed copies and new versions. * wildcards allowed.',
  PUBLISHER: 'The company that signs the program, e.g. "AnyDesk Software GmbH" — blocks every program from that publisher, whatever its name or version.',
  EXTENSION: 'A script type including the dot, e.g. ".vbs", ".hta" or ".jar" — stops Windows script hosts and Java from running files of that type.',
  DLL: 'A DLL file name, e.g. "evil.dll" (blocked in any folder), or a path, e.g. "C:\\Users\\*\\AppData\\*\\evil.dll". DLLs in the Windows folder are never blocked.',
  ALLOW_PATH: 'A folder or file that is never blocked by any rule on the endpoint, e.g. "C:\\IT\\Scripts" or "\\\\fileserver\\tools\\*". Use it for scripts and programs your IT team runs.',
  ALLOW_PUBLISHER: "Allowlist policies only.",
  ALLOW_HASH: "Allowlist policies only.",
  ALLOW_CATALOG: "Allowlist policies only.",
};

const ADVANCED_EXTENSION_HINT =
  'A file type including the dot, e.g. ".ps1", ".bat", ".cmd", ".vbs", ".js", ".hta", ".msi" or ".jar". PowerShell, batch, VBScript, JavaScript and installer files are also blocked by Windows AppLocker — from an open Command Prompt or PowerShell and in scheduled tasks too.';

const RULE_TYPE_PLACEHOLDER: Record<AppControlRuleType, string> = {
  EXECUTABLE: 'e.g. "AnyDesk.exe, rustdesk.exe"',
  PRODUCT: 'e.g. "Telegram Desktop; AnyDesk"',
  PUBLISHER: 'e.g. "AnyDesk Software GmbH"',
  EXTENSION: 'e.g. ".vbs, .js, .hta"',
  DLL: 'e.g. "evil.dll, C:\\Tools\\hook.dll"',
  ALLOW_PATH: 'e.g. "C:\\IT\\Scripts; \\\\fileserver\\tools"',
  ALLOW_PUBLISHER: "",
  ALLOW_HASH: "",
  ALLOW_CATALOG: "",
};

const BLANK_RULE_FORM: AppControlRuleInput = { ruleType: "EXECUTABLE", value: "", label: "" };

// Splits so a whole list can be pasted into the same field at once. Product and publisher names
// can contain commas ("Example, Inc."), so those split on semicolons only.
const SEMICOLON_ONLY = new Set<AppControlRuleType>(["PRODUCT", "PUBLISHER", "ALLOW_PATH"]);
function splitBulkValues(raw: string, ruleType: AppControlRuleType): string[] {
  return [...new Set(raw.split(SEMICOLON_ONLY.has(ruleType) ? /;/ : /[;,]/).map((v) => v.trim()).filter(Boolean))];
}

// A rule saved before lists were refused, e.g. ".ps1, .bat" as one value: it matches no file.
function isListInOneRule(r: Pick<AppControlRuleView, "ruleType" | "value">): boolean {
  return !SEMICOLON_ONLY.has(r.ruleType) && /[;,]/.test(r.value);
}

function RulesPanel({ policy }: { policy: AppControlPolicyDetail }) {
  const addRule = useAddAppControlRule();
  const updateRule = useUpdateAppControlRule();
  const deleteRule = useDeleteAppControlRule();
  const confirmDelete = useConfirm();
  const advanced = useAppControlFeatures().data?.advanced ?? false;

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

    const allValues = splitBulkValues(form.value, form.ruleType);
    if (allValues.length === 0) return;

    // Editing to a list ("…, …"): this rule keeps the first value and the rest become new rules.
    let values = allValues;
    if (editingRuleId) {
      try {
        await updateRule.mutateAsync({ policyId: policy.id, ruleId: editingRuleId, ruleType: form.ruleType, value: allValues[0], label });
      } catch {
        return; // shown under the form from updateRule.error
      }
      values = allValues.slice(1);
      setEditingRuleId(null);
      if (values.length === 0) {
        setForm(BLANK_RULE_FORM);
        return;
      }
    }

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
                  <td>
                    {RULE_TYPE_LABEL[r.ruleType]}
                    {((ADVANCED_RULE_TYPES.includes(r.ruleType) && !advanced) || isListInOneRule(r)) && (
                      <>
                        {" "}
                        <span title={isListInOneRule(r) ? "Several values saved in one rule match nothing. Edit the rule and save it to split it into one rule per value." : undefined}>
                          <Badge tone="neu">Not enforced</Badge>
                        </span>
                      </>
                    )}
                  </td>
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
        <span className="app-subhead">{isEditing ? "Edit Rule" : "Add Rule"}</span>
        <FormGrid>
          <Field
            label="Rule type"
            htmlFor="appctl-rule-type"
            help={advanced && form.ruleType === "EXTENSION" ? ADVANCED_EXTENSION_HINT : RULE_TYPE_HINT[form.ruleType]}
          >
            <select
              id="appctl-rule-type"
              className="ep-select"
              value={form.ruleType}
              onChange={(e) => setForm((prev) => ({ ...prev, ruleType: e.target.value as AppControlRuleType, value: "" }))}
            >
              {[...RULE_TYPES, ...ADVANCED_RULE_TYPES.filter((t) => advanced || t === form.ruleType)].map((t) => (
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
            help={isEditing ? undefined : SEMICOLON_ONLY.has(form.ruleType) ? "Separate several with semicolons." : "Separate several with commas or semicolons."}
          >
            <input
              id="appctl-rule-value"
              type="text"
              className="ep-input ep-mono"
              value={form.value}
              onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              placeholder={isEditing ? undefined : RULE_TYPE_PLACEHOLDER[form.ruleType]}
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
    <div className="app-stack">
      {policy.mode === "ALLOWLIST" && <AllowlistSettingsPanel key={policy.id} policy={policy} />}
      <PolicySettingsForm
        policyId={policy.id}
        name={policy.name}
        description={policy.description}
        onSave={(values) => updatePolicy.mutate({ id: policy.id, ...values })}
        pending={updatePolicy.isPending}
        error={updatePolicy.error}
        saved={updatePolicy.isSuccess}
      />
    </div>
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

function SyncStatusPanel({ policyId }: { policyId: string }) {
  const { data: breakdown } = useAppControlAgentBreakdown(policyId);
  return <SyncStatusTable rows={breakdown?.agents ?? []} explanation="Whether each endpoint last applied this policy's rules. Endpoints report every 20 seconds while they are online; blocked programs are listed on the Events tab. Needs Windows agent 0.2.18 or later." />;
}

// Events tab: one row per assigned endpoint; select a row to list that endpoint's blocked
// programs under this policy, newest first, with the rule that matched.
function AgentEvents({ policyId, agentId }: { policyId: string; agentId: string }) {
  const { data, isLoading, error } = useAppControlPolicyAgentEvents(policyId, agentId);
  const paged = usePagedList(data ?? [], 25);
  if (isLoading) return <Skeleton lines={2} />;
  if (error) return <Alert tone="critical">{(error as Error).message}</Alert>;
  if (!data || data.length === 0) return <span className="app-muted">No events on this endpoint.</span>;
  return (
    <div className="app-table-scroll">
      <table className="ep-tbl">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Program</th>
            <th scope="col">File</th>
            <th scope="col">Rule</th>
          </tr>
        </thead>
        <tbody>
          {paged.pageItems.map((e) => (
            <tr key={e.id}>
              <td className="app-muted" style={{ whiteSpace: "nowrap" }}>
                {formatDateTime(e.occurredAt)}
              </td>
              <td>{e.processName ?? "—"}</td>
              <td className="ep-mono" style={{ overflowWrap: "anywhere" }}>
                {e.matchedPath ?? "—"}
              </td>
              <td>
                {e.ruleValue ? (
                  <>
                    <span className="ep-mono">{e.ruleValue}</span>
                    <span className="app-row-sub">
                      {e.ruleType ? RULE_TYPE_LABEL[e.ruleType] : "Rule"}
                      {e.ruleLabel ? ` · ${e.ruleLabel}` : ""}
                    </span>
                  </>
                ) : e.ruleDeleted ? (
                  <span className="app-muted">Deleted rule</span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {paged.total > paged.pageSize && (
        <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} noun="events" onPageChange={paged.setPage} />
      )}
    </div>
  );
}

function EventsPanel({ policyId }: { policyId: string }) {
  const { data: breakdown, isLoading, isError, error, refetch } = useAppControlAgentBreakdown(policyId);
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const agents = breakdown?.agents ?? [];
  const totalEvents = agents.reduce((sum, a) => sum + a.eventCount, 0);
  const paged = usePagedList(agents, 25);

  if (isLoading) return <Skeleton />;
  if (isError) {
    return (
      <Alert
        tone="critical"
        title="Couldn't load events"
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
                <th scope="col">
                  <span className="app-vh">Show events</span>
                </th>
                <th scope="col">Endpoint</th>
                <th scope="col">Events</th>
                <th scope="col">Last event</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((a) => {
                const open = openAgentId === a.agentId;
                return (
                  <Fragment key={a.agentId}>
                    <tr>
                      <td className="ep-cb">
                        {a.eventCount > 0 && (
                          <IconButton
                            icon={open ? ChevronDown : ChevronRight}
                            label={open ? `Hide events on ${a.hostname}` : `Show events on ${a.hostname}`}
                            onClick={() => setOpenAgentId(open ? null : a.agentId)}
                          />
                        )}
                      </td>
                      <td>
                        <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
                      </td>
                      <td>
                        {a.eventCount > 0 ? (
                          <Badge tone="med">{pluralize(a.eventCount, "event")}</Badge>
                        ) : (
                          <Badge tone="ok">No events</Badge>
                        )}
                      </td>
                      <td className="app-muted">{formatDateTime(a.lastEventAt)}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={4} style={{ background: "var(--ep-surface-2)" }}>
                          <AgentEvents policyId={policyId} agentId={a.agentId} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
  const allowlistLicensed = useFeatureLicensed().licensed("EPM_ALLOWLIST");
  const { data: policies, isLoading, isError, error, refetch } = useAppControlPolicies();
  const createPolicy = useCreateAppControlPolicy();
  const updatePolicy = useUpdateAppControlPolicy();
  const deletePolicy = useDeleteAppControlPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useLinkedPolicySelection();
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newMode, setNewMode] = useState<"BLOCK" | "ALLOWLIST">("BLOCK");
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "undefined" ? "undefined" : "policies";
  const advanced = useAppControlFeatures().data?.advanced ?? false;
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
      title: `Delete Policy "${name}"?`,
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
        title="Application Control"
        description={
          <>
            Block programs on assigned endpoints by name, product, publisher or script type. A program named in a rule
            (e.g. <span className="ep-mono">AnyDesk.exe</span>) is stopped before it opens; renamed copies, other
            versions and product or publisher matches are closed the moment they start. Everything else stays
            allowed, and Windows itself and the Endpoint IQ agent can never be blocked. Needs Windows agent 0.2.18 or
            later.
            {advanced && (
              <>
                {" "}
                An <b>allowlist</b> policy works the other way round: Windows and what it needs always run, plus the
                applications you allow; every other program and setup is blocked by Windows. Needs Windows agent 0.2.30
                or later and Windows Pro, Enterprise or Education.
              </>
            )}
          </>
        }
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        }
      />

      <Tabs
        items={[
          { label: "Policies", value: "policies" },
          { label: "Undefined Applications", value: "undefined" },
        ]}
        value={view}
        onChange={(v) => setSearchParams(v === "undefined" ? { view: "undefined" } : {}, { replace: true })}
      />

      {view === "undefined" ? (
        <UndefinedApplications />
      ) : (
      <>
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
                      <b>{p.name}</b>{" "}
                      {p.mode === "ALLOWLIST" && <Badge tone="high">Allowlist</Badge>}
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
          meta={
            policy.mode === "ALLOWLIST"
              ? `Allowlist · ${pluralize(policy.rules.length, "allowed application")}`
              : pluralize(policy.rules.length, "rule")
          }
          onClose={() => setSelectedId(undefined)}
          tabs={
            policy.mode === "ALLOWLIST"
              ? [
                  { value: "rules", label: "Allowed applications", content: <AllowlistRulesPanel policy={policy} /> },
                  { value: "assignment", label: "Assignment", content: <AssignmentPanel policyId={policy.id} /> },
                  { value: "events", label: "Events", content: <EventsPanel policyId={policy.id} /> },
                  { value: "sync", label: "Sync status", content: <SyncStatusPanel policyId={policy.id} /> },
                  { value: "settings", label: "Settings", content: <SettingsPanel policy={policy} /> },
                ]
              : [
                  { value: "rules", label: "Rules", content: <RulesPanel policy={policy} /> },
                  { value: "assignment", label: "Assignment", content: <AssignmentPanel policyId={policy.id} /> },
                  { value: "events", label: "Events", content: <EventsPanel policyId={policy.id} /> },
                  { value: "sync", label: "Sync status", content: <SyncStatusPanel policyId={policy.id} /> },
                  { value: "settings", label: "Settings", content: <SettingsPanel policy={policy} /> },
                ]
          }
        />
      )}

      </>
      )}

      {creating && (
        <NewPolicyDialog
          onClose={() => {
            setCreating(false);
            setNewMode("BLOCK");
          }}
          pending={createPolicy.isPending}
          error={createPolicy.error}
          onCreate={(values) => createPolicy.mutateAsync({ ...values, mode: newMode }).then((result) => setSelectedId(result.id))}
        >
          {advanced && (
            <Field
              label="Type"
              htmlFor="new-appctl-mode"
              help={
                newMode === "ALLOWLIST"
                  ? "Windows and what it needs always run. Every other program and setup is blocked unless you allow it, from a list of common applications or your own. Assign it to a test endpoint first."
                  : "Blocks the programs its rules name; everything else runs."
              }
            >
              <Segmented
                label="Type"
                options={[
                  { value: "BLOCK", label: "Block list" },
                  { value: "ALLOWLIST", label: allowlistLicensed ? "Allowlist" : "Allowlist (not in your licence)" },
                ]}
                value={newMode}
                // Allowlisting is licensed on its own (EPM_ALLOWLIST).
                onChange={(v) => (v === "ALLOWLIST" && !allowlistLicensed ? undefined : setNewMode(v))}
              />
            </Field>
          )}
        </NewPolicyDialog>
      )}
    </>
  );
}
