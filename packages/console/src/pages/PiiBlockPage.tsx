import { useEffect, useState, type FormEvent } from "react";
import { IdCard, Pencil, Plus, Trash2 } from "lucide-react";
import type { PiiPatternKey } from "@em/shared";
import BulkPolicyAssignPanel from "../components/BulkPolicyAssignPanel";
import {
  useAddPiiBlockRule,
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
import AddFromDataTypes from "../components/AddFromDataTypes";
import type { PiiBlockPolicyDetail } from "../api/types";
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
  IconButton,
  RowMenu,
  Skeleton,
  Switch,
  Tag,
  useConfirm,
} from "../components/ui";

// Policy page template (EPM / DLP): section header → policy list → selected policy's tabs.

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
  const confirm = useConfirm();

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

  async function handleDeleteRule(ruleId: string, label: string) {
    const confirmed = await confirm({
      title: `Remove "${label}"?`,
      body: "Assigned endpoints stop blocking this category of personal data at their next sync.",
      confirmLabel: "Remove category",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteRule.mutate({ policyId: policy.id, ruleId });
  }

  return (
    <div className="app-stack">
      <AddFromDataTypes target="piiBlock" policyId={policy.id} />
      {policy.rules.length === 0 ? (
        <EmptyState icon={IdCard} title="No PII categories yet">
          Add a category below. A policy with no categories never blocks anything.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Regulations</th>
                <th scope="col">
                  <span className="app-vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {policy.rules.map((r) => {
                const def = PII_PATTERN_OPTIONS.find((p) => p.key === r.value);
                const label = def?.label ?? r.value;
                return (
                  <tr key={r.id}>
                    <td>{def ? def.label : <span className="ep-mono">{r.value}</span>}</td>
                    <td>
                      {def ? (
                        <div className="app-badge-row">
                          {def.regulations.map((reg) => (
                            <Tag key={reg}>{reg}</Tag>
                          ))}
                        </div>
                      ) : (
                        <span className="app-muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="app-cell-actions">
                        <IconButton
                          icon={Trash2}
                          label={`Delete ${label}`}
                          onClick={() => handleDeleteRule(r.id, label)}
                          disabled={deleteRule.isPending}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleAdd} className="app-inset-form">
        <span className="app-subhead">Add PII category</span>
        {availablePatterns.length > 0 ? (
          <>
            <Field
              label="Category"
              htmlFor="pii-rule-category"
              required
              help="Blocks file writes, clipboard copies, and uploads containing this category of personal data on assigned endpoints."
            >
              <select
                id="pii-rule-category"
                className="ep-select"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value as PiiPatternKey)}
              >
                {availablePatterns.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label} ({p.regulations.join("/")})
                  </option>
                ))}
              </select>
            </Field>
            {addRule.isError && <Alert tone="critical">{(addRule.error as Error).message}</Alert>}
            <div className="app-actions-row app-end">
              <Button type="submit" variant="primary" disabled={addRule.isPending || !selectedKey}>
                {addRule.isPending ? "Adding…" : "Add category"}
              </Button>
            </div>
          </>
        ) : (
          <p className="app-muted">Every PII category is already covered by this policy.</p>
        )}
      </form>
    </div>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = usePiiBlockAssignments(policyId);
  const assign = useAssignPiiBlockPolicy();
  const unassign = useUnassignPiiBlockPolicy();
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
  const { data: breakdown } = usePiiBlockAgentBreakdown(policyId);
  return (
    <SyncStatusTable
      rows={breakdown?.agents ?? []}
      explanation="No block-event log exists for this module — this shows whether each endpoint last applied the current PII category list successfully."
    />
  );
}

function SettingsPanel({ policy }: { policy: PiiBlockPolicyDetail }) {
  const updatePolicy = useUpdatePiiBlockPolicy();
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

export default function PiiBlockPage() {
  const { data: policies, isLoading, isError, error, refetch } = usePiiBlockPolicies();
  const createPolicy = useCreatePiiBlockPolicy();
  const updatePolicy = useUpdatePiiBlockPolicy();
  const deletePolicy = useDeletePiiBlockPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const bulkAssign = useAssignPiiBlockPolicy();

  const { data: policy } = usePiiBlockPolicy(selectedId);

  function togglePolicySelect(id: string) {
    setSelectedPolicyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAllPolicies() {
    setSelectedPolicyIds((prev) => (policies && prev.length === policies.length ? [] : (policies?.map((p) => p.id) ?? [])));
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm({
      title: `Delete policy "${name}"?`,
      body: "Its PII categories stop being blocked on every assigned endpoint at their next sync. This cannot be undone.",
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
        title="PII data blocking"
        description="Block file writes, clipboard copies, and uploads containing selected categories of personal data — email addresses, card numbers, government IDs, and similar — on assigned endpoints. Each policy is a list of PII categories from the same catalog Data Discovery and DLP already use, so a category means the same thing everywhere in this product."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        }
      />

      <Alert tone="warn" title="Enforcement isn't live yet">
        Agent-side enforcement for this module isn't wired up yet — policies can be authored and assigned now, ready
        for when it ships, but assigned endpoints won't actually block anything yet (same phased rollout as DLP's Block
        mode).
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
              title="Couldn't load PII blocking policies"
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
            icon={IdCard}
            title="No PII blocking policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, add the PII categories to block, then assign it to groups or endpoints.
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
                    Categories
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
          meta={`${policy.rules.length} ${policy.rules.length === 1 ? "category" : "categories"}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "rules", label: "Blocked categories", content: <RulesPanel policy={policy} /> },
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
