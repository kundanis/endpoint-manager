import { useState, type FormEvent, type ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleDashed, History, Loader, PackageX, SearchX, Trash2, Upload } from "lucide-react";
import type { AgentBuildInfo, AgentListItem } from "../api/types";
import {
  useAgentLatestBuild,
  useAgentUpdateJob,
  useAgentUpdateJobs,
  useAgents,
  useAssetGroups,
  useDeleteDuplicateAgents,
  useDispatchAgentUpdate,
  useDuplicateAgents,
} from "../api/hooks";
import { CHART_SEMANTIC } from "../chartTheme";
import Collapsible from "../components/Collapsible";
import EndpointLabel from "../components/EndpointLabel";
import {
  Alert,
  Badge,
  BulkBar,
  Button,
  Card,
  Check,
  EmptyState,
  FormFooter,
  IconButton,
  KeyValueList,
  Kpi,
  KpiStrip,
  PageHeader,
  Pagination,
  Pill,
  SearchInput,
  Skeleton,
  Toolbar,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatBytes, formatDateTime, formatRelative } from "../format";

// Pattern B — list page with a rollout KPI strip (design-system/docs/PAGE_PATTERNS.md).

const PLATFORM_LABELS: Record<string, string> = { win32: "Windows", linux: "Linux", darwin: "macOS" };
const PACKAGE_SUFFIX: Record<string, string> = { linux: "-linux", darwin: "-macos" };

const NON_TERMINAL_STATUSES = new Set(["PENDING", "DISPATCHED", "DOWNLOADING", "APPLYING"]);
// A normal update resolves within well under a minute of being dispatched (see
// selfUpdater.ts). Past this, it's likely stuck rather than still genuinely in progress —
// the server's own reconcileStaleAgentUpdateTasks (agentUpdate.service.ts) only force-fails
// it after 15 minutes, so this is an earlier "heads up" hint, not the actual timeout.
const STALLED_HINT_AFTER_MS = 3 * 60 * 1000;

function isLikelyStalled(status: string, dispatchedAt: string | null): boolean {
  if (!NON_TERMINAL_STATUSES.has(status) || !dispatchedAt) return false;
  return Date.now() - new Date(dispatchedAt).getTime() > STALLED_HINT_AFTER_MS;
}

const UPDATE_STATUS_CATEGORIES = ["IN_PROGRESS", "FAILED_PREVIOUS", "AVAILABLE", "UP_TO_DATE", "NO_BUILD"] as const;
type UpdateStatusCategory = (typeof UPDATE_STATUS_CATEGORIES)[number];

const UPDATE_STATUS_CATEGORY_LABEL: Record<UpdateStatusCategory, string> = {
  IN_PROGRESS: "In progress",
  FAILED_PREVIOUS: "Update available (previous attempt failed)",
  AVAILABLE: "Update available",
  UP_TO_DATE: "Up to date",
  NO_BUILD: "No build staged for this platform",
};

// Single source of truth for both the Status column's text and the Status filter's
// bucketing — same logic, computed once, so filtering can never drift from what's shown.
function getUpdateStatus(
  agent: AgentListItem,
  latestVersionFor: (osPlatform: string) => string | null,
): { label: string; category: UpdateStatusCategory } {
  const latestForThisAgent = latestVersionFor(agent.osPlatform);
  const upToDate = latestForThisAgent !== null && agent.agentVersion === latestForThisAgent;
  const noBuildForPlatform = latestForThisAgent === null;
  const task = agent.latestUpdateTask;
  const inProgress = task ? NON_TERMINAL_STATUSES.has(task.status) : false;

  if (inProgress) return { label: `${task!.status} — updating to v${task!.targetVersion}`, category: "IN_PROGRESS" };
  if (noBuildForPlatform) return { label: "No build staged for this platform", category: "NO_BUILD" };
  if (upToDate) return { label: "Up to date", category: "UP_TO_DATE" };
  if (task?.status === "FAILED" && task.targetVersion === latestForThisAgent) {
    return { label: `Update available (previous attempt failed: ${task.message ?? "unknown error"})`, category: "FAILED_PREVIOUS" };
  }
  return { label: "Update available", category: "AVAILABLE" };
}

// Rollout status → Meridian status component. The full status text (with the target version
// or the failure reason) sits under the badge so no detail is lost.
function UpdateStatusCell({ label, category }: { label: string; category: UpdateStatusCategory }) {
  let chip: ReactNode;
  switch (category) {
    case "UP_TO_DATE":
      chip = <Badge tone="ok">Up to date</Badge>;
      break;
    case "AVAILABLE":
      chip = <Badge tone="med">Update available</Badge>;
      break;
    case "FAILED_PREVIOUS":
      chip = <Pill tone="critical">Previous attempt failed</Pill>;
      break;
    case "IN_PROGRESS":
      chip = <Pill tone="warn">In progress</Pill>;
      break;
    case "NO_BUILD":
      chip = <Badge tone="neu">No build</Badge>;
      break;
  }
  const showDetail = category !== "UP_TO_DATE" && category !== "AVAILABLE";
  return (
    <>
      {chip}
      {showDetail && <span className="app-cell-note app-muted">{label}</span>}
    </>
  );
}

function sentenceCase(value: string): string {
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Agent update task states: PENDING → DISPATCHED → DOWNLOADING → APPLYING → SUCCESS / FAILED.
function TaskStatus({ status, label }: { status: string; label?: ReactNode }) {
  const text = label ?? sentenceCase(status);
  if (status === "SUCCESS") return <Badge tone="ok">{text}</Badge>;
  if (status === "FAILED") return <Pill tone="critical">{text}</Pill>;
  if (NON_TERMINAL_STATUSES.has(status)) return <Pill tone="warn">{text}</Pill>;
  return <Badge tone="neu">{text}</Badge>;
}

function BuildPanel({ platform, build }: { platform: string; build: AgentBuildInfo | null }) {
  const platformLabel = PLATFORM_LABELS[platform] ?? platform;
  return (
    <Card title={`${platformLabel} Build`} hint="latest staged" actions={build ? <Badge tone="ok">Staged</Badge> : <Badge tone="neu">Not staged</Badge>}>
      {!build ? (
        <EmptyState icon={PackageX} title={`No ${platformLabel} agent build is staged`}>
          <span>
            Run <code className="ep-mono">npm run package -w @em/agent{PACKAGE_SUFFIX[platform] ?? ""}</code> and redeploy this
            server to make a new version available here.
          </span>
        </EmptyState>
      ) : (
        <div className="app-stack">
          <KeyValueList
            items={[
              { label: "Version", value: build.version, mono: true },
              { label: "Package size", value: <span className="ep-num">{formatBytes(build.fileSizeBytes)}</span> },
              { label: "Built", value: formatDateTime(build.builtAt) },
              { label: "SHA-256", value: <span style={{ overflowWrap: "anywhere" }}>{build.sha256}</span>, mono: true },
            ]}
          />
          <div className="app-stack-sm">
            <span className="app-subhead">What's New</span>
            <div className="app-text" style={{ whiteSpace: "pre-wrap" }}>
              {build.releaseNotes}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// Offline, older-version rows left behind by a re-enrollment from before
// enrollment.service.ts's hostname dedup existed - see findDuplicateAgents' own comment
// server-side for exactly what qualifies as a duplicate here. Purely a cleanup tool: it
// never touches whatever's actually running on the endpoint (if anything still is) - it
// only removes the stale management record, same caveat as any other agent deletion.
function DuplicateEntriesPanel() {
  const { data: duplicates, isLoading, error, refetch } = useDuplicateAgents();
  const deleteDuplicates = useDeleteDuplicateAgents();
  const confirm = useConfirm();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const paged = usePagedList(duplicates ?? [], 25);

  const allSelected = !!duplicates && duplicates.length > 0 && selectedIds.length === duplicates.length;

  function toggleOne(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAll() {
    if (!duplicates) return;
    setSelectedIds(allSelected ? [] : duplicates.map((d) => d.id));
  }

  async function handleDeleteSelected() {
    if (selectedIds.length === 0) return;
    const confirmed = await confirm({
      title: `Delete ${selectedIds.length} Duplicate Agent Record(s)?`,
      body:
        "These are offline, older-version rows for hostnames that already have a newer, currently-active " +
        "record. This only removes the management record - it does not touch anything on any endpoint." +
        "\n\nThis cannot be undone.",
      confirmLabel: "Delete records",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteDuplicates.mutate(selectedIds, { onSuccess: () => setSelectedIds([]) });
  }

  return (
    <Collapsible title="Duplicate Entries" hint={duplicates ? `${duplicates.length} found` : undefined} defaultOpen={false}>
      <div className="app-stack">
        <p className="app-text">
          Offline endpoints running an older agent version than a newer record that already exists for the same
          hostname — almost always a stale identity left over from a previous reinstall, safe to remove once
          confirmed the newer record is the one actually in use.
        </p>
        {isLoading && <Skeleton lines={3} />}
        {!!error && (
          <Alert tone="critical" title="Couldn't load duplicate entries" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
            {(error as Error).message}
          </Alert>
        )}
        {duplicates && duplicates.length === 0 && (
          <EmptyState icon={CircleCheck} title="No duplicate entries found">
            Every hostname has a single management record. Check back after re-enrolling endpoints.
          </EmptyState>
        )}
        {deleteDuplicates.isError && <Alert tone="critical">{(deleteDuplicates.error as Error).message}</Alert>}
        {duplicates && duplicates.length > 0 && (
          <div className="app-table-wrap">
            <BulkBar count={selectedIds.length} onClear={() => setSelectedIds([])}>
              <Button
                size="sm"
                variant="danger"
                icon={Trash2}
                onClick={handleDeleteSelected}
                disabled={selectedIds.length === 0 || deleteDuplicates.isPending}
              >
                {deleteDuplicates.isPending ? "Deleting…" : `Delete selected (${selectedIds.length})`}
              </Button>
            </BulkBar>
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th className="ep-cb" scope="col">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all duplicate entries" />
                  </th>
                  <th scope="col">Endpoint</th>
                  <th scope="col">User</th>
                  <th scope="col">Status</th>
                  <th scope="col">Agent version</th>
                  <th scope="col">Last check-in</th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((d) => (
                  <tr key={d.id} className={selectedIds.includes(d.id) ? "ep-sel" : undefined}>
                    <td className="ep-cb">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(d.id)}
                        onChange={() => toggleOne(d.id)}
                        aria-label={`Select ${d.hostname}`}
                      />
                    </td>
                    <td className="ep-host">
                      <b>
                        <EndpointLabel hostname={d.hostname} agentId={d.id} hideUser />
                      </b>
                      <small>Serial no. {d.serialNumber ?? "—"}</small>
                    </td>
                    <td>{d.lastLoggedOnUser ?? "—"}</td>
                    <td>
                      <Pill tone="neutral">{sentenceCase(d.status)}</Pill>
                    </td>
                    <td className="ep-mono">{d.agentVersion}</td>
                    <td className="app-muted" title={formatDateTime(d.lastCheckinAt, "never")}>
                      {formatRelative(d.lastCheckinAt)}
                    </td>
                    <td>
                      <div className="app-cell-actions">
                        <IconButton
                          icon={Trash2}
                          label={`Delete the duplicate record for ${d.hostname}`}
                          onClick={async () => {
                            const confirmed = await confirm({
                              title: `Delete the Duplicate Record for ${d.hostname}?`,
                              body: "This cannot be undone.",
                              confirmLabel: "Delete record",
                              tone: "danger",
                            });
                            if (!confirmed) return;
                            deleteDuplicates.mutate([d.id]);
                          }}
                          disabled={deleteDuplicates.isPending}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paged.total > paged.pageSize && (
              <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} noun="records" onPageChange={paged.setPage} />
            )}
          </div>
        )}
      </div>
    </Collapsible>
  );
}

export default function AgentUpdatesPage() {
  const { data: build, isLoading: buildLoading, error: buildError, refetch: refetchBuild } = useAgentLatestBuild();
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: jobs, isLoading: jobsLoading, error: jobsError, refetch: refetchJobs } = useAgentUpdateJobs();
  const dispatchUpdate = useDispatchAgentUpdate();

  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();
  const [lastSkipped, setLastSkipped] = useState<string[]>([]);
  const [lastNoBuild, setLastNoBuild] = useState<string[]>([]);
  const [justQueued, setJustQueued] = useState(false);
  const [hostFilter, setHostFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [versionFilter, setVersionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<UpdateStatusCategory | "">("");

  const { data: jobDetail } = useAgentUpdateJob(selectedJobId);

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  function dispatchTo(agentIds: string[], groupIds: string[]) {
    dispatchUpdate.mutate(
      { agentIds, groupIds },
      {
        onSuccess: (result) => {
          // A mixed Windows/Linux/macOS selection fans out into more than one job server-side
          // (see createAgentUpdateJob) - just show whichever one was created most recently.
          setSelectedJobId(result.jobIds[result.jobIds.length - 1]);
          setLastSkipped(result.skippedAgentIds);
          setLastNoBuild(result.noBuildAgentIds);
          // This response only means a task was CREATED (status PENDING), not that the
          // update has actually run anywhere yet — the job detail table below is the real
          // progress indicator (polled every 3s, see useAgentUpdateJob). This banner exists
          // specifically so a click here doesn't get read as "done".
          setJustQueued(true);
          setSelectedAgentIds([]);
          setSelectedGroupIds([]);
        },
      },
    );
  }

  function handlePush(e: FormEvent) {
    e.preventDefault();
    dispatchTo(selectedAgentIds, selectedGroupIds);
  }

  const anyBuildAvailable = Boolean(build?.windows || build?.linux || build?.macos);

  function latestVersionFor(osPlatform: string): string | null {
    if (osPlatform === "linux") return build?.linux?.version ?? null;
    if (osPlatform === "win32") return build?.windows?.version ?? null;
    if (osPlatform === "darwin") return build?.macos?.version ?? null;
    return null;
  }

  const hostTerm = hostFilter.trim().toLowerCase();
  const userTerm = userFilter.trim().toLowerCase();
  const distinctVersions = [...new Set((agents ?? []).map((a) => a.agentVersion))].sort();
  const filteredAgents = (agents ?? [])
    .filter((a) => !hostTerm || a.hostname.toLowerCase().includes(hostTerm))
    .filter((a) => !userTerm || (a.inventory?.lastLoggedOnUser ?? "").toLowerCase().includes(userTerm))
    .filter((a) => !platformFilter || a.osPlatform === platformFilter)
    .filter((a) => !versionFilter || a.agentVersion === versionFilter)
    .filter((a) => !statusFilter || getUpdateStatus(a, latestVersionFor).category === statusFilter);
  const pagedAgents = usePagedList(filteredAgents, 25);
  const pagedJobs = usePagedList(jobs ?? [], 25);

  // Rollout KPI strip: the same status buckets as the Status column/filter, across the whole fleet.
  const categoryCounts: Record<UpdateStatusCategory, number> = { IN_PROGRESS: 0, FAILED_PREVIOUS: 0, AVAILABLE: 0, UP_TO_DATE: 0, NO_BUILD: 0 };
  for (const a of agents ?? []) categoryCounts[getUpdateStatus(a, latestVersionFor).category] += 1;
  const fleetTotal = agents?.length ?? 0;
  const pct = (n: number) => `${fleetTotal > 0 ? Math.round((n / fleetTotal) * 100) : 0}%`;
  // Tiles filter the rollout table below (only rendered while a build is staged); a second
  // click on the active tile clears the filter.
  const kpiFilter = (category: UpdateStatusCategory) =>
    anyBuildAvailable ? () => setStatusFilter((prev) => (prev === category ? "" : category)) : undefined;

  // Only endpoints that actually have a build for their platform can be selected/pushed.
  const selectableAgents = filteredAgents.filter((a) => latestVersionFor(a.osPlatform) !== null);
  const allSelectableSelected = selectableAgents.length > 0 && selectableAgents.every((a) => selectedAgentIds.includes(a.id));
  function toggleSelectAll() {
    const ids = selectableAgents.map((a) => a.id);
    if (allSelectableSelected) {
      const remove = new Set(ids);
      setSelectedAgentIds((prev) => prev.filter((id) => !remove.has(id)));
    } else {
      setSelectedAgentIds((prev) => [...new Set([...prev, ...ids])]);
    }
  }

  function clearFilters() {
    setHostFilter("");
    setUserFilter("");
    setPlatformFilter("");
    setVersionFilter("");
    setStatusFilter("");
  }

  const nothingSelected = selectedAgentIds.length === 0 && selectedGroupIds.length === 0;

  // Note: the Endpoint detail page's "update to vX.Y.Z available" now dispatches directly
  // from there (same useDispatchAgentUpdate mutation) rather than landing here first - so
  // there's no query-param handoff to pick up on mount. That update still shows up below in
  // "Update jobs" and, while in flight, in "Roll out to endpoints"' Status column - both are
  // sourced from the server (agent.latestUpdateTask / the jobs list), not from any selection
  // state local to this page, so they reflect it regardless of which page triggered it.

  return (
    <>
      <PageHeader
        title="Agent Updates"
        description="Push a new agent build to any endpoint or group without re-running the installer by hand — the agent downloads the update, applies it, and restarts itself automatically."
      />

      {agents && (
        <KpiStrip>
          <Kpi
            icon={CircleCheck}
            label="Up to date"
            value={<span className="ep-num">{categoryCounts.UP_TO_DATE}</span>}
            suffix={`of ${fleetTotal} · ${pct(categoryCounts.UP_TO_DATE)}`}
            bar={[
              { value: categoryCounts.UP_TO_DATE, color: CHART_SEMANTIC.ok },
              { value: fleetTotal - categoryCounts.UP_TO_DATE, color: CHART_SEMANTIC.neutral },
            ]}
            onClick={kpiFilter("UP_TO_DATE")}
            active={statusFilter === "UP_TO_DATE"}
          />
          <Kpi
            icon={Upload}
            label="Update available"
            value={<span className="ep-num">{categoryCounts.AVAILABLE}</span>}
            valueTone={categoryCounts.AVAILABLE > 0 ? "warning" : undefined}
            suffix={pct(categoryCounts.AVAILABLE)}
            onClick={kpiFilter("AVAILABLE")}
            active={statusFilter === "AVAILABLE"}
          />
          <Kpi
            icon={CircleAlert}
            label="Previous attempt failed"
            value={<span className="ep-num">{categoryCounts.FAILED_PREVIOUS}</span>}
            valueTone={categoryCounts.FAILED_PREVIOUS > 0 ? "critical" : undefined}
            suffix="update still available"
            onClick={kpiFilter("FAILED_PREVIOUS")}
            active={statusFilter === "FAILED_PREVIOUS"}
          />
          <Kpi
            icon={Loader}
            label="In progress"
            value={<span className="ep-num">{categoryCounts.IN_PROGRESS}</span>}
            suffix="updating now"
            onClick={kpiFilter("IN_PROGRESS")}
            active={statusFilter === "IN_PROGRESS"}
          />
          <Kpi
            icon={CircleDashed}
            label="No build staged"
            value={<span className="ep-num">{categoryCounts.NO_BUILD}</span>}
            suffix="for their platform"
            onClick={kpiFilter("NO_BUILD")}
            active={statusFilter === "NO_BUILD"}
          />
        </KpiStrip>
      )}

      {buildLoading ? (
        <Card>
          <Skeleton />
        </Card>
      ) : buildError ? (
        <Alert tone="critical" title="Couldn't load the staged agent builds" action={<Button size="sm" onClick={() => refetchBuild()}>Retry</Button>}>
          {(buildError as Error).message}
        </Alert>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 16 }}>
          <BuildPanel platform="win32" build={build?.windows ?? null} />
          <BuildPanel platform="linux" build={build?.linux ?? null} />
          <BuildPanel platform="darwin" build={build?.macos ?? null} />
        </div>
      )}

      {anyBuildAvailable && (
        <Card
          flush
          title="Roll Out to Endpoints"
          hint="Windows, Linux and macOS endpoints can be selected together; each gets its own platform's build"
          actions={
            <Button size="sm" icon={Upload} type="submit" form="agent-update-form" disabled={dispatchUpdate.isPending || nothingSelected}>
              {dispatchUpdate.isPending ? "Pushing…" : "Push update"}
            </Button>
          }
        >
          <form id="agent-update-form" onSubmit={handlePush}>
            <Toolbar>
              <SearchInput value={hostFilter} onChange={(e) => setHostFilter(e.target.value)} placeholder="Filter by hostname…" />
              <SearchInput value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="Filter by logged-on user…" />
              <select className="ep-select" aria-label="Platform" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
                <option value="">Platform: All</option>
                <option value="win32">Windows</option>
                <option value="linux">Linux</option>
                <option value="darwin">macOS</option>
              </select>
              <select className="ep-select" aria-label="Current version" value={versionFilter} onChange={(e) => setVersionFilter(e.target.value)}>
                <option value="">Version: All</option>
                {distinctVersions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                className="ep-select"
                aria-label="Status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as UpdateStatusCategory | "")}
              >
                <option value="">Status: All</option>
                {UPDATE_STATUS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {UPDATE_STATUS_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </Toolbar>

            {!agents ? (
              <div className="ep-cb">
                <Skeleton />
              </div>
            ) : agents.length === 0 ? (
              <EmptyState icon={Upload} title="No endpoints enrolled yet">
                Enroll endpoints with an enrollment token, then push updates to them from here.
              </EmptyState>
            ) : filteredAgents.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="No endpoints match this filter"
                action={
                  <Button size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              >
                Try a different hostname, user, platform, version or status.
              </EmptyState>
            ) : (
              <>
                <div className="app-table-scroll">
                  <table className="ep-tbl">
                    <thead>
                      <tr>
                        <th className="ep-cb" scope="col">
                          <input
                            type="checkbox"
                            checked={allSelectableSelected}
                            onChange={toggleSelectAll}
                            disabled={selectableAgents.length === 0}
                            title="Select all eligible endpoints in this list"
                            aria-label="Select all eligible endpoints in this list"
                          />
                        </th>
                        <th scope="col">Endpoint</th>
                        <th scope="col">User name</th>
                        <th scope="col">Platform</th>
                        <th scope="col">Current version</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedAgents.pageItems.map((agent) => {
                        const noBuildForPlatform = latestVersionFor(agent.osPlatform) === null;
                        // Live per-agent status, whether the in-flight/last update was dispatched
                        // from here or from the Endpoint detail page's own "update available"
                        // button - both create the same AgentUpdateTask row this is sourced from.
                        // Same helper the Status filter above buckets by, so the two can never disagree.
                        const { label: statusLabel, category } = getUpdateStatus(agent, latestVersionFor);
                        const checked = selectedAgentIds.includes(agent.id);
                        return (
                          <tr key={agent.id} className={checked ? "ep-sel" : undefined}>
                            <td className="ep-cb">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={noBuildForPlatform}
                                onChange={() => toggleAgent(agent.id)}
                                aria-label={`Select ${agent.hostname}`}
                              />
                            </td>
                            <td className="ep-host">
                              <b>
                                <EndpointLabel hostname={agent.hostname} agentId={agent.id} hideUser />
                              </b>
                              <small>{agent.ipAddress ?? "No IP reported"}</small>
                            </td>
                            <td>{agent.inventory?.lastLoggedOnUser ?? "—"}</td>
                            <td>{PLATFORM_LABELS[agent.osPlatform] ?? agent.osPlatform}</td>
                            <td className="ep-mono">{agent.agentVersion}</td>
                            <td>
                              <UpdateStatusCell label={statusLabel} category={category} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={pagedAgents.page}
                  pageSize={pagedAgents.pageSize}
                  total={pagedAgents.total}
                  noun="endpoints"
                  onPageChange={pagedAgents.setPage}
                  onPageSizeChange={pagedAgents.setPageSize}
                />
              </>
            )}

            {groups && groups.length > 0 && (
              <div className="ep-cb app-stack-sm">
                <span className="app-subhead">Target Groups</span>
                <div className="app-check-grid">
                  {groups.map((g) => (
                    <Check
                      key={g.id}
                      checked={selectedGroupIds.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                      label={g.path ?? g.name}
                      hint={`${g.memberCount} ${g.memberCount === 1 ? "member" : "members"}`}
                    />
                  ))}
                </div>
              </div>
            )}
            {dispatchUpdate.isError && (
              <div className="ep-cb">
                <Alert tone="critical">{(dispatchUpdate.error as Error).message}</Alert>
              </div>
            )}
            <FormFooter>
              <span className="app-muted" style={{ marginRight: "auto" }}>
                <span className="ep-num">{selectedAgentIds.length}</span> endpoints ·{" "}
                <span className="ep-num">{selectedGroupIds.length}</span> groups selected
              </span>
              <Button type="submit" variant="primary" icon={Upload} disabled={dispatchUpdate.isPending || nothingSelected}>
                {dispatchUpdate.isPending ? "Pushing…" : "Push update to selected endpoints"}
              </Button>
            </FormFooter>
          </form>
        </Card>
      )}

      {justQueued && (
        <Alert tone="info" title="Update queued">
          It applies automatically the next time each agent checks in (usually within ~30 seconds), and can take a few
          minutes to fully complete. Track live progress in the job detail table below; it is not done yet just because
          it was queued successfully.
        </Alert>
      )}
      {lastSkipped.length > 0 && (
        <Alert tone="warn">
          <span className="ep-num">{lastSkipped.length}</span> endpoint(s) were skipped because they already have an update in progress.
        </Alert>
      )}
      {lastNoBuild.length > 0 && (
        <Alert tone="warn">
          <span className="ep-num">{lastNoBuild.length}</span> endpoint(s) were skipped because no build is staged for their platform.
        </Alert>
      )}

      <Card flush title="Update Jobs" hint={jobs ? `${jobs.length} dispatched · select a job to see per-endpoint progress` : undefined}>
        {jobsLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : jobsError ? (
          <div className="ep-cb">
            <Alert tone="critical" title="Couldn't load update jobs" action={<Button size="sm" onClick={() => refetchJobs()}>Retry</Button>}>
              {(jobsError as Error).message}
            </Alert>
          </div>
        ) : !jobs || jobs.length === 0 ? (
          <EmptyState icon={History} title="No agent updates dispatched yet">
            Select endpoints or groups under "Roll out to endpoints" and push an update; each push appears here.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Platform</th>
                    <th scope="col">Target version</th>
                    <th scope="col">Hostname</th>
                    <th scope="col">IP address</th>
                    <th scope="col">User name</th>
                    <th scope="col">Groups</th>
                    <th scope="col">Status</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedJobs.pageItems.map((job) => (
                    <tr
                      key={job.id}
                      className={`app-clickable ${job.id === selectedJobId ? "ep-sel" : ""}`}
                      onClick={() => setSelectedJobId(job.id)}
                    >
                      <td>{PLATFORM_LABELS[job.platform] ?? job.platform}</td>
                      <td className="ep-mono">{job.targetVersion}</td>
                      <td>{job.targetHostnames.join(", ") || "—"}</td>
                      <td className="ep-mono">{job.targetIpAddresses.join(", ") || "—"}</td>
                      <td>{job.targetUsernames.join(", ") || "—"}</td>
                      <td>{job.targetGroupNames.join(", ") || "—"}</td>
                      <td>
                        <div className="app-badge-row">
                          {Object.entries(job.taskCounts).map(([status, count]) => (
                            <TaskStatus key={status} status={status} label={`${sentenceCase(status)}: ${count}`} />
                          ))}
                        </div>
                      </td>
                      <td className="app-muted">{formatDateTime(job.createdAt)}</td>
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
          title="Update Job Detail"
          hint={
            <>
              {PLATFORM_LABELS[jobDetail.platform] ?? jobDetail.platform} <span className="ep-mono">v{jobDetail.targetVersion}</span>
            </>
          }
        >
          {jobDetail.targetGroupNames.length > 0 && (
            <div className="ep-cb" style={{ paddingTop: 0 }}>
              <span className="app-muted">Targeted groups: </span>
              <span className="app-badge-row" style={{ display: "inline-flex" }}>
                {jobDetail.targetGroupNames.map((name) => (
                  <span key={name} className="ep-tag">
                    {name}
                  </span>
                ))}
              </span>
            </div>
          )}
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Endpoint</th>
                  <th scope="col">User</th>
                  <th scope="col">Status</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {jobDetail.tasks.map((task) => {
                  const stalled = isLikelyStalled(task.status, task.dispatchedAt);
                  return (
                    <tr key={task.id}>
                      <td className="ep-host">
                        <b>
                          <EndpointLabel hostname={task.hostname} agentId={task.agentId} hideUser />
                        </b>
                        <small>{task.ipAddress ?? "No IP reported"}</small>
                      </td>
                      <td>{task.lastLoggedOnUser ?? "—"}</td>
                      <td>
                        <TaskStatus status={task.status} />
                        {stalled && (
                          <span
                            className="app-cell-note"
                            style={{ color: "var(--ep-sev-medium)" }}
                            title="No progress reported in a while — the endpoint may be offline or the update may have failed silently on it."
                          >
                            Taking longer than usual
                          </span>
                        )}
                      </td>
                      <td>{task.message ?? <span className="app-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <DuplicateEntriesPanel />
    </>
  );
}
