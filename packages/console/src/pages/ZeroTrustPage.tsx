import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ListChecks, Pencil, Plus, SearchX, ShieldCheck, ShieldQuestion, ShieldX, Trash2, Users } from "lucide-react";
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
  useInstallBuiltInZeroTrustPolicy,
} from "../api/hooks";
import type { ZeroTrustPolicyDetail, ZeroTrustPolicySummary } from "../api/types";
import { CHART_SEMANTIC } from "../chartTheme";
import { NewPolicyDialog, PolicyDetail, PolicySettingsForm } from "../components/policy";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  CoverageTable,
  EmptyState,
  Field,
  FilterChips,
  FormGrid,
  IconButton,
  Kpi,
  KpiStrip,
  Legend,
  PageHeader,
  Pagination,
  Pill,
  RankedBars,
  Row,
  RowMenu,
  Segmented,
  Skeleton,
  Switch,
  Tag,
  Toolbar,
  useConfirm,
  usePagedList,
  useToast,
} from "../components/ui";

// Pattern A-lite (design-system/docs/PAGE_PATTERNS.md): KPI strip + per-endpoint trust table,
// with the policy list → tabbed detail workflow (as WebBlockPage) underneath.

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
  const confirm = useConfirm();

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

  async function handleDelete(conditionId: string, title: string) {
    const confirmed = await confirm({
      title: `Delete condition "${title}"?`,
      body: "It stops counting toward this policy's trust decision on every assigned endpoint. This cannot be undone.",
      confirmLabel: "Delete condition",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteCondition.mutate({ policyId: policy.id, conditionId });
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
    <div className="app-stack">
      {policy.conditions.length === 0 ? (
        <EmptyState icon={ListChecks} title="No conditions yet">
          Add one below. A device is trusted only once every enabled condition has been scanned and passes.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Enabled</th>
                <th scope="col">Key</th>
                <th scope="col">Title</th>
                <th scope="col">Check</th>
                <th scope="col">
                  <span className="app-vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {policy.conditions.map((c) => (
                <tr key={c.id} className={c.id === editingConditionId ? "ep-sel" : undefined}>
                  <td>
                    <span title="Enabled — checked conditions are evaluated by the agent and count toward the trust decision">
                      <Switch
                        checked={c.enabled}
                        onChange={(enabled) => toggleEnabled(c.id, enabled)}
                        label={c.enabled ? "Enabled" : "Disabled"}
                      />
                    </span>
                  </td>
                  <td className="ep-mono">{c.conditionKey}</td>
                  <td>
                    {c.title}
                    {c.description && <span className="app-row-sub">{c.description}</span>}
                  </td>
                  <td className="ep-mono">
                    {c.operator} {c.expectedValue}
                  </td>
                  <td>
                    <div className="app-cell-actions">
                      <IconButton icon={Pencil} label={`Edit ${c.title}`} onClick={() => startEdit(c.id)} />
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${c.title}`}
                        onClick={() => handleDelete(c.id, c.title)}
                        disabled={deleteCondition.isPending}
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
        <span className="app-subhead">{isEditing ? `Edit condition: ${form.conditionKey}` : "Add condition"}</span>
        <FormGrid>
          <Field label="Condition key" htmlFor="zt-cond-key" required>
            <input
              id="zt-cond-key"
              className="ep-input ep-mono"
              type="text"
              value={form.conditionKey}
              onChange={(e) => setForm((prev) => ({ ...prev, conditionKey: e.target.value }))}
              required
            />
          </Field>
          <Field label="Title" htmlFor="zt-cond-title" required>
            <input
              id="zt-cond-title"
              className="ep-input"
              type="text"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              required
            />
          </Field>
          <Field label="Description" htmlFor="zt-cond-desc" span2>
            <textarea
              id="zt-cond-desc"
              className="ep-textarea"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </Field>
          <Field label="Check PowerShell" htmlFor="zt-cond-ps" required span2 help="Must print the current value to stdout.">
            <textarea
              id="zt-cond-ps"
              className="ep-textarea ep-mono"
              rows={3}
              value={form.checkPowerShell}
              onChange={(e) => setForm((prev) => ({ ...prev, checkPowerShell: e.target.value }))}
              required
            />
          </Field>
          <Field label="Operator" htmlFor="zt-cond-op">
            <select
              id="zt-cond-op"
              className="ep-select"
              value={form.operator}
              onChange={(e) => setForm((prev) => ({ ...prev, operator: e.target.value as SecurityRuleOperator }))}
            >
              {OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expected value" htmlFor="zt-cond-expected" required>
            <input
              id="zt-cond-expected"
              className="ep-input ep-mono"
              type="text"
              value={form.expectedValue}
              onChange={(e) => setForm((prev) => ({ ...prev, expectedValue: e.target.value }))}
              required
            />
          </Field>
        </FormGrid>
        {!!mutationError && <Alert tone="critical">{(mutationError as Error).message}</Alert>}
        <div className="app-actions-row app-end">
          {isEditing && <Button onClick={cancelEdit}>Cancel</Button>}
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : isEditing ? "Save changes" : "Add condition"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// Same layout as components/policy.tsx AssignmentEditor, kept local because this page also
// shows each endpoint's OS edition in the picker.
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
    <div className="app-stack">
      <div className="app-stack-sm">
        <span className="app-subhead">Currently assigned</span>
        {assignments && assignments.length === 0 ? (
          <EmptyState icon={Users} title="Not assigned to any endpoint or group yet">
            Pick groups or endpoints below. A policy does nothing until it's assigned.
          </EmptyState>
        ) : (
          <div className="app-table-wrap">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Target</th>
                  <th scope="col">Type</th>
                  <th scope="col">
                    <span className="app-vh">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {assignments?.map((a) => (
                  <tr key={a.id}>
                    <td>{a.hostname ? <EndpointLabel hostname={a.hostname} agentId={a.agentId} /> : a.groupName}</td>
                    <td>{a.hostname ? "Endpoint" : <Badge tone="neu">Group</Badge>}</td>
                    <td>
                      <div className="app-cell-actions">
                        <Button
                          size="sm"
                          onClick={() => unassign.mutate({ policyId, assignmentId: a.id })}
                          disabled={unassign.isPending}
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="app-stack-sm">
        <span className="app-subhead">Assign to</span>
        {groups && groups.length > 0 && (
          <div className="app-check-grid">
            {groups.map((g) => (
              <Check
                key={g.id}
                checked={selectedGroupIds.includes(g.id)}
                onChange={() => toggleGroup(g.id)}
                label={
                  <>
                    {g.name} <span className="app-muted ep-num">({g.memberCount})</span>
                  </>
                }
              />
            ))}
          </div>
        )}

        <EndpointCheckboxList
          agents={agents}
          selectedAgentIds={selectedAgentIds}
          onToggle={toggleAgent}
          selectedGroupIds={selectedGroupIds}
          renderExtra={(agent) => agent.osEditionLabel && <span className="app-muted">({agent.osEditionLabel})</span>}
        />

        {assign.isError && <Alert tone="critical">{(assign.error as Error).message}</Alert>}
        <div className="app-actions-row app-end">
          <Button
            variant="primary"
            onClick={handleAssign}
            disabled={assign.isPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
          >
            {assign.isPending ? "Assigning…" : "Assign"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type FleetTrustFilter = { policyId: string; conditionId?: string } | null;

// Endpoint/policy rows narrowed by trust state. Synced with the ?trust= query param, which is
// what the Dashboard's Zero Trust donut links to.
type TrustFilter = "all" | "trusted" | "not-trusted";

// Fleet-wide view across every enabled policy: per policy, how many of its endpoints are
// NOT compliant, and (once a policy is picked) per condition how many endpoints fail that
// condition. Clicking a policy or condition narrows the table to exactly those endpoints;
// clearing the filter shows every endpoint/policy pair again.
function FleetTrust({
  policies,
  initialFilter = null,
  trustFilter,
  onTrustFilterChange,
  onNewPolicy,
}: {
  policies: ZeroTrustPolicySummary[];
  initialFilter?: FleetTrustFilter;
  trustFilter: TrustFilter;
  onTrustFilterChange: (value: TrustFilter) => void;
  onNewPolicy: () => void;
}) {
  const results = useZeroTrustAgentBreakdowns(policies.map((p) => p.id));
  // Shares the ["agents"] cache with the assignment/override panels; only used to count the
  // endpoints no enabled policy covers ("Not assessed").
  const { data: agents } = useAgents();
  const [filter, setFilter] = useState<FleetTrustFilter>(initialFilter);

  const conditionTitleById = new Map(
    results.flatMap((r) => (r.data?.conditions ?? []).map((c) => [c.id, c.title] as const)),
  );
  const rows = policies.flatMap((p, i) =>
    (results[i]?.data?.agents ?? []).map((a) => ({ ...a, policyId: p.id, policyName: p.name })),
  );
  const policyRows = !filter
    ? rows
    : rows.filter(
        (r) =>
          r.policyId === filter.policyId &&
          (filter.conditionId ? r.nonCompliantConditionIds.includes(filter.conditionId) : !r.trusted),
      );
  const visibleRows = policyRows.filter(
    (r) => trustFilter === "all" || (trustFilter === "trusted" ? r.trusted : !r.trusted),
  );
  const paged = usePagedList(visibleRows, 25);
  const filterLabel = !filter
    ? null
    : filter.conditionId
      ? `Fails condition: ${conditionTitleById.get(filter.conditionId) ?? "…"}`
      : `Not compliant with: ${policies.find((p) => p.id === filter.policyId)?.name ?? "…"}`;
  const loading = results.some((r) => r.isLoading);

  // Endpoint-level verdict: trusted only when every enabled policy it's assigned passes.
  const endpointTrust = new Map<string, boolean>();
  for (const r of rows) endpointTrust.set(r.agentId, (endpointTrust.get(r.agentId) ?? true) && r.trusted);
  const trustedCount = [...endpointTrust.values()].filter(Boolean).length;
  const notTrustedCount = endpointTrust.size - trustedCount;
  const notAssessedCount = agents ? agents.filter((a) => !endpointTrust.has(a.id)).length : null;
  const fleetTotal = agents?.length ?? endpointTrust.size;
  const pct = (n: number) => (fleetTotal > 0 ? `${Math.round((n / fleetTotal) * 100)}%` : "0%");

  const selectedPolicy = filter ? policies.find((p) => p.id === filter.policyId) : undefined;
  const selectedIndex = selectedPolicy ? policies.indexOf(selectedPolicy) : -1;
  const selectedData = selectedIndex >= 0 ? results[selectedIndex]?.data : undefined;

  function clearFilters() {
    setFilter(null);
    onTrustFilterChange("all");
  }

  return (
    <>
      <KpiStrip>
        <Kpi
          icon={ShieldCheck}
          label="Trusted"
          value={loading ? "…" : trustedCount}
          suffix={`${pct(trustedCount)} of ${fleetTotal}`}
          bar={[
            { value: trustedCount, color: CHART_SEMANTIC.ok },
            { value: notTrustedCount, color: CHART_SEMANTIC.critical },
            { value: notAssessedCount ?? 0, color: CHART_SEMANTIC.neutral },
          ]}
          active={trustFilter === "trusted"}
          onClick={() => onTrustFilterChange("trusted")}
        />
        <Kpi
          icon={ShieldX}
          label="Not trusted"
          value={loading ? "…" : notTrustedCount}
          valueTone={notTrustedCount > 0 ? "critical" : undefined}
          suffix={pct(notTrustedCount)}
          footer="failing or not yet scanned on at least one policy"
          active={trustFilter === "not-trusted"}
          onClick={() => onTrustFilterChange("not-trusted")}
        />
        <Kpi
          icon={ShieldQuestion}
          label="Not assessed"
          value={loading || notAssessedCount === null ? "…" : notAssessedCount}
          suffix={notAssessedCount === null ? undefined : pct(notAssessedCount)}
          footer="no enabled policy assigned"
        />
      </KpiStrip>

      {policies.length > 0 && (
        <Row layout="21">
          <Card
            title="Compliance by policy"
            hint="click a policy to list its non-compliant endpoints"
            actions={
              <Legend
                items={[
                  { label: "Compliant", color: CHART_SEMANTIC.ok },
                  { label: "Not compliant", color: CHART_SEMANTIC.critical },
                ]}
              />
            }
          >
            <CoverageTable
              nameHeader="Policy"
              managedHeader="Compliant"
              rows={policies.map((p, i) => {
                const data = results[i]?.data;
                const assigned = data?.agents ?? [];
                const notCompliant = assigned.filter((a) => !a.trusted).length;
                return {
                  key: p.id,
                  name: p.name,
                  sub: data ? `${notCompliant} not compliant of ${assigned.length} assigned` : "Loading…",
                  segments: [
                    { value: assigned.length - notCompliant, color: CHART_SEMANTIC.ok },
                    { value: notCompliant, color: CHART_SEMANTIC.critical },
                  ],
                  managed: assigned.length - notCompliant,
                  total: assigned.length,
                  noData: !data ? "Loading…" : assigned.length === 0 ? "Not assigned to any endpoint yet" : undefined,
                  onSelect: () => setFilter({ policyId: p.id }),
                };
              })}
            />
          </Card>

          <Card
            title={selectedPolicy ? `Conditions — ${selectedPolicy.name}` : "Conditions"}
            hint={selectedPolicy ? "endpoints failing each condition" : undefined}
          >
            {/* Only the clicked policy's conditions, shown once a policy (or one of its
                conditions) is selected — clearing the filter collapses them again. */}
            {!selectedPolicy ? (
              <EmptyState icon={ListChecks} title="Select a policy">
                Click a policy on the left to see how many endpoints fail each of its conditions.
              </EmptyState>
            ) : !selectedData ? (
              <Skeleton lines={3} />
            ) : selectedData.conditions.length === 0 ? (
              <EmptyState icon={ListChecks} title="No conditions in this policy">
                Open the policy below and add conditions to start assessing endpoints.
              </EmptyState>
            ) : (
              <RankedBars
                total={selectedData.agents.length}
                data={selectedData.conditions.map((c) => {
                  const failing = selectedData.agents.filter((a) => a.nonCompliantConditionIds.includes(c.id)).length;
                  return {
                    label: c.title,
                    value: failing,
                    color: failing > 0 ? CHART_SEMANTIC.critical : CHART_SEMANTIC.ok,
                    onSelect: () => setFilter({ policyId: selectedPolicy.id, conditionId: c.id }),
                  };
                })}
              />
            )}
          </Card>
        </Row>
      )}

      <Card flush title="Device trust" hint="all enabled policies">
        <Toolbar
          right={
            <Segmented
              label="Trust status"
              value={trustFilter}
              onChange={onTrustFilterChange}
              options={[
                { value: "all", label: `All ${policyRows.length}` },
                { value: "trusted", label: `Trusted ${policyRows.filter((r) => r.trusted).length}` },
                { value: "not-trusted", label: `Not trusted ${policyRows.filter((r) => !r.trusted).length}` },
              ]}
            />
          }
        >
          <FilterChips chips={filterLabel ? [{ key: "policy", label: filterLabel, onRemove: () => setFilter(null) }] : []} />
        </Toolbar>

        {loading && rows.length === 0 ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No enabled policy is assigned to any endpoint yet"
            action={
              policies.length === 0 ? (
                <Button size="sm" icon={Plus} onClick={onNewPolicy}>
                  New policy
                </Button>
              ) : undefined
            }
          >
            {policies.length === 0
              ? "Create a policy, add its conditions, then assign it to groups or endpoints."
              : "Open a policy below and assign it to groups or endpoints."}
          </EmptyState>
        ) : visibleRows.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No endpoints match"
            action={
              <Button size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          >
            {filter?.conditionId && trustFilter !== "trusted"
              ? "Every endpoint assigned to this policy passes this condition."
              : filter && trustFilter !== "trusted"
                ? "Every endpoint assigned to this policy is compliant."
                : `No endpoint/policy pair is ${trustFilter === "trusted" ? "trusted" : "not trusted"} with the current filters.`}
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Endpoint</th>
                    <th scope="col">Policy</th>
                    <th scope="col">Scanned</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Compliant
                    </th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Non-compliant
                    </th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Error
                    </th>
                    <th scope="col">Failing conditions</th>
                    <th scope="col">Trust status</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.pageItems.map((r) => (
                    <tr key={`${r.policyId}-${r.agentId}`}>
                      <td>
                        <EndpointLabel hostname={r.hostname} agentId={r.agentId} />
                      </td>
                      <td>{r.policyName}</td>
                      <td>{r.scanned ? "Yes" : <Pill tone="warn">Pending first scan</Pill>}</td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {r.passCount}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {r.failCount}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {r.errorCount}
                      </td>
                      <td>
                        {r.nonCompliantConditionIds.length > 0 ? (
                          <div className="app-badge-row">
                            <Badge tone="crit">{r.nonCompliantConditionIds.length} failing</Badge>
                            {r.nonCompliantConditionIds.map((id) => (
                              <Tag key={id}>{conditionTitleById.get(id) ?? "…"}</Tag>
                            ))}
                          </div>
                        ) : (
                          <span className="app-muted">—</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={r.trusted ? "ok" : "crit"}>{r.trusted ? "Trusted" : "Not trusted"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              noun="endpoint/policy pairs"
              onPageChange={paged.setPage}
              onPageSizeChange={paged.setPageSize}
            />
          </>
        )}
      </Card>
    </>
  );
}

function PolicySettingsPanel({ policy }: { policy: ZeroTrustPolicyDetail }) {
  const updatePolicy = useUpdateZeroTrustPolicy();
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
    <Card title="Policy check override (bulk)">
      <div className="app-stack">
        <p className="app-text">
          Force specific policy checks to stop counting against selected devices' compliance verdict, regardless of
          real posture — e.g. a known false positive while a fix rolls out. Applied "Force comply" only actually
          touches devices currently failing the checked category; "Revoke override" is safe to run on all selected
          devices even where nothing is active. Deliberately invisible everywhere else in the tool — no badge, no API
          field, no CSV column — this is the only place to apply or revoke it.
        </p>

        <FormGrid>
          <Field label="Filter by host" htmlFor="zt-override-host">
            <input
              id="zt-override-host"
              className="ep-input"
              type="text"
              placeholder="Filter by hostname…"
              value={hostnameFilter}
              onChange={(e) => setHostnameFilter(e.target.value)}
            />
          </Field>
          <Field label="Filter by user" htmlFor="zt-override-user">
            <input
              id="zt-override-user"
              className="ep-input"
              type="text"
              placeholder="Filter by logged-on user…"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
            />
          </Field>
          <Field
            label="Devices"
            htmlFor="zt-override-devices"
            span2
            help={`Ctrl/Cmd-click or shift-click to select more than one.${selectedAgentIds.length > 0 ? ` ${selectedAgentIds.length} selected.` : ""}`}
          >
            <select
              id="zt-override-devices"
              className="ep-select"
              multiple
              size={10}
              style={{ height: "auto" }}
              value={selectedAgentIds}
              onChange={(e) => setSelectedAgentIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
            >
              {filteredAgents.map((a) => (
                <EndpointOption key={a.id} value={a.id} hostname={a.hostname} agentId={a.id} />
              ))}
            </select>
          </Field>
        </FormGrid>

        <div className="app-stack-sm">
          <span className="app-subhead">Checks</span>
          {conditionKeys && conditionKeys.length > 0 && (
            <div className="app-check-grid">
              {conditionKeys.map((c) => (
                <Check
                  key={c.conditionKey}
                  checked={selectedConditionKeys.includes(c.conditionKey)}
                  onChange={() => toggleConditionKey(c.conditionKey)}
                  label={c.title}
                />
              ))}
            </div>
          )}
          {conditionKeys?.length === 0 && (
            <span className="ep-nodata">No conditions defined yet across any policy — add conditions to a policy first.</span>
          )}
        </div>

        {(forceComply.isError || revoke.isError) && (
          <Alert tone="critical">{((forceComply.error ?? revoke.error) as Error).message}</Alert>
        )}
        {lastResult && <Alert tone="info">{lastResult}</Alert>}

        <div className="app-actions-row app-end">
          <Button onClick={handleRevoke} disabled={!canSubmit || revoke.isPending}>
            {revoke.isPending ? "Revoking…" : "Revoke override"}
          </Button>
          <Button onClick={handleForceComply} disabled={!canSubmit || forceComply.isPending}>
            {forceComply.isPending ? "Applying…" : "Force comply"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

const PAGE_DESCRIPTION =
  'Define device-trust policies — a set of conditions checked directly on each assigned endpoint (OS/patch posture, firewall, disk encryption, required security agents, blacklisted processes). A device is "Trusted" only once every condition in the policy has been scanned and passes.';

export default function ZeroTrustPage() {
  const { data: policies, isLoading, error, refetch } = useZeroTrustPolicies();
  const createPolicy = useCreateZeroTrustPolicy();
  const updatePolicy = useUpdateZeroTrustPolicy();
  const deletePolicy = useDeleteZeroTrustPolicy();
  const confirm = useConfirm();
  const toast = useToast();
  const installBuiltIn = useInstallBuiltInZeroTrustPolicy();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);

  // Dashboard deep links: ?trust=trusted / ?trust=not-trusted preselect the trust filter on
  // the Device trust table. ?trust=not-trusted with a single enabled policy also opens the
  // table already filtered to that policy's non-compliant endpoints.
  const [searchParams, setSearchParams] = useSearchParams();
  const trustParam = searchParams.get("trust");
  const trustFilter: TrustFilter = trustParam === "trusted" ? "trusted" : trustParam === "not-trusted" ? "not-trusted" : "all";
  const enabledPolicies = policies?.filter((p) => p.enabled) ?? [];
  const initialFleetFilter: FleetTrustFilter =
    trustParam === "not-trusted" && enabledPolicies.length === 1
      ? { policyId: enabledPolicies[0].id }
      : null;

  function setTrustFilter(value: TrustFilter) {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete("trust");
    else next.set("trust", value);
    setSearchParams(next, { replace: true });
  }

  const { data: policy } = useZeroTrustPolicy(selectedId);

  function toggleEnabled(id: string, enabled: boolean) {
    updatePolicy.mutate({ id, enabled });
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm({
      title: `Delete policy "${name}"?`,
      body: "Its conditions stop counting toward the trust status of every assigned endpoint. This cannot be undone.",
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

  const header = (
    <PageHeader
      title="Zero Trust"
      description={PAGE_DESCRIPTION}
      actions={
        <>
          <Button icon={ShieldCheck} onClick={handleInstallBuiltIn} disabled={installBuiltIn.isPending}>
            {installBuiltIn.isPending ? "Adding…" : "Add built-in policy"}
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        </>
      }
    />
  );

  function handleInstallBuiltIn() {
    installBuiltIn.mutate(undefined, {
      onSuccess: (r) =>
        toast(
          r.policyCreated
            ? `Added "${r.name}" with ${r.conditionsAdded} conditions. Assign it to endpoints or groups to start checking them.`
            : r.conditionsAdded > 0
              ? `Added ${r.conditionsAdded} missing condition(s) to "${r.name}".`
              : `"${r.name}" is already here with all its conditions.`,
        ),
      onError: (err) => toast((err as Error).message),
    });
  }

  if (isLoading) {
    return (
      <>
        {header}
        <Card>
          <Skeleton lines={6} />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}

      {!!error && (
        <Alert tone="critical" title="Couldn't load Zero Trust policies" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
          {(error as Error).message}
        </Alert>
      )}

      {/* Mounted once policies have loaded, so the deep-link initial filter is computed from real data. */}
      {policies && (
        <FleetTrust
          policies={enabledPolicies}
          initialFilter={initialFleetFilter}
          trustFilter={trustFilter}
          onTrustFilterChange={setTrustFilter}
          onNewPolicy={() => setCreating(true)}
        />
      )}

      {policies && (
        <Card flush title="Policies" hint={`${policies.length} total`}>
          {policies.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No Zero Trust policies yet"
              action={
                <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                  New policy
                </Button>
              }
            >
              Create a policy, add the conditions a device must pass, then assign it to groups or endpoints.
            </EmptyState>
          ) : (
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Policy</th>
                    <th scope="col">Status</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Conditions
                    </th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Assigned endpoints
                    </th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Compliance
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
                        <span title="Enabled — paused policies are skipped entirely and don't affect any device's trust status">
                          <Switch
                            checked={p.enabled}
                            onChange={(enabled) => toggleEnabled(p.id, enabled)}
                            label={p.enabled ? "Enabled" : "Paused"}
                          />
                        </span>
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {p.conditionCount}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {p.assignedAgentCount}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {p.compliancePercent != null ? `${p.compliancePercent}%` : <span className="app-muted">—</span>}
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
      )}

      {policy && (
        <PolicyDetail
          policyId={policy.id}
          name={policy.name}
          enabled={policy.enabled}
          meta={`${policy.conditions.length} ${policy.conditions.length === 1 ? "condition" : "conditions"} · ${policy.assignedAgentCount} assigned`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "conditions", label: `Conditions (${policy.conditions.length})`, content: <ConditionsPanel policy={policy} /> },
            { value: "assignment", label: "Assignment", content: <AssignmentPanel policyId={policy.id} /> },
            { value: "settings", label: "Settings", content: <PolicySettingsPanel policy={policy} /> },
          ]}
        />
      )}

      <OverridePanel />

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
