import { useState, type FormEvent } from "react";
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
import Collapsible from "../components/Collapsible";
import EndpointLabel from "../components/EndpointLabel";

const PLATFORM_LABELS: Record<string, string> = { win32: "Windows", linux: "Linux" };

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

function BuildPanel({ platform, build }: { platform: string; build: AgentBuildInfo | null }) {
  return (
    <div className="panel">
      <h2>{PLATFORM_LABELS[platform] ?? platform} — latest build staged</h2>
      {!build && (
        <p>
          No {PLATFORM_LABELS[platform] ?? platform} agent build is currently staged. Run{" "}
          <code>npm run package -w @em/agent{platform === "linux" ? "-linux" : ""}</code> and redeploy this server to
          make a new version available here.
        </p>
      )}
      {build && (
        <div className="detail-grid">
          <div>
            <strong>Version</strong>
            <div>{build.version}</div>
          </div>
          <div>
            <strong>Package size</strong>
            <div>{(build.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB</div>
          </div>
          <div>
            <strong>Built</strong>
            <div>{new Date(build.builtAt).toLocaleString()}</div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <strong>What's new</strong>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{build.releaseNotes}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// Offline, older-version rows left behind by a re-enrollment from before
// enrollment.service.ts's hostname dedup existed - see findDuplicateAgents' own comment
// server-side for exactly what qualifies as a duplicate here. Purely a cleanup tool: it
// never touches whatever's actually running on the endpoint (if anything still is) - it
// only removes the stale management record, same caveat as any other agent deletion.
function DuplicateEntriesPanel() {
  const { data: duplicates, isLoading } = useDuplicateAgents();
  const deleteDuplicates = useDeleteDuplicateAgents();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const allSelected = !!duplicates && duplicates.length > 0 && selectedIds.length === duplicates.length;

  function toggleOne(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAll() {
    if (!duplicates) return;
    setSelectedIds(allSelected ? [] : duplicates.map((d) => d.id));
  }

  function handleDeleteSelected() {
    if (selectedIds.length === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedIds.length} duplicate agent record(s)?\n\n` +
        `These are offline, older-version rows for hostnames that already have a newer, currently-active ` +
        `record. This only removes the management record - it does not touch anything on any endpoint.` +
        `\n\nThis cannot be undone.`,
    );
    if (!confirmed) return;
    deleteDuplicates.mutate(selectedIds, { onSuccess: () => setSelectedIds([]) });
  }

  return (
    <Collapsible title={`Duplicate Entries${duplicates ? ` (${duplicates.length})` : ""}`} defaultOpen={false}>
      <p>
        Offline endpoints running an older agent version than a newer record that already exists for the same
        hostname — almost always a stale identity left over from a previous reinstall, safe to remove once
        confirmed the newer record is the one actually in use.
      </p>
      {isLoading && <p>Loading…</p>}
      {duplicates && duplicates.length === 0 && <p>No duplicate entries found.</p>}
      {duplicates && duplicates.length > 0 && (
        <>
          <button type="button" onClick={handleDeleteSelected} disabled={selectedIds.length === 0 || deleteDuplicates.isPending}>
            {deleteDuplicates.isPending ? "Deleting…" : `Delete selected (${selectedIds.length})`}
          </button>
          {deleteDuplicates.isError && <p className="error-text">{(deleteDuplicates.error as Error).message}</p>}
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
                <th>Hostname</th>
                <th>Serial No.</th>
                <th>User</th>
                <th>Status</th>
                <th>Agent version</th>
                <th>Last check-in</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {duplicates.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggleOne(d.id)} />
                  </td>
                  <td>
                    <EndpointLabel hostname={d.hostname} agentId={d.id} hideUser />
                  </td>
                  <td>{d.serialNumber ?? "—"}</td>
                  <td>{d.lastLoggedOnUser ?? "—"}</td>
                  <td>
                    <span className="status-badge danger">{d.status}</span>
                  </td>
                  <td>{d.agentVersion}</td>
                  <td>{d.lastCheckinAt ? new Date(d.lastCheckinAt).toLocaleString() : "never"}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(`Delete the duplicate record for ${d.hostname}?\n\nThis cannot be undone.`)) return;
                        deleteDuplicates.mutate([d.id]);
                      }}
                      disabled={deleteDuplicates.isPending}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Collapsible>
  );
}

export default function AgentUpdatesPage() {
  const { data: build } = useAgentLatestBuild();
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: jobs } = useAgentUpdateJobs();
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
          // A mixed Windows+Linux selection fans out into more than one job server-side
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

  const anyBuildAvailable = Boolean(build?.windows || build?.linux);

  function latestVersionFor(osPlatform: string): string | null {
    if (osPlatform === "linux") return build?.linux?.version ?? null;
    if (osPlatform === "win32") return build?.windows?.version ?? null;
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

  // Note: the Endpoint detail page's "update to vX.Y.Z available" now dispatches directly
  // from there (same useDispatchAgentUpdate mutation) rather than landing here first - so
  // there's no query-param handoff to pick up on mount. That update still shows up below in
  // "Update jobs" and, while in flight, in "Roll out to endpoints"' Status column - both are
  // sourced from the server (agent.latestUpdateTask / the jobs list), not from any selection
  // state local to this page, so they reflect it regardless of which page triggered it.

  return (
    <div>
      <h1>Agent Updates</h1>
      <p>
        Push a new agent build to any endpoint or group without re-running the installer by hand — the agent
        downloads the update, applies it, and restarts itself automatically. Windows and Linux endpoints can be
        selected together; each gets its own platform's build.
      </p>

      <DuplicateEntriesPanel />

      <BuildPanel platform="win32" build={build?.windows ?? null} />
      <BuildPanel platform="linux" build={build?.linux ?? null} />

      {anyBuildAvailable && (
        <form className="panel" onSubmit={handlePush}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Roll out to endpoints</h2>
            <button
              type="submit"
              disabled={dispatchUpdate.isPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
            >
              {dispatchUpdate.isPending ? "Pushing…" : "Push Update"}
            </button>
          </div>
          <fieldset>
            <legend>Target endpoints</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "0.5rem" }}>
              <label style={{ display: "inline-block" }}>
                Filter by host
                <input type="text" value={hostFilter} onChange={(e) => setHostFilter(e.target.value)} placeholder="Hostname…" />
              </label>
              <label style={{ display: "inline-block" }}>
                Filter by user
                <input type="text" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="Logged-on user…" />
              </label>
              <label style={{ display: "inline-block" }}>
                Platform
                <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="win32">Windows</option>
                  <option value="linux">Linux</option>
                </select>
              </label>
              <label style={{ display: "inline-block" }}>
                Current version
                <select value={versionFilter} onChange={(e) => setVersionFilter(e.target.value)}>
                  <option value="">All</option>
                  {distinctVersions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "inline-block" }}>
                Status
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as UpdateStatusCategory | "")}>
                  <option value="">All</option>
                  {UPDATE_STATUS_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {UPDATE_STATUS_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allSelectableSelected}
                      onChange={toggleSelectAll}
                      disabled={selectableAgents.length === 0}
                      title="Select all eligible endpoints in this list"
                    />
                  </th>
                  <th>Hostname</th>
                  <th>IP address</th>
                  <th>User name</th>
                  <th>Platform</th>
                  <th>Current version</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((agent) => {
                  const noBuildForPlatform = latestVersionFor(agent.osPlatform) === null;
                  // Live per-agent status, whether the in-flight/last update was dispatched
                  // from here or from the Endpoint detail page's own "update available"
                  // button - both create the same AgentUpdateTask row this is sourced from.
                  // Same helper the Status filter above buckets by, so the two can never disagree.
                  const { label: statusLabel } = getUpdateStatus(agent, latestVersionFor);
                  return (
                    <tr key={agent.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedAgentIds.includes(agent.id)}
                          disabled={noBuildForPlatform}
                          onChange={() => toggleAgent(agent.id)}
                        />
                      </td>
                      <td>
                        <EndpointLabel hostname={agent.hostname} agentId={agent.id} hideUser />
                      </td>
                      <td className="mono-cell">{agent.ipAddress ?? "—"}</td>
                      <td>{agent.inventory?.lastLoggedOnUser ?? "—"}</td>
                      <td>{PLATFORM_LABELS[agent.osPlatform] ?? agent.osPlatform}</td>
                      <td>{agent.agentVersion}</td>
                      <td>{statusLabel}</td>
                    </tr>
                  );
                })}
                {agents?.length === 0 && (
                  <tr>
                    <td colSpan={7}>No endpoints enrolled yet.</td>
                  </tr>
                )}
                {agents && agents.length > 0 && filteredAgents.length === 0 && (
                  <tr>
                    <td colSpan={7}>No endpoints match this filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </fieldset>
          {groups && groups.length > 0 && (
            <fieldset>
              <legend>Target groups</legend>
              {groups.map((g) => (
                <label key={g.id} className="checkbox-row">
                  <input type="checkbox" checked={selectedGroupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                  {g.name} ({g.memberCount})
                </label>
              ))}
            </fieldset>
          )}
          {dispatchUpdate.isError && <p className="error-text">{(dispatchUpdate.error as Error).message}</p>}
          <button
            type="submit"
            disabled={dispatchUpdate.isPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
          >
            {dispatchUpdate.isPending ? "Pushing…" : `Push update to selected endpoints`}
          </button>
        </form>
      )}

      {justQueued && (
        <p className="info-text">
          Update queued — it applies automatically the next time each agent checks in (usually within ~30 seconds),
          and can take a few minutes to fully complete. Track live progress in the job detail table below; it is
          not done yet just because it was queued successfully.
        </p>
      )}
      {lastSkipped.length > 0 && (
        <p className="error-text">
          {lastSkipped.length} endpoint(s) were skipped because they already have an update in progress.
        </p>
      )}
      {lastNoBuild.length > 0 && (
        <p className="error-text">
          {lastNoBuild.length} endpoint(s) were skipped because no build is staged for their platform.
        </p>
      )}

      <h2>Update jobs</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Platform</th>
            <th>Target version</th>
            <th>Hostname</th>
            <th>IP address</th>
            <th>User name</th>
            <th>Groups</th>
            <th>Created</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs?.map((job) => (
            <tr key={job.id} className="clickable-row" onClick={() => setSelectedJobId(job.id)}>
              <td>{PLATFORM_LABELS[job.platform] ?? job.platform}</td>
              <td>{job.targetVersion}</td>
              <td>{job.targetHostnames.join(", ") || "—"}</td>
              <td className="mono-cell">{job.targetIpAddresses.join(", ") || "—"}</td>
              <td>{job.targetUsernames.join(", ") || "—"}</td>
              <td>{job.targetGroupNames.join(", ") || "—"}</td>
              <td>{new Date(job.createdAt).toLocaleString()}</td>
              <td>
                {Object.entries(job.taskCounts)
                  .map(([status, count]) => `${status}: ${count}`)
                  .join(", ")}
              </td>
            </tr>
          ))}
          {jobs?.length === 0 && (
            <tr>
              <td colSpan={8}>No agent updates dispatched yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {jobDetail && (
        <div className="panel">
          <h2>
            Update job detail — {PLATFORM_LABELS[jobDetail.platform] ?? jobDetail.platform} v{jobDetail.targetVersion}
          </h2>
          {jobDetail.targetGroupNames.length > 0 && <p>Targeted groups: {jobDetail.targetGroupNames.join(", ")}</p>}
          <table className="data-table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>IP address</th>
                <th>User</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {jobDetail.tasks.map((task) => {
                const stalled = isLikelyStalled(task.status, task.dispatchedAt);
                return (
                  <tr key={task.id}>
                    <td>
                      <EndpointLabel hostname={task.hostname} agentId={task.agentId} hideUser />
                    </td>
                    <td className="mono-cell">{task.ipAddress ?? "—"}</td>
                    <td>{task.lastLoggedOnUser ?? "—"}</td>
                    <td>
                      {task.status}
                      {stalled && (
                        <span className="warn-text" title="No progress reported in a while — the endpoint may be offline or the update may have failed silently on it.">
                          {" "}
                          — taking longer than usual
                        </span>
                      )}
                    </td>
                    <td>{task.message ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
