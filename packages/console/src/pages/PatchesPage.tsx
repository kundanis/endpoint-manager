import { Fragment, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, ListChecks, PackageCheck, Power, Send, SearchX, Timer, Trash2, X } from "lucide-react";
import type { NormalizedSeverity } from "../api/types";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import {
  useAgents,
  useAgentsMissingPatch,
  useAssetGroups,
  useAutoPatchPolicies,
  useCreateAutoPatchPolicy,
  useDeleteAutoPatchPolicy,
  useDispatchCommand,
  useDispatchPatchJob,
  usePatchJob,
  usePatchJobs,
  usePatchSummary,
  useUpdateAutoPatchPolicy,
} from "../api/hooks";
import EndpointLabel from "../components/EndpointLabel";
import {
  Alert,
  Badge,
  BulkBar,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  FormFooter,
  FormGrid,
  FormSection,
  IconButton,
  KeyValueList,
  Kpi,
  KpiStrip,
  PageHeader,
  Pagination,
  Pill,
  Row,
  Skeleton,
  Status,
  Switch,
  Toolbar,
  useConfirm,
  usePagedList,
  type BadgeTone,
} from "../components/ui";
import { formatBytes, formatDate, formatDateTime } from "../format";

// Per-patch drill-down: the endpoints this update is missing on, each selectable, with a
// one-click dispatch of just this patch to the chosen machines.
function MissingPatchEndpoints({
  patchDefinitionId,
  updateId,
  title,
  groupId,
  agentId,
}: {
  patchDefinitionId: string;
  updateId: string;
  title: string;
  groupId?: string;
  agentId?: string;
}) {
  const { data: missing } = useAgentsMissingPatch(patchDefinitionId, groupId, agentId);
  const dispatch = useDispatchPatchJob();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);

  if (!missing) return <Skeleton lines={2} />;
  if (missing.length === 0) return <p className="app-text">No endpoints are missing this patch right now.</p>;

  const allSelected = missing.length > 0 && missing.every((m) => selected.has(m.agentId));
  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(missing!.map((m) => m.agentId)));
  }
  function handleDispatch() {
    const agentIds = [...selected];
    if (agentIds.length === 0) return;
    setJobId(null);
    dispatch.mutate(
      { updateIds: [updateId], agentIds, groupIds: [] },
      { onSuccess: (r) => { setJobId(r.jobId); setSelected(new Set()); } },
    );
  }

  return (
    <div className="app-stack-sm">
      <div className="app-table-wrap" style={{ background: "var(--ep-surface)" }}>
        <table className="ep-tbl">
          <thead>
            <tr>
              <th className="ep-cb" scope="col">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" aria-label="Select all endpoints" />
              </th>
              <th scope="col">Endpoint missing "{title}"</th>
              <th scope="col">Detected</th>
            </tr>
          </thead>
          <tbody>
            {missing.map((m) => (
              <tr key={m.agentId} className={selected.has(m.agentId) ? "ep-sel" : undefined}>
                <td className="ep-cb">
                  <input
                    type="checkbox"
                    checked={selected.has(m.agentId)}
                    onChange={() => toggle(m.agentId)}
                    aria-label={`Select ${m.hostname}`}
                  />
                </td>
                <td><EndpointLabel hostname={m.hostname} agentId={m.agentId} /></td>
                <td>{formatDateTime(m.detectedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="app-actions-row">
        <Button size="sm" icon={Send} onClick={handleDispatch} disabled={selected.size === 0 || dispatch.isPending}>
          {dispatch.isPending ? "Dispatching…" : `Dispatch to selected (${selected.size})`}
        </Button>
      </div>
      {jobId && (
        <Alert tone="success">Dispatched. Each endpoint installs on its next check-in; track progress under Patch jobs below.</Alert>
      )}
      {dispatch.isError && <Alert tone="critical">{(dispatch.error as Error).message}</Alert>}
    </div>
  );
}

const SEVERITY_TONES: Record<NormalizedSeverity, BadgeTone> = {
  CRITICAL: "crit",
  HIGH: "high",
  MEDIUM: "med",
  LOW: "low",
  UNKNOWN: "neu",
};

const NORMALIZED_SEVERITIES: NormalizedSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
const SEVERITY_LABELS: Record<NormalizedSeverity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNKNOWN: "Unknown",
};

// What kind of update this is, from Windows Update's categories - shown when Microsoft gives no
// severity rating (common for cumulative, .NET Framework, definition and tool updates), and as
// the short explanation until an endpoint reports Microsoft's own description.
function patchKind(categories: string[], title: string): { label: string; explanation: string } {
  const has = (c: string) => categories.some((x) => x.toLowerCase() === c);
  if (/malicious software removal tool/i.test(title))
    return { label: "Malware removal tool", explanation: "Microsoft's monthly tool that finds and removes widespread malware." };
  if (has("definition updates"))
    return { label: "Definition update", explanation: "New detection signatures so Microsoft Defender recognises the latest threats." };
  if (has("security updates"))
    return { label: "Security update", explanation: "Fixes security vulnerabilities that attackers could exploit." };
  if (has("critical updates")) return { label: "Critical update", explanation: "Fixes a serious, non-security problem." };
  if (has("update rollups")) return { label: "Update rollup", explanation: "Several fixes released together." };
  if (has("feature packs") || has("upgrades")) return { label: "Feature update", explanation: "Adds or changes features." };
  if (has("drivers")) return { label: "Driver update", explanation: "Updates a hardware driver." };
  return { label: "Update", explanation: "Fixes and improvements from the vendor." };
}

// Microsoft's support article for a KB number.
function kbUrl(kb: string): string {
  return `https://support.microsoft.com/help/${kb.replace(/^KB/i, "")}`;
}

// The fixed severity word as the badge; the vendor's own wording ("Important") follows when
// it says something different. Unrated updates say what kind of update they are instead.
function PatchSeverity({
  severity,
  normalized,
  kind,
}: {
  severity: string | null;
  normalized: NormalizedSeverity;
  kind?: string;
}) {
  if (!severity)
    return (
      <span className="app-muted" title="Microsoft publishes no severity rating for this update">
        Not rated{kind ? ` · ${kind}` : ""}
      </span>
    );
  const label = SEVERITY_LABELS[normalized];
  return (
    <>
      <Badge tone={SEVERITY_TONES[normalized]}>{label}</Badge>
      {severity.toLowerCase() !== label.toLowerCase() && <span className="app-muted"> ({severity})</span>}
    </>
  );
}

function AutomaticModePanel() {
  const { data: policies, isLoading } = useAutoPatchPolicies();
  const { data: groups } = useAssetGroups();
  const createPolicy = useCreateAutoPatchPolicy();
  const updatePolicy = useUpdateAutoPatchPolicy();
  const deletePolicy = useDeleteAutoPatchPolicy();
  const confirm = useConfirm();

  const [minSeverity, setMinSeverity] = useState<NormalizedSeverity>("CRITICAL");
  const [groupIds, setGroupIds] = useState<string[]>([]);

  function toggleGroup(groupId: string) {
    setGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createPolicy.mutate({ minSeverity, groupIds, enabled: true }, { onSuccess: () => setGroupIds([]) });
  }

  async function handleRemove(id: string, severityLabel: string) {
    const confirmed = await confirm({
      title: `Remove the "${severityLabel} and Above" Automatic-Mode Policy?`,
      body: "Missing patches it would have covered are no longer dispatched automatically. Jobs already dispatched are not affected.",
      confirmLabel: "Remove policy",
      tone: "danger",
    });
    if (!confirmed) return;
    deletePolicy.mutate(id);
  }

  return (
    <Card title="Automatic Mode" hint={policies ? `${policies.length} ${policies.length === 1 ? "policy" : "policies"}` : undefined}>
      <div className="app-stack">
        <p className="app-text">
          A standing policy that auto-dispatches any currently-missing patch at or above the chosen severity, on its own —
          no manual selection needed. Leave "Target groups" empty to cover every enrolled endpoint. Checked roughly every
          couple of minutes.
        </p>
        {isLoading ? (
          <Skeleton lines={2} />
        ) : !policies || policies.length === 0 ? (
          <EmptyState icon={Timer} title="No automatic-mode policies yet">
            Everything is manual dispatch. Add a policy below to auto-deploy patches at or above a severity.
          </EmptyState>
        ) : (
          <div className="app-table-wrap">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Enabled</th>
                  <th scope="col">Minimum severity</th>
                  <th scope="col">Target groups</th>
                  <th scope="col">Last ran</th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Switch
                        checked={p.enabled}
                        onChange={(enabled) => updatePolicy.mutate({ id: p.id, enabled })}
                        label={p.enabled ? "Enabled" : "Paused"}
                      />
                    </td>
                    <td>
                      <Badge tone={SEVERITY_TONES[p.minSeverity]}>{SEVERITY_LABELS[p.minSeverity]}</Badge> and above
                    </td>
                    <td>{p.groupNames.join(", ") || "All endpoints"}</td>
                    <td>{p.lastRunAt ? formatDateTime(p.lastRunAt) : <span className="app-muted">Not yet run</span>}</td>
                    <td>
                      <div className="app-cell-actions">
                        <IconButton
                          icon={Trash2}
                          label={`Remove ${SEVERITY_LABELS[p.minSeverity]} and above policy`}
                          onClick={() => handleRemove(p.id, SEVERITY_LABELS[p.minSeverity])}
                          disabled={deletePolicy.isPending}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={handleCreate} className="app-inset-form">
          <span className="app-subhead">Add Policy</span>
          <FormGrid>
            <Field label="Minimum severity to auto-deploy" htmlFor="auto-patch-min-severity">
              <select
                id="auto-patch-min-severity"
                className="ep-select"
                value={minSeverity}
                onChange={(e) => setMinSeverity(e.target.value as NormalizedSeverity)}
              >
                {NORMALIZED_SEVERITIES.filter((s) => s !== "UNKNOWN").map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABELS[s]} and above
                  </option>
                ))}
              </select>
            </Field>
          </FormGrid>
          {groups && groups.length > 0 && (
            <div className="app-stack-sm" role="group" aria-label="Target groups">
              <span className="app-subhead">Target Groups (Leave Blank for All Endpoints)</span>
              <div className="app-check-grid">
                {groups.map((g) => (
                  <Check
                    key={g.id}
                    checked={groupIds.includes(g.id)}
                    onChange={() => toggleGroup(g.id)}
                    label={
                      <>
                        {g.path ?? g.name} <span className="app-muted ep-num">({g.memberCount})</span>
                      </>
                    }
                  />
                ))}
              </div>
            </div>
          )}
          {createPolicy.isError && <Alert tone="critical">{(createPolicy.error as Error).message}</Alert>}
          <div className="app-actions-row app-end">
            <Button type="submit" disabled={createPolicy.isPending}>
              {createPolicy.isPending ? "Adding…" : "Add policy"}
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

// Patch task / job status words → Meridian badge or pill.
function TaskStatus({ status, label }: { status: string; label?: string }) {
  const key = status.toUpperCase();
  const text = label ?? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ");
  if (key === "SUCCESS" || key === "SUCCEEDED" || key === "COMPLETED" || key === "INSTALLED") return <Badge tone="ok">{text}</Badge>;
  if (key === "RUNNING" || key === "DISPATCHED" || key === "IN_PROGRESS") return <Pill tone="neutral">{text}</Pill>;
  return <Status value={status} label={text} />;
}

export default function PatchesPage() {
  // Severity filter - the dashboard's Patch status bars open this page pre-filtered.
  // Endpoint (?agent=) and Group (?group=) filters: an endpoint's Security posture links here
  // with its endpoint picked. Neither = every endpoint, as before.
  const [searchParams, setSearchParams] = useSearchParams();
  const agentFilter = searchParams.get("agent") ?? "";
  const environmentFilter = agentFilter ? "" : (searchParams.get("group") ?? "");
  function setScope(next: { agent?: string; group?: string }) {
    searchParams.delete("agent");
    searchParams.delete("group");
    if (next.agent) searchParams.set("agent", next.agent);
    else if (next.group) searchParams.set("group", next.group);
    setSearchParams(searchParams, { replace: true });
    setSelectedUpdateIds([]);
    setExpandedPatchId(null);
  }
  const setEnvironmentFilter = (groupId: string) => setScope({ group: groupId });
  const severityParam = searchParams.get("severity")?.toUpperCase() ?? "";
  const severityFilter = (NORMALIZED_SEVERITIES as string[]).includes(severityParam) ? (severityParam as NormalizedSeverity) : "";
  function setSeverityFilter(value: string) {
    if (value) searchParams.set("severity", value);
    else searchParams.delete("severity");
    setSearchParams(searchParams, { replace: true });
  }
  const { data: summary, isLoading: summaryLoading, error: summaryError, refetch: refetchSummary } = usePatchSummary(
    environmentFilter || undefined,
    agentFilter || undefined,
  );
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: jobs, isLoading: jobsLoading } = usePatchJobs();
  const dispatchPatch = useDispatchPatchJob();
  const dispatchCommand = useDispatchCommand();
  const confirm = useConfirm();

  const [selectedUpdateIds, setSelectedUpdateIds] = useState<string[]>([]);
  const [expandedPatchId, setExpandedPatchId] = useState<string | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();
  const deployFormRef = useRef<HTMLDivElement>(null);

  const { data: jobDetail } = usePatchJob(selectedJobId);

  const visibleSummary = severityFilter ? (summary ?? []).filter((item) => item.normalizedSeverity === severityFilter) : (summary ?? []);
  const pagedSummary = usePagedList(visibleSummary, 25);
  const pagedJobs = usePagedList(jobs ?? [], 10);

  const severityCount = (s: NormalizedSeverity) => summary?.filter((item) => item.normalizedSeverity === s).length ?? 0;
  const scheduledJobCount = jobs?.filter((j) => j.scheduledAt).length ?? 0;
  const selectedUpdates = summary?.filter((item) => selectedUpdateIds.includes(item.updateId)) ?? [];
  const environmentName = groups?.find((g) => g.id === environmentFilter)?.name;
  const agentName = agentFilter ? (agents?.find((a) => a.id === agentFilter)?.hostname ?? "this endpoint") : undefined;
  const scopeName = agentName ?? (environmentName ? `group ${environmentName}` : undefined);
  // Select all: every update in the current list (after the severity filter).
  const allVisibleSelected = visibleSummary.length > 0 && visibleSummary.every((item) => selectedUpdateIds.includes(item.updateId));
  function toggleAllUpdates() {
    setSelectedUpdateIds(allVisibleSelected ? [] : visibleSummary.map((item) => item.updateId));
  }

  // "Install on <endpoint/group>": the ticked updates straight to the filtered endpoint or group.
  async function installOnScope() {
    if (!scopeName || selectedUpdateIds.length === 0) return;
    const ok = await confirm({
      title: `Install ${selectedUpdateIds.length} Update(s) on ${scopeName}?`,
      body: "Each endpoint installs them at its next check-in. Some updates need a reboot; the job below shows which.",
      confirmLabel: "Install",
    });
    if (!ok) return;
    dispatchPatch.mutate(
      {
        updateIds: selectedUpdateIds,
        agentIds: agentFilter ? [agentFilter] : [],
        groupIds: agentFilter ? [] : [environmentFilter],
        scheduledAt: null,
      },
      {
        onSuccess: (result) => {
          setSelectedJobId(result.jobId);
          setSelectedUpdateIds([]);
        },
      },
    );
  }

  // "Choose targets" starts from the filtered endpoint or group.
  function chooseTargets() {
    if (agentFilter && !selectedAgentIds.includes(agentFilter)) setSelectedAgentIds((prev) => [...prev, agentFilter]);
    if (environmentFilter && !selectedGroupIds.includes(environmentFilter)) setSelectedGroupIds((prev) => [...prev, environmentFilter]);
    setTimeout(() => deployFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function toggleUpdate(updateId: string) {
    setSelectedUpdateIds((prev) => (prev.includes(updateId) ? prev.filter((id) => id !== updateId) : [...prev, updateId]));
  }

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  function handleDispatch(e: FormEvent) {
    e.preventDefault();
    dispatchPatch.mutate(
      {
        updateIds: selectedUpdateIds,
        agentIds: selectedAgentIds,
        groupIds: selectedGroupIds,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      },
      { onSuccess: (result) => { setSelectedJobId(result.jobId); setScheduledAt(""); } },
    );
  }

  async function rebootNow(agentId: string, hostname: string) {
    const confirmed = await confirm({
      title: `Reboot ${hostname}?`,
      body: "The endpoint restarts 60 seconds after it receives the command, with the message \"Applying Windows updates\". Unsaved work on it is lost.",
      confirmLabel: "Reboot now",
      tone: "danger",
    });
    if (!confirmed) return;
    dispatchCommand.mutate({
      agentIds: [agentId],
      shell: "powershell",
      script: 'shutdown /r /t 60 /c "Applying Windows updates"',
      timeoutSec: 30,
    });
  }

  return (
    <>
      <PageHeader
        title="Patches"
        description={
          scopeName
            ? `Windows updates missing on ${scopeName}, their deployment jobs and automatic mode`
            : "Windows updates missing across the fleet, their deployment jobs and automatic mode"
        }
      />

      <KpiStrip>
        <Kpi
          icon={PackageCheck}
          label="Missing updates"
          value={summary ? <span className="ep-num">{summary.length}</span> : "—"}
          suffix={scopeName ? `on ${scopeName}` : "across the fleet"}
        />
        <Kpi
          label="Critical"
          value={summary ? <span className="ep-num">{severityCount("CRITICAL")}</span> : "—"}
          suffix="updates"
          valueTone={severityCount("CRITICAL") > 0 ? "critical" : undefined}
        />
        <Kpi label="High" value={summary ? <span className="ep-num">{severityCount("HIGH")}</span> : "—"} suffix="updates" />
        <Kpi
          icon={ListChecks}
          label="Patch jobs"
          value={jobs ? <span className="ep-num">{jobs.length}</span> : "—"}
          suffix="dispatched"
          footer={jobs ? `${scheduledJobCount} scheduled` : undefined}
        />
      </KpiStrip>

      <Card flush title={scopeName ? `Missing on ${scopeName}` : "Missing Across the Fleet"} hint="newest first">
        <Toolbar
          right={
            (agentFilter || environmentFilter) && (
              <Button size="sm" onClick={() => setScope({})}>
                Show all endpoints
              </Button>
            )
          }
        >
          <select className="ep-select" aria-label="Endpoint" value={agentFilter} onChange={(e) => setScope({ agent: e.target.value })}>
            <option value="">Endpoint: All</option>
            {agentFilter && !agents?.some((a) => a.id === agentFilter) && <option value={agentFilter}>This endpoint</option>}
            {[...(agents ?? [])]
              .sort((a, b) => a.hostname.localeCompare(b.hostname))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.hostname}
                </option>
              ))}
          </select>
          <select
            className="ep-select"
            aria-label="Group"
            value={environmentFilter}
            onChange={(e) => setEnvironmentFilter(e.target.value)}
          >
            <option value="">Group: All</option>
            {groups?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.path ?? g.name}
              </option>
            ))}
          </select>
          <select className="ep-select" aria-label="Severity" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
            <option value="">Severity: All</option>
            {NORMALIZED_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s === "UNKNOWN" ? "Not rated" : SEVERITY_LABELS[s]}
              </option>
            ))}
          </select>
        </Toolbar>

        <BulkBar count={selectedUpdateIds.length} onClear={() => setSelectedUpdateIds([])}>
          {scopeName && (
            <Button size="sm" variant="primary" icon={Send} onClick={installOnScope} disabled={dispatchPatch.isPending}>
              {dispatchPatch.isPending ? "Dispatching…" : `Install on ${scopeName}`}
            </Button>
          )}
          <Button size="sm" icon={Send} onClick={chooseTargets}>
            Choose targets
          </Button>
        </BulkBar>
        {dispatchPatch.isError && !selectedUpdateIds.length && (
          <div className="ep-cb">
            <Alert tone="critical">{(dispatchPatch.error as Error).message}</Alert>
          </div>
        )}

        {summaryLoading ? (
          <div className="ep-cb">
            <Skeleton lines={6} />
          </div>
        ) : summaryError ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load missing patches"
              action={
                <Button size="sm" onClick={() => refetchSummary()}>
                  Retry
                </Button>
              }
            >
              {(summaryError as Error).message}
            </Alert>
          </div>
        ) : !summary || summary.length === 0 ? (
          scopeName ? (
            <EmptyState
              icon={SearchX}
              title={`No missing patches on ${scopeName}`}
              action={
                <Button size="sm" onClick={() => setScope({})}>
                  Show all endpoints
                </Button>
              }
            >
              Show all endpoints to see patches missing elsewhere.
            </EmptyState>
          ) : (
            <EmptyState icon={PackageCheck} title="No missing patches detected yet">
              Endpoints scan on their own multi-hour cycle — check back after their next scan.
            </EmptyState>
          )
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th className="ep-cb" scope="col">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllUpdates}
                        title="Select all updates"
                        aria-label="Select all updates"
                      />
                    </th>
                    <th scope="col">Title</th>
                    <th scope="col">Severity</th>
                    <th scope="col">KB</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Size
                    </th>
                    <th scope="col">Missing on</th>
                    <th scope="col">Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSummary.pageItems.map((item) => {
                    const isExpanded = expandedPatchId === item.patchDefinitionId;
                    const isSelected = selectedUpdateIds.includes(item.updateId);
                    return (
                      <Fragment key={item.patchDefinitionId}>
                        <tr className={isSelected ? "ep-sel" : undefined}>
                          <td className="ep-cb">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleUpdate(item.updateId)}
                              title="Add to the dispatch form below"
                              aria-label={`Add ${item.title} to the deployment`}
                            />
                          </td>
                          <td>
                            <div className="app-stack-sm">
                              <span>{item.title}</span>
                              <span className="ep-hint app-clamp-2" title={item.description ?? undefined}>
                                {item.description ?? patchKind(item.categories, item.title).explanation}
                              </span>
                            </div>
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <PatchSeverity
                              severity={item.severity}
                              normalized={item.normalizedSeverity}
                              kind={patchKind(item.categories, item.title).label}
                            />
                          </td>
                          <td className="ep-mono">
                            {item.kbArticleIds.length === 0 ? (
                              <span className="app-muted">—</span>
                            ) : (
                              item.kbArticleIds.map((kb, i) => (
                                <Fragment key={kb}>
                                  {i > 0 && ", "}
                                  <a className="ep-link" href={kbUrl(kb)} target="_blank" rel="noreferrer" title="Microsoft's article about this update">
                                    {kb.toUpperCase().startsWith("KB") ? kb : `KB${kb}`}
                                  </a>
                                </Fragment>
                              ))
                            )}
                          </td>
                          <td className="ep-num" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            {formatBytes(item.sizeBytes)}
                          </td>
                          <td>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={isExpanded ? ChevronDown : ChevronRight}
                              aria-expanded={isExpanded}
                              onClick={() => setExpandedPatchId(isExpanded ? null : item.patchDefinitionId)}
                              title="Show the endpoints missing this patch and dispatch to selected"
                            >
                              <span className="ep-num">{item.missingAgentCount}</span> endpoint(s)
                            </Button>
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatDate(item.firstSeenAt)}</td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={7} style={{ background: "var(--ep-surface-2)" }}>
                              <MissingPatchEndpoints
                                patchDefinitionId={item.patchDefinitionId}
                                updateId={item.updateId}
                                title={item.title}
                                groupId={environmentFilter || undefined}
                                agentId={agentFilter || undefined}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="app-text" style={{ padding: "12px 20px", borderTop: "1px solid var(--ep-border)", maxWidth: "none" }}>
              Sorted newest first by when each update was first detected as missing across the fleet — the closest available
              proxy for a release date, since no vendor update catalog is synced into this system.
            </p>
            <Pagination
              page={pagedSummary.page}
              pageSize={pagedSummary.pageSize}
              total={pagedSummary.total}
              noun="updates"
              onPageChange={pagedSummary.setPage}
              onPageSizeChange={pagedSummary.setPageSize}
            />
          </>
        )}
      </Card>

      {selectedUpdateIds.length > 0 && (
        <div ref={deployFormRef} style={{ scrollMarginTop: 16 }}>
          <Row layout="21">
            <Card title={`Deploy ${selectedUpdateIds.length} Selected Update(s)`}>
              <form onSubmit={handleDispatch} className="app-settings-form">
                <FormSection title="Targets" description="Pick groups, individual endpoints, or both.">
                  <div className="app-stack">
                    {groups && groups.length > 0 && (
                      <div className="app-stack-sm" role="group" aria-label="Target groups">
                        <span className="app-subhead">Target Groups</span>
                        <div className="app-check-grid">
                          {groups.map((g) => (
                            <Check
                              key={g.id}
                              checked={selectedGroupIds.includes(g.id)}
                              onChange={() => toggleGroup(g.id)}
                              label={
                                <>
                                  {g.path ?? g.name} <span className="app-muted ep-num">({g.memberCount})</span>
                                </>
                              }
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    <EndpointCheckboxList
                      agents={agents}
                      selectedAgentIds={selectedAgentIds}
                      onToggle={toggleAgent}
                      selectedGroupIds={selectedGroupIds}
                      legend="Target endpoints"
                      renderExtra={(agent) => <Status value={agent.status} />}
                    />
                  </div>
                </FormSection>
                <FormSection title="Schedule" description="Leave blank to dispatch immediately.">
                  <FormGrid>
                    <Field label="Schedule for" htmlFor="patch-scheduled-at" help="Leave blank to dispatch immediately">
                      <input
                        id="patch-scheduled-at"
                        className="ep-input"
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                      />
                    </Field>
                  </FormGrid>
                </FormSection>
                {dispatchPatch.isError && <Alert tone="critical">{(dispatchPatch.error as Error).message}</Alert>}
                <FormFooter>
                  <Button onClick={() => setSelectedUpdateIds([])}>Cancel</Button>
                  <Button
                    type="submit"
                    variant="primary"
                    icon={Send}
                    disabled={dispatchPatch.isPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
                  >
                    {dispatchPatch.isPending ? "Dispatching…" : scheduledAt ? "Schedule" : "Dispatch"}
                  </Button>
                </FormFooter>
              </form>
            </Card>
            <div className="app-stack">
              <Alert tone="info" title="How deployment works">
                Each endpoint installs the selected updates on its next check-in. Some updates need a reboot — the job detail
                below flags them.
              </Alert>
              <Card title="Summary">
                <div className="app-stack">
                  <KeyValueList
                    items={[
                      { label: "Updates", value: <span className="ep-num">{selectedUpdateIds.length}</span> },
                      { label: "Groups", value: <span className="ep-num">{selectedGroupIds.length}</span> },
                      { label: "Endpoints", value: <span className="ep-num">{selectedAgentIds.length}</span> },
                      { label: "Timing", value: scheduledAt ? formatDateTime(new Date(scheduledAt).toISOString()) : "Immediate" },
                    ]}
                  />
                  {selectedUpdates.length > 0 && (
                    <div className="app-stack-sm">
                      <span className="app-subhead">Selected Updates</span>
                      {selectedUpdates.map((u) => (
                        <span key={u.updateId} className="app-text">
                          {u.title}
                          {u.kbArticleIds.length > 0 && <span className="ep-mono app-muted"> · {u.kbArticleIds.join(", ")}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </Row>
        </div>
      )}

      <AutomaticModePanel />

      <Card flush title="Patch Jobs" hint={jobs ? `${jobs.length} total` : undefined}>
        {jobsLoading ? (
          <div className="ep-cb">
            <Skeleton lines={4} />
          </div>
        ) : !jobs || jobs.length === 0 ? (
          <EmptyState icon={ListChecks} title="No patch jobs dispatched yet">
            Tick missing updates above, choose targets and dispatch them — or add an automatic-mode policy.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Updates
                    </th>
                    <th scope="col">Groups</th>
                    <th scope="col">Created</th>
                    <th scope="col">Timing</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedJobs.pageItems.map((job) => (
                    <tr
                      key={job.id}
                      className={`app-clickable ${job.id === selectedJobId ? "ep-sel" : ""}`}
                      onClick={() => setSelectedJobId(job.id)}
                    >
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {job.updateIds.length} update(s)
                      </td>
                      <td>{job.targetGroupNames.join(", ") || <span className="app-muted">—</span>}</td>
                      <td>{formatDateTime(job.createdAt)}</td>
                      <td>
                        {job.scheduledAt ? <Pill tone="warn">Scheduled for {formatDateTime(job.scheduledAt)}</Pill> : "Immediate"}
                      </td>
                      <td>
                        <div className="app-badge-row">
                          {Object.entries(job.taskCounts).map(([status, count]) => (
                            <TaskStatus key={status} status={status} label={`${status}: ${count}`} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pagedJobs.page}
              pageSize={pagedJobs.pageSize}
              total={pagedJobs.total}
              noun="jobs"
              onPageChange={pagedJobs.setPage}
              onPageSizeChange={pagedJobs.setPageSize}
            />
          </>
        )}
      </Card>

      {jobDetail && (
        <Card
          flush
          title="Patch Job Detail"
          hint={formatDateTime(jobDetail.createdAt)}
          actions={<IconButton icon={X} label="Close job detail" onClick={() => setSelectedJobId(undefined)} />}
        >
          {jobDetail.targetGroupNames.length > 0 && (
            <div className="ep-cb">
              <KeyValueList items={[{ label: "Targeted groups", value: jobDetail.targetGroupNames.join(", ") }]} />
            </div>
          )}
          {jobDetail.tasks.length === 0 ? (
            <EmptyState icon={ListChecks} title="No endpoint tasks yet">
              Tasks appear here once the job is dispatched to its target endpoints.
            </EmptyState>
          ) : (
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Endpoint</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reboot</th>
                    <th scope="col">Results</th>
                    <th scope="col">Message</th>
                    <th scope="col">
                      <span className="app-vh">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {jobDetail.tasks.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <EndpointLabel hostname={task.hostname} agentId={task.agentId} />
                      </td>
                      <td>
                        <TaskStatus status={task.status} />
                      </td>
                      <td>{task.rebootRequired ? <Pill tone="warn">Required</Pill> : <span className="app-muted">—</span>}</td>
                      <td>
                        {task.results.map((r) => (
                          <div key={r.updateId} className="ep-mono">
                            {r.updateId.slice(0, 8)}… → code {r.resultCode}
                          </div>
                        ))}
                      </td>
                      <td>{task.message ?? <span className="app-muted">—</span>}</td>
                      <td>
                        {task.rebootRequired && (
                          <div className="app-cell-actions">
                            <Button
                              size="sm"
                              icon={Power}
                              onClick={() => rebootNow(task.agentId, task.hostname)}
                              disabled={dispatchCommand.isPending}
                            >
                              Reboot now
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
