import { useState, type FormEvent } from "react";
import { Network, Pencil, Plus, Trash2 } from "lucide-react";
import BulkPolicyAssignPanel from "../components/BulkPolicyAssignPanel";
import {
  useAddIpBlockRule,
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
  Button,
  Card,
  EmptyState,
  Field,
  FormGrid,
  IconButton,
  RowMenu,
  Skeleton,
  Switch,
  useConfirm,
} from "../components/ui";

// Policy page template (EPM / DLP): section header → policy list → selected policy's tabs.

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
  const confirm = useConfirm();

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

  async function handleDeleteRule(rule: IpBlockRuleView) {
    const confirmed = await confirm({
      title: `Remove ${rule.value}?`,
      body: "It's unblocked on every assigned endpoint at their next sync.",
      confirmLabel: "Remove address",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteRule.mutate({ policyId: policy.id, ruleId: rule.id });
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
    <div className="app-stack">
      {policy.rules.length === 0 ? (
        <EmptyState icon={Network} title="No blocked addresses yet">
          Add an IP address or CIDR range below. A policy with no addresses never blocks anything.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">IP / CIDR</th>
                <th scope="col">Label</th>
                <th scope="col">
                  <span className="app-vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {policy.rules.map((r) => (
                <tr key={r.id} className={r.id === editingRuleId ? "ep-sel" : undefined}>
                  <td className="ep-mono">{r.value}</td>
                  <td>{r.label ?? <span className="app-muted">—</span>}</td>
                  <td>
                    <div className="app-cell-actions">
                      <IconButton icon={Pencil} label={`Edit ${r.value}`} onClick={() => startEdit(r)} />
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${r.value}`}
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
        <span className="app-subhead">{isEditing ? "Edit address" : "Add addresses"}</span>
        <FormGrid>
          <Field
            label="IP address or CIDR range"
            htmlFor="ip-rule-value"
            required
            help={
              isEditing
                ? "Blocked via two Windows Firewall rules (inbound + outbound) that this tool owns exclusively — they win over the endpoint's general firewall policy regardless of what else it allows."
                : "Separate several with commas or semicolons. Blocked via two Windows Firewall rules (inbound + outbound) that this tool owns exclusively — they win over the endpoint's general firewall policy regardless of what else it allows."
            }
          >
            <input
              id="ip-rule-value"
              className="ep-input ep-mono"
              value={form.value}
              onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              placeholder={isEditing ? "203.0.113.5 or 203.0.113.0/24" : "203.0.113.5, 198.51.100.0/24"}
              required
            />
          </Field>
          <Field label="Label" htmlFor="ip-rule-label" help={isEditing ? undefined : "Applied to every address added in this batch."}>
            <input
              id="ip-rule-label"
              className="ep-input"
              value={form.label ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder='Optional, e.g. "Known C2 server"'
            />
          </Field>
        </FormGrid>
        {!!mutationError && <Alert tone="critical">{(mutationError as Error).message}</Alert>}
        {bulkError && <Alert tone="critical">{bulkError}</Alert>}
        <div className="app-actions-row app-end">
          {isEditing && <Button onClick={cancelEdit}>Cancel</Button>}
          <Button type="submit" variant="primary" disabled={pending || !form.value.trim()}>
            {pending ? "Saving…" : isEditing ? "Save changes" : "Add addresses"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = useIpBlockAssignments(policyId);
  const assign = useAssignIpBlockPolicy();
  const unassign = useUnassignIpBlockPolicy();
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
  const { data: breakdown } = useIpBlockAgentBreakdown(policyId);
  return (
    <SyncStatusTable
      rows={breakdown?.agents ?? []}
      explanation={
        'No block-event log exists for this module — asserting a firewall rule has no convenient "a connection was just blocked" signal. This shows whether each endpoint last applied the current address list successfully.'
      }
    />
  );
}

function SettingsPanel({ policy }: { policy: IpBlockPolicyDetail }) {
  const updatePolicy = useUpdateIpBlockPolicy();
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

export default function IpBlockPage() {
  const { data: policies, isLoading, isError, error, refetch } = useIpBlockPolicies();
  const createPolicy = useCreateIpBlockPolicy();
  const updatePolicy = useUpdateIpBlockPolicy();
  const deletePolicy = useDeleteIpBlockPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const bulkAssign = useAssignIpBlockPolicy();

  const { data: policy } = useIpBlockPolicy(selectedId);

  function togglePolicySelect(id: string) {
    setSelectedPolicyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAllPolicies() {
    setSelectedPolicyIds((prev) => (policies && prev.length === policies.length ? [] : (policies?.map((p) => p.id) ?? [])));
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm({
      title: `Delete policy "${name}"?`,
      body: "Its addresses are unblocked on every assigned endpoint at their next sync. This cannot be undone.",
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
        title="IP blocking"
        description="Block specific IP addresses or CIDR ranges on assigned endpoints — regardless of what the endpoint's general firewall policy otherwise allows. Enforced via two dedicated Windows Firewall rules (inbound + outbound) that this tool owns exclusively and re-applies on every sync; an explicit block rule always wins over an allow rule in Windows Firewall, order and specificity aside."
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
              title="Couldn't load IP blocking policies"
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
            icon={Network}
            title="No IP blocking policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, add the addresses to block, then assign it to groups or endpoints.
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
                    Addresses
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
                      <b>{p.name}</b>
                      {p.description && <span className="app-row-sub">{p.description}</span>}
                    </td>
                    <td
                      onClick={(e) => e.stopPropagation()}
                      title="Paused policies are skipped entirely and don't affect any device"
                    >
                      <Switch
                        checked={p.enabled}
                        onChange={(enabled) => updatePolicy.mutate({ id: p.id, enabled })}
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
          meta={`${policy.rules.length} ${policy.rules.length === 1 ? "address" : "addresses"}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "rules", label: "Blocked addresses", content: <RulesPanel policy={policy} /> },
            { value: "assignment", label: "Assignment", content: <AssignmentPanel policyId={policy.id} /> },
            { value: "activity", label: "Sync status", content: <ActivityPanel policyId={policy.id} /> },
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
