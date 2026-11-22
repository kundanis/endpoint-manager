import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2, Usb } from "lucide-react";
import BulkPolicyAssignPanel from "../components/BulkPolicyAssignPanel";
import {
  useAddUsbControlRule,
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

const BLANK_RULE_FORM: UsbControlRuleInput = { ruleType: "USB_SERIAL", value: "", label: "" };

function splitBulkValues(raw: string): string[] {
  return [...new Set(raw.split(/[;,]/).map((v) => v.trim()).filter(Boolean))];
}

function RulesPanel({ policy }: { policy: UsbControlPolicyDetail }) {
  const addRule = useAddUsbControlRule();
  const updateRule = useUpdateUsbControlRule();
  const deleteRule = useDeleteUsbControlRule();
  const confirm = useConfirm();

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

  async function handleDeleteRule(rule: UsbControlRuleView) {
    const confirmed = await confirm({
      title: `Remove ${rule.value}?`,
      body: "Once it's off the list, this drive is disabled on every assigned endpoint after their next sync.",
      confirmLabel: "Remove serial number",
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
    <div className="app-stack">
      {policy.rules.length === 0 ? (
        <EmptyState icon={Usb} title="No allowed serial numbers yet">
          A policy with none disables every USB storage device on its assigned endpoints. Add the serial numbers to allow below.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Serial number</th>
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
        <span className="app-subhead">{isEditing ? "Edit Serial Number" : "Add Serial Numbers"}</span>
        <FormGrid>
          <Field
            label="USB drive serial number"
            htmlFor="usb-rule-value"
            required
            help={
              isEditing
                ? "Read from the drive's own PnP device ID. Any USB storage device whose serial isn't in this list is disabled on the endpoint shortly after it's inserted."
                : "Separate several with commas or semicolons. Read from the drive's own PnP device ID. Any USB storage device whose serial isn't in this list is disabled on the endpoint shortly after it's inserted."
            }
          >
            <input
              id="usb-rule-value"
              className="ep-input ep-mono"
              value={form.value}
              onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
              placeholder={isEditing ? "E.g. E1A2B3C4D5E6F7" : "E1A2B3C4D5E6F7, 001A2B3C"}
              required
            />
          </Field>
          <Field label="Label" htmlFor="usb-rule-label" help={isEditing ? undefined : "Applied to every serial number added in this batch."}>
            <input
              id="usb-rule-label"
              className="ep-input"
              value={form.label ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder='Optional, e.g. "IT-issued backup drive"'
            />
          </Field>
        </FormGrid>
        {!!mutationError && <Alert tone="critical">{(mutationError as Error).message}</Alert>}
        {bulkError && <Alert tone="critical">{bulkError}</Alert>}
        <div className="app-actions-row app-end">
          {isEditing && <Button onClick={cancelEdit}>Cancel</Button>}
          <Button type="submit" variant="primary" disabled={pending || !form.value.trim()}>
            {pending ? "Saving…" : isEditing ? "Save changes" : "Add serial numbers"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = useUsbControlAssignments(policyId);
  const assign = useAssignUsbControlPolicy();
  const unassign = useUnassignUsbControlPolicy();
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
  const { data: breakdown } = useUsbControlAgentBreakdown(policyId);
  return (
    <SyncStatusTable
      rows={breakdown?.agents ?? []}
      explanation={
        "Shows whether each endpoint last applied the current serial whitelist successfully. Disabled-device history is on each endpoint's own detail page."
      }
    />
  );
}

function SettingsPanel({ policy }: { policy: UsbControlPolicyDetail }) {
  const updatePolicy = useUpdateUsbControlPolicy();
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

export default function UsbControlPage() {
  const { data: policies, isLoading, isError, error, refetch } = useUsbControlPolicies();
  const createPolicy = useCreateUsbControlPolicy();
  const updatePolicy = useUpdateUsbControlPolicy();
  const deletePolicy = useDeleteUsbControlPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useLinkedPolicySelection();
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const bulkAssign = useAssignUsbControlPolicy();

  const { data: policy } = useUsbControlPolicy(selectedId);

  function togglePolicySelect(id: string) {
    setSelectedPolicyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAllPolicies() {
    setSelectedPolicyIds((prev) => (policies && prev.length === policies.length ? [] : (policies?.map((p) => p.id) ?? [])));
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm({
      title: `Delete Policy "${name}"?`,
      body: "Its endpoints stop enforcing this serial whitelist at their next sync. This cannot be undone.",
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
        title="USB Device Control"
        description="Whitelist specific USB storage devices by serial number on assigned endpoints — any USB drive not on the list is disabled shortly after it's inserted. Enforced by an agent poll loop that disables the specific Windows PnP device instance of any unrecognized drive, and reported as an audit event on the endpoint's own detail page."
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
              title="Couldn't load USB device control policies"
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
            icon={Usb}
            title="No USB device control policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, add the serial numbers to allow, then assign it to groups or endpoints.
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
                    Serial numbers
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
          meta={`${policy.rules.length} ${policy.rules.length === 1 ? "serial number" : "serial numbers"}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "rules", label: "Allowed serial numbers", content: <RulesPanel policy={policy} /> },
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
