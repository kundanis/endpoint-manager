import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Terminal, Trash2, Users } from "lucide-react";
import BulkPolicyAssignPanel from "../components/BulkPolicyAssignPanel";
import {
  useAddCommandBlockRule,
  useAssignCommandBlockPolicy,
  useCommandBlockAgentBreakdown,
  useCommandBlockPolicyAgentEvents,
  useCommandBlockAssignments,
  useCommandBlockPolicies,
  useCommandBlockPolicy,
  useCreateCommandBlockPolicy,
  useDeleteCommandBlockPolicy,
  useDeleteCommandBlockRule,
  useUnassignCommandBlockPolicy,
  useUpdateCommandBlockPolicy,
} from "../api/hooks";
import { COMMAND_PROTECTION_LABELS, COMMAND_PROTECTION_OS_LABEL } from "../commandProtectionLabels";
import type { CommandBlockPolicyDetail } from "../api/types";
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

// What an event's rule was: the protection's plain-words title, or an older custom rule's value.
function ruleTitle(ruleType: string | null, value: string | null): string | null {
  if (!value) return null;
  return ruleType === "PROTECTION" ? (COMMAND_PROTECTION_LABELS.find((p) => p.key === value)?.title ?? value) : value;
}

// The policy's protections: a fixed list of harmful actions (no custom commands). Each endpoint
// receives only the commands for its own OS, and every protection is always enforced (Block).
function ProtectionsPanel({ policy }: { policy: CommandBlockPolicyDetail }) {
  const addRule = useAddCommandBlockRule();
  const deleteRule = useDeleteCommandBlockRule();
  const ruleByKey = new Map(policy.rules.filter((r) => r.ruleType === "PROTECTION").map((r) => [r.value, r]));
  const olderRules = policy.rules.filter((r) => r.ruleType !== "PROTECTION");
  const pending = addRule.isPending || deleteRule.isPending;

  function toggle(key: string, on: boolean) {
    const existing = ruleByKey.get(key);
    if (on && !existing) addRule.mutate({ policyId: policy.id, ruleType: "PROTECTION", value: key, label: null });
    if (!on && existing) deleteRule.mutate({ policyId: policy.id, ruleId: existing.id });
  }

  return (
    <div className="app-stack">
      <Alert tone="info">
        Turn on the harmful actions this policy should stop. Each endpoint gets the commands for its own operating system, and a matching
        command is closed the moment it starts (Windows agent 0.2.20, Linux 0.1.5, macOS 0.1.2 or later). Windows' own processes and the
        Endpoint IQ agent are never touched. Emergency release turns all blocking off.
      </Alert>
      {olderRules.length > 0 && (
        <Alert tone="warn">
          This policy also has {pluralize(olderRules.length, "older custom rule")}, which no longer apply. Only the protections below are
          enforced.
        </Alert>
      )}
      <div className="app-table-wrap">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Protection</th>
              <th scope="col">Applies to</th>
              <th scope="col">
                <span className="app-vh">On or off</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {COMMAND_PROTECTION_LABELS.map((p) => (
              <tr key={p.key}>
                <td>
                  <b>{p.title}</b>
                  <span className="app-row-sub">{p.description}</span>
                </td>
                <td>
                  <div className="app-badge-row">
                    {p.oses.map((os) => (
                      <Badge key={os} tone="neu">
                        {COMMAND_PROTECTION_OS_LABEL[os]}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td>
                  <Switch checked={ruleByKey.has(p.key)} onChange={(on) => toggle(p.key, on)} label={ruleByKey.has(p.key) ? "On" : "Off"} disabled={pending} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!(addRule.error || deleteRule.error) && <Alert tone="critical">{((addRule.error || deleteRule.error) as Error).message}</Alert>}
    </div>
  );
}

function SettingsPanel({ policy }: { policy: CommandBlockPolicyDetail }) {
  const updatePolicy = useUpdateCommandBlockPolicy();
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
  const { data: assignments } = useCommandBlockAssignments(policyId);
  const assign = useAssignCommandBlockPolicy();
  const unassign = useUnassignCommandBlockPolicy();
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
  const { data: breakdown } = useCommandBlockAgentBreakdown(policyId);
  return <SyncStatusTable rows={breakdown?.agents ?? []} explanation="Whether each endpoint last scanned with this policy's rules. Endpoints report after every scan while they are online; matched commands are listed on the Events tab. Needs Windows agent 0.2.18 or later." />;
}

// Events tab: one row per assigned endpoint; select a row to list that endpoint's matched
// commands under this policy, newest first, with the rule that matched and what was done.
function AgentEvents({ policyId, agentId }: { policyId: string; agentId: string }) {
  const { data, isLoading, error } = useCommandBlockPolicyAgentEvents(policyId, agentId);
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
            <th scope="col">Result</th>
            <th scope="col">Process</th>
            <th scope="col">Command line</th>
            <th scope="col">Rule</th>
          </tr>
        </thead>
        <tbody>
          {paged.pageItems.map((e) => (
            <tr key={e.id}>
              <td className="app-muted" style={{ whiteSpace: "nowrap" }}>
                {formatDateTime(e.occurredAt)}
              </td>
              <td>{e.action === "BLOCKED" ? <Badge tone="crit">Blocked</Badge> : <Badge tone="med">Alerted</Badge>}</td>
              <td>{e.processName ?? "—"}</td>
              <td className="ep-mono" style={{ overflowWrap: "anywhere" }}>
                {e.matchedCommandLine}
              </td>
              <td>
                {e.ruleValue ? (
                  <>
                    {ruleTitle(e.ruleType, e.ruleValue)}
                    {e.ruleLabel && <span className="app-row-sub">{e.ruleLabel}</span>}
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
  const { data: breakdown, isLoading, isError, error, refetch } = useCommandBlockAgentBreakdown(policyId);
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const agents = breakdown?.agents ?? [];
  const totalMatches = agents.reduce((sum, a) => sum + a.eventCount, 0);
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
                          <Badge tone="crit">{pluralize(a.eventCount, "event")}</Badge>
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

  const { data: policy } = useCommandBlockPolicy(selectedId);

  function togglePolicySelect(id: string) {
    setSelectedPolicyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAllPolicies() {
    setSelectedPolicyIds((prev) => (policies && prev.length === policies.length ? [] : (policies?.map((p) => p.id) ?? [])));
  }

  function openCreate() {
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
                  <th scope="col" style={{ textAlign: "right" }}>
                    Protections
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
          meta={pluralize(policy.rules.filter((r) => r.ruleType === "PROTECTION").length, "protection")}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "rules", label: "Protections", content: <ProtectionsPanel policy={policy} /> },
            { value: "assignment", label: "Assignment", content: <AssignmentPanel policyId={policy.id} /> },
            { value: "events", label: "Events", content: <EventsPanel policyId={policy.id} /> },
            { value: "sync", label: "Sync status", content: <SyncStatusPanel policyId={policy.id} /> },
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
            createPolicy.mutateAsync(values).then((result) => {
              setSelectedId(result.id);
            })
          }
        />
      )}
    </>
  );
}
