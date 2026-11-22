import { useState, type FormEvent } from "react";
import { Globe, Pencil, Plus, ShieldBan, Trash2 } from "lucide-react";
import BulkPolicyAssignPanel from "../components/BulkPolicyAssignPanel";
import {
  useAddWebBlockRule,
  useAssignWebBlockPolicy,
  useCreateWebBlockPolicy,
  useDeleteWebBlockPolicy,
  useDeleteWebBlockRule,
  useUnassignWebBlockPolicy,
  useUpdateWebBlockPolicy,
  useUpdateWebBlockRule,
  useWebBlockAgentBreakdown,
  useWebBlockAssignments,
  useWebBlockPolicies,
  useWebBlockPolicy,
  type WebBlockRuleInput,
} from "../api/hooks";
import AddFromDataTypes from "../components/AddFromDataTypes";
import type { WebBlockPolicyDetail, WebBlockRuleView } from "../api/types";
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
import { useLinkedPolicySelection } from "../usePolicyLink";

// Policy page template (EPM / DLP): section header → policy list → selected policy's tabs.

const BLANK_RULE_FORM: WebBlockRuleInput = { ruleType: "DOMAIN", value: "", label: "" };

// Splits on comma or semicolon so a whole list of domains can be pasted into the same
// field at once — safe here because a value is always a plain domain name.
function splitBulkValues(raw: string): string[] {
  return [...new Set(raw.split(/[;,]/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

function RulesPanel({ policy }: { policy: WebBlockPolicyDetail }) {
  const addRule = useAddWebBlockRule();
  const updateRule = useUpdateWebBlockRule();
  const deleteRule = useDeleteWebBlockRule();
  const confirmDelete = useConfirm();

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<WebBlockRuleInput>(BLANK_RULE_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const isEditing = editingRuleId !== null;
  const pending = isEditing ? updateRule.isPending : isSubmitting;
  const mutationError = isEditing ? updateRule.error : null;

  function startEdit(rule: WebBlockRuleView) {
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
        { policyId: policy.id, ruleId: editingRuleId, ruleType: "DOMAIN", value: form.value.trim().toLowerCase(), label },
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
        await addRule.mutateAsync({ policyId: policy.id, ruleType: "DOMAIN", value, label });
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
      <AddFromDataTypes target="webBlock" policyId={policy.id} />
      {policy.rules.length === 0 ? (
        <EmptyState icon={Globe} title="No blocked domains yet">
          Add a domain below. A policy with no domains never blocks anything.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Domain</th>
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
        <span className="app-subhead">{isEditing ? "Edit Domain" : "Add Domains"}</span>
        <FormGrid>
          <Field
            label="Domain"
            htmlFor="web-rule-value"
            required
            help={
              isEditing
                ? "Blocked via a hosts-file entry and the Chrome/Edge managed URL blocklist."
                : "Separate several with commas or semicolons. Blocked via a hosts-file entry and the Chrome/Edge managed URL blocklist."
            }
          >
            <input
              id="web-rule-value"
              className="ep-input ep-mono"
              value={form.value}
              onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              placeholder={isEditing ? "drive.google.com" : "drive.google.com, mega.nz"}
              required
            />
          </Field>
          <Field label="Label" htmlFor="web-rule-label" help={isEditing ? undefined : "Applied to every domain added in this batch."}>
            <input
              id="web-rule-label"
              className="ep-input"
              value={form.label ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder='Optional, e.g. "Google Drive"'
            />
          </Field>
        </FormGrid>
        {!!mutationError && <Alert tone="critical">{(mutationError as Error).message}</Alert>}
        {bulkError && <Alert tone="critical">{bulkError}</Alert>}
        <div className="app-actions-row app-end">
          {isEditing && <Button onClick={cancelEdit}>Cancel</Button>}
          <Button type="submit" variant="primary" disabled={pending || !form.value.trim()}>
            {pending ? "Saving…" : isEditing ? "Save changes" : "Add domains"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = useWebBlockAssignments(policyId);
  const assign = useAssignWebBlockPolicy();
  const unassign = useUnassignWebBlockPolicy();
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
  const { data: breakdown } = useWebBlockAgentBreakdown(policyId);
  return (
    <SyncStatusTable
      rows={breakdown?.agents ?? []}
      explanation={
        'No block-event log exists for this module — hosts-file/browser-policy blocking has no convenient "a block just happened" signal. This shows whether each endpoint last applied the current domain list successfully.'
      }
    />
  );
}

function SettingsPanel({ policy }: { policy: WebBlockPolicyDetail }) {
  const updatePolicy = useUpdateWebBlockPolicy();
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

export default function WebBlockPage() {
  const { data: policies, isLoading } = useWebBlockPolicies();
  const createPolicy = useCreateWebBlockPolicy();
  const updatePolicy = useUpdateWebBlockPolicy();
  const deletePolicy = useDeleteWebBlockPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useLinkedPolicySelection();
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const bulkAssign = useAssignWebBlockPolicy();

  const { data: policy } = useWebBlockPolicy(selectedId);

  function togglePolicySelect(id: string) {
    setSelectedPolicyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAllPolicies() {
    setSelectedPolicyIds((prev) => (policies && prev.length === policies.length ? [] : (policies?.map((p) => p.id) ?? [])));
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm({
      title: `Delete Policy "${name}"?`,
      body: "Its domains are unblocked on every assigned endpoint at their next sync. This cannot be undone.",
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
        title="Web & Email Blocking"
        description="Block specific domains — cloud storage, webmail, or any other site — on assigned endpoints. Each domain is blocked two ways: a hosts-file entry (covers any application) and a Chrome/Edge managed URL blocklist entry (survives a hosts-file bypass attempt). Both are re-applied on every sync."
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
        ) : !policies || policies.length === 0 ? (
          <EmptyState
            icon={ShieldBan}
            title="No web blocking policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, add the domains to block, then assign it to groups or endpoints.
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
                    Domains
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
                    <td onClick={(e) => e.stopPropagation()}>
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
          meta={`${policy.rules.length} ${policy.rules.length === 1 ? "domain" : "domains"}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "rules", label: "Blocked domains", content: <RulesPanel policy={policy} /> },
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
