import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bug, History, RefreshCw, SearchX, ShieldAlert, Trash2, X } from "lucide-react";
import {
  useRemediateBySeverity,
  useRemediateVulnerability,
  useTriggerVulnerabilityRescan,
  useTriggerVulnerabilitySync,
  useVulnerabilityDetail,
  useVulnerabilitySummary,
  useVulnerabilitySyncRuns,
} from "../api/hooks";
import type { VulnerabilityRemediationResult, VulnerabilitySyncRunView } from "../api/types";
import EndpointLabel from "../components/EndpointLabel";
import RemediationStatus from "../components/RemediationStatus";
import {
  Alert,
  Badge,
  BulkBar,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  IconButton,
  KeyValueList,
  Kpi,
  KpiStrip,
  PageHeader,
  Pagination,
  Pill,
  Skeleton,
  Status,
  Toolbar,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatDate, formatDateTime } from "../format";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNKNOWN: "Unknown",
};

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Severity → Meridian badge (critical/high/medium/low tones; anything else is neutral).
function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return <span className="app-muted">—</span>;
  return <Status value={severity} />;
}

function SyncRunStatus({ run }: { run: VulnerabilitySyncRunView }) {
  if (run.status === "SUCCESS") return <Badge tone="ok">Succeeded</Badge>;
  if (run.status === "FAILED") return <Pill tone="critical">Failed</Pill>;
  return <Pill tone="warn">Running</Pill>;
}

function remediationSummaryText(result: VulnerabilityRemediationResult): string {
  return (
    `Dispatched ${result.jobIds.length} job(s) across ${result.agentsTargeted} agent(s) for ${result.softwareGroups} software title(s)` +
    `${result.skippedLowConfidence > 0 ? ` — ${result.skippedLowConfidence} finding(s) skipped (low confidence, review individually)` : ""}` +
    `${result.skippedNeedsUpdate > 0 ? ` — ${result.skippedNeedsUpdate} Microsoft finding(s) skipped: install the Microsoft update named in the finding (Patches) instead of uninstalling` : ""}` +
    `${result.skippedSystem > 0 ? ` — ${result.skippedSystem} finding(s) on system software skipped (drivers, runtimes, Windows components are never uninstalled): update them instead` : ""}` +
    `. Check the Commands page for status; findings clear automatically once each agent's next inventory check-in confirms the software is gone (up to ~10 minutes).`
  );
}

function RemediationResultAlert({ result }: { result: VulnerabilityRemediationResult }) {
  return (
    <Alert tone={result.skippedLowConfidence > 0 || result.skippedNeedsUpdate > 0 || result.skippedSystem > 0 ? "warn" : "success"} title="Remediation dispatched">
      {remediationSummaryText(result)}
    </Alert>
  );
}

export default function VulnerabilitiesPage() {
  const { data: summary, isLoading: summaryLoading, error: summaryError, refetch: refetchSummary } = useVulnerabilitySummary();
  const { data: syncRuns, isLoading: syncRunsLoading } = useVulnerabilitySyncRuns();
  const triggerSync = useTriggerVulnerabilitySync();
  const triggerRescan = useTriggerVulnerabilityRescan();
  const remediateVuln = useRemediateVulnerability();
  const remediateSeverity = useRemediateBySeverity();
  const confirm = useConfirm();

  const [mode, setMode] = useState<"PUBLISHED" | "LAST_MODIFIED">("PUBLISHED");
  const [selectedDefId, setSelectedDefId] = useState<string | undefined>();
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>([]);
  const [severityResult, setSeverityResult] = useState<VulnerabilityRemediationResult | null>(null);
  const [cveResult, setCveResult] = useState<VulnerabilityRemediationResult | null>(null);
  const [findingsSeverityFilter, setFindingsSeverityFilter] = useState("ALL");
  const [showAllSyncRuns, setShowAllSyncRuns] = useState(false);

  // Runs arrive newest first (the server caps the list at the latest 50).
  // By default the latest NVD run and the latest Microsoft run.
  const visibleSyncRuns = showAllSyncRuns
    ? syncRuns
    : [syncRuns?.find((run) => run.mode !== "MSRC"), syncRuns?.find((run) => run.mode === "MSRC")].filter(
        (run): run is VulnerabilitySyncRunView => run !== undefined,
      );

  const filteredSummary = summary?.filter(
    (item) => findingsSeverityFilter === "ALL" || (item.cvssSeverity ?? "UNKNOWN").toUpperCase() === findingsSeverityFilter,
  );
  const pagedSummary = usePagedList(filteredSummary ?? [], 25);

  // Severity KPI strip: CVEs per severity (same matching as the severity filter below) and
  // the endpoint matches behind them.
  const severityStats = SEVERITIES.map((s) => {
    const items = summary?.filter((item) => (item.cvssSeverity ?? "UNKNOWN").toUpperCase() === s) ?? [];
    return { severity: s, cves: items.length, matches: items.reduce((sum, item) => sum + item.affectedAgentCount, 0) };
  });

  const { data: detail } = useVulnerabilityDetail(selectedDefId);
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const pagedFindings = usePagedList(detail?.findings ?? [], 25);

  // Fresh selection per CVE, and bring its endpoint list into view once it has loaded.
  const loadedDetailId = detail?.vulnerabilityDefinitionId;
  useEffect(() => {
    setSelectedFindingIds([]);
    if (loadedDetailId) detailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loadedDetailId]);

  // "Select all" ticks every row, name-only matches included — the confirm dialog in
  // handleRemediateVulnerability spells out how many of the selection are name-only.
  const allFindingIds = detail?.findings.map((f) => f.id) ?? [];
  const allSelected = allFindingIds.length > 0 && allFindingIds.every((id) => selectedFindingIds.includes(id));
  const selectedAgentCount = detail
    ? new Set(detail.findings.filter((f) => selectedFindingIds.includes(f.id)).map((f) => f.agentId)).size
    : 0;

  function toggleFinding(id: string) {
    setSelectedFindingIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAll() {
    setSelectedFindingIds(allSelected ? [] : allFindingIds);
  }

  function handleSync(e: FormEvent) {
    e.preventDefault();
    triggerSync.mutate({ mode });
  }

  function toggleSeverity(s: string) {
    setSelectedSeverities((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function openCve(vulnerabilityDefinitionId: string) {
    // Same CVE again: the effect above won't re-fire, so scroll directly.
    if (vulnerabilityDefinitionId === loadedDetailId) {
      detailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setSelectedDefId(vulnerabilityDefinitionId);
    setCveResult(null);
  }

  async function handleRemediateSeverities() {
    if (selectedSeverities.length === 0) return;
    const confirmed = await confirm({
      title: `Uninstall the vulnerable software for every OPEN ${selectedSeverities.join("/")} finding across the fleet?`,
      body:
        "This dispatches a real uninstall command to every affected endpoint. Lower-confidence (name-only) matches " +
        "are skipped automatically.",
      confirmLabel: "Uninstall software",
      tone: "danger",
    });
    if (!confirmed) return;
    setSeverityResult(null);
    remediateSeverity.mutate(selectedSeverities, { onSuccess: (result) => setSeverityResult(result) });
  }

  async function handleRemediateVulnerability() {
    if (!detail || selectedFindingIds.length === 0) return;
    const selected = detail.findings.filter((f) => selectedFindingIds.includes(f.id));
    const agentCount = new Set(selected.map((f) => f.agentId)).size;
    const nameOnlyCount = selected.filter((f) => f.matchConfidence !== "PRODUCT_AND_VERSION").length;
    const confirmed = await confirm({
      title: `Uninstall the software matched to ${detail.cveId} on ${agentCount} selected endpoint(s)?`,
      body:
        "This dispatches a real uninstall command to each selected endpoint." +
        (nameOnlyCount > 0
          ? `\n\n${nameOnlyCount} of the selected match(es) are name-only (version not confirmed) — they will be uninstalled too, because you ticked them.`
          : ""),
      confirmLabel: "Uninstall software",
      tone: "danger",
    });
    if (!confirmed) return;
    setCveResult(null);
    remediateVuln.mutate(
      { vulnerabilityDefinitionId: detail.vulnerabilityDefinitionId, findingIds: selectedFindingIds },
      {
        onSuccess: (result) => {
          setCveResult(result);
          setSelectedFindingIds([]);
        },
      },
    );
  }

  const rescanButton = (size?: "sm") => (
    <Button size={size} icon={RefreshCw} onClick={() => triggerRescan.mutate()} disabled={triggerRescan.isPending}>
      {triggerRescan.isPending ? "Rescanning…" : "Rescan fleet"}
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Vulnerabilities"
        description="Possible CVE matches across the fleet, and uninstall-based remediation"
        actions={rescanButton()}
      />

      <Alert tone="warn" title="Heuristic matches">
        Heuristic matches based on installed-software name/version text, not CPE-tagged inventory — expect false
        positives and false negatives. Confirm manually before acting.
      </Alert>

      <KpiStrip>
        {severityStats.map((s) => (
          <Kpi
            key={s.severity}
            label={SEVERITY_LABELS[s.severity]}
            value={summary ? <span className="ep-num">{s.cves}</span> : "—"}
            suffix={s.cves === 1 ? "CVE" : "CVEs"}
            valueTone={s.severity === "CRITICAL" && s.cves > 0 ? "critical" : undefined}
            footer={summary ? `${s.matches} endpoint ${s.matches === 1 ? "match" : "matches"}` : undefined}
            active={findingsSeverityFilter === s.severity}
            onClick={() => setFindingsSeverityFilter(findingsSeverityFilter === s.severity ? "ALL" : s.severity)}
          />
        ))}
      </KpiStrip>

      <Card
        title="Remediate by severity"
        hint="uninstalls the matched software"
        actions={
          <Button
            variant="danger"
            icon={Trash2}
            onClick={handleRemediateSeverities}
            disabled={remediateSeverity.isPending || selectedSeverities.length === 0}
          >
            {remediateSeverity.isPending ? "Dispatching…" : "Remediate selected severities"}
          </Button>
        }
      >
        <div className="app-stack">
          <p className="app-text">
            Uninstalls the vulnerable software (via the existing Commands dispatch) on every endpoint with an OPEN finding
            at the selected severity.
          </p>
          <div className="app-actions-row" style={{ gap: 16 }}>
            {SEVERITIES.map((s) => (
              <Check
                key={s}
                checked={selectedSeverities.includes(s)}
                onChange={() => toggleSeverity(s)}
                label={<Status value={s} />}
              />
            ))}
          </div>
          {remediateSeverity.isError && <Alert tone="critical">{(remediateSeverity.error as Error).message}</Alert>}
          {severityResult && <RemediationResultAlert result={severityResult} />}
        </div>
      </Card>

      <Card flush title="Fleet findings" hint="possible matches">
        <Toolbar>
          <select
            className="ep-select"
            aria-label="Severity"
            value={findingsSeverityFilter}
            onChange={(e) => setFindingsSeverityFilter(e.target.value)}
          >
            <option value="ALL">Severity: All</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
            <option value="UNKNOWN">Unknown</option>
          </select>
        </Toolbar>

        {summaryLoading ? (
          <div className="ep-cb">
            <Skeleton lines={6} />
          </div>
        ) : summaryError ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load vulnerability findings"
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
          <EmptyState icon={Bug} title="No possible matches found yet" action={rescanButton("sm")}>
            Sync the CVE catalog below, then rescan the fleet.
          </EmptyState>
        ) : filteredSummary?.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No findings match this severity filter"
            action={
              <Button size="sm" onClick={() => setFindingsSeverityFilter("ALL")}>
                Clear filter
              </Button>
            }
          >
            Try a different severity.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">CVE</th>
                    <th scope="col">Description</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      CVSS
                    </th>
                    <th scope="col">Severity</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Affected endpoints
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSummary.pageItems.map((item) => (
                    <tr
                      key={item.vulnerabilityDefinitionId}
                      className={`app-clickable ${item.vulnerabilityDefinitionId === selectedDefId ? "ep-sel" : ""}`}
                      onClick={() => openCve(item.vulnerabilityDefinitionId)}
                    >
                      <td className="ep-mono" style={{ whiteSpace: "nowrap" }}>
                        <a
                          className="ep-link"
                          href={`https://nvd.nist.gov/vuln/detail/${item.cveId}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {item.cveId}
                        </a>
                      </td>
                      <td title={item.description}>
                        {item.confirmedAgentCount === 0 && (
                          <>
                            <Badge tone="neu">Name only</Badge>{" "}
                          </>
                        )}
                        {truncate(item.description, 100)}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {item.cvssBaseScore ?? <span className="app-muted">—</span>}
                      </td>
                      <td>
                        <SeverityBadge severity={item.cvssSeverity} />
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {item.affectedAgentCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pagedSummary.page}
              pageSize={pagedSummary.pageSize}
              total={pagedSummary.total}
              noun="CVEs"
              onPageChange={pagedSummary.setPage}
              onPageSizeChange={pagedSummary.setPageSize}
            />
          </>
        )}
      </Card>

      {selectedDefId && !detail && (
        <Card title="Loading CVE…">
          <Skeleton />
        </Card>
      )}

      {detail && (
        <div ref={detailPanelRef} className="app-policy-detail" role="region" aria-label={`CVE ${detail.cveId}`}>
        <Card
          flush
          title={
            <>
              <a className="ep-link ep-mono" href={`https://nvd.nist.gov/vuln/detail/${detail.cveId}`} target="_blank" rel="noreferrer">
                {detail.cveId}
              </a>{" "}
              <SeverityBadge severity={detail.cvssSeverity} />
            </>
          }
          hint={<>CVSS <span className="ep-num">{detail.cvssBaseScore ?? "—"}</span></>}
          actions={<IconButton icon={X} label="Close CVE" onClick={() => setSelectedDefId(undefined)} />}
        >
          <div className="ep-cb">
            <div className="app-stack">
              <KeyValueList
                items={[
                  { label: "CVE", value: detail.cveId, mono: true },
                  { label: "Severity", value: <SeverityBadge severity={detail.cvssSeverity} /> },
                  { label: "CVSS base score", value: <span className="ep-num">{detail.cvssBaseScore ?? "—"}</span> },
                  {
                    label: "Matched endpoints",
                    value: (
                      <span className="ep-num">
                        {new Set(detail.findings.map((f) => f.agentId)).size} endpoints · {detail.findings.length} findings
                      </span>
                    ),
                  },
                  { label: "Description", value: detail.description },
                ]}
              />
              <p className="app-text">
                Tick the endpoints to remediate, or use the header checkbox to select all. Name-only matches (version not
                confirmed) are uninstalled too if selected — check them before remediating.
              </p>
              {remediateVuln.isError && <Alert tone="critical">{(remediateVuln.error as Error).message}</Alert>}
              {cveResult && <RemediationResultAlert result={cveResult} />}
            </div>
          </div>

          <BulkBar count={selectedFindingIds.length} onClear={() => setSelectedFindingIds([])}>
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              onClick={handleRemediateVulnerability}
              disabled={remediateVuln.isPending || selectedFindingIds.length === 0}
            >
              {remediateVuln.isPending ? "Dispatching…" : `Remediate — uninstall on ${selectedAgentCount} selected endpoint(s)`}
            </Button>
          </BulkBar>

          {detail.findings.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="No endpoints match this CVE anymore">
              Findings clear once an endpoint's inventory no longer contains the matched software. Pick another CVE above.
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
                          aria-label="Select all endpoints"
                          title="Select all endpoints"
                          checked={allSelected}
                          disabled={allFindingIds.length === 0}
                          onChange={toggleAll}
                        />
                      </th>
                      <th scope="col">Endpoint</th>
                      <th scope="col">Matched software</th>
                      <th scope="col">Version</th>
                      <th scope="col">Confidence</th>
                      <th scope="col">CPE criteria</th>
                      <th scope="col">Remediation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedFindings.pageItems.map((f) => (
                      <tr
                        key={f.id}
                        className={`app-clickable ${selectedFindingIds.includes(f.id) ? "ep-sel" : ""}`}
                        onClick={() => toggleFinding(f.id)}
                      >
                        <td className="ep-cb">
                          <input
                            type="checkbox"
                            aria-label={`Select ${f.hostname}`}
                            checked={selectedFindingIds.includes(f.id)}
                            onChange={() => toggleFinding(f.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td>
                          <EndpointLabel hostname={f.hostname} agentId={f.agentId} />
                        </td>
                        <td>{f.matchedSoftwareName}</td>
                        <td className="ep-mono">{f.matchedSoftwareVersion ?? <span className="app-muted">—</span>}</td>
                        <td>
                          {f.matchConfidence === "PRODUCT_AND_VERSION" ? (
                            <Badge tone="ok">Name + version</Badge>
                          ) : (
                            <Badge tone="med">Name only</Badge>
                          )}
                        </td>
                        <td className={f.matchedCpeCriteria.startsWith("msrc:") ? undefined : "ep-mono"}>
                          {f.matchedCpeCriteria.startsWith("msrc:") ? `Microsoft: ${f.matchedCpeCriteria.slice(5)}` : f.matchedCpeCriteria}
                        </td>
                        <td>
                          <RemediationStatus remediation={f.remediation} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={pagedFindings.page}
                pageSize={pagedFindings.pageSize}
                total={pagedFindings.total}
                noun="findings"
                onPageChange={pagedFindings.setPage}
                onPageSizeChange={pagedFindings.setPageSize}
              />
            </>
          )}
        </Card>
        </div>
      )}

      <Card title="CVE catalog" hint="synced from NVD and Microsoft's Security Update Guide">
        <div className="app-stack">
          <form onSubmit={handleSync} className="app-actions-row" style={{ alignItems: "flex-end" }}>
            <div style={{ minWidth: 280 }}>
              <Field label="Sync mode" htmlFor="vuln-sync-mode">
                <select
                  id="vuln-sync-mode"
                  className="ep-select"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "PUBLISHED" | "LAST_MODIFIED")}
                >
                  <option value="PUBLISHED">Published (default: last 3 years)</option>
                  <option value="LAST_MODIFIED">Last modified (for incremental resync)</option>
                </select>
              </Field>
            </div>
            <Button type="submit" variant="primary" icon={RefreshCw} disabled={triggerSync.isPending}>
              {triggerSync.isPending ? "Starting…" : "Sync now"}
            </Button>
          </form>
          {triggerSync.isError && <Alert tone="critical">{(triggerSync.error as Error).message}</Alert>}

          <div className="app-stack-sm">
            <span className="app-subhead">Sync history</span>
            {syncRunsLoading ? (
              <Skeleton lines={2} />
            ) : !syncRuns || syncRuns.length === 0 ? (
              <EmptyState icon={History} title="No syncs run yet">
                Choose a mode and select Sync now to pull the CVE catalog from NVD and Microsoft's fixed builds.
              </EmptyState>
            ) : (
              <div className="app-table-wrap">
                <table className="ep-tbl">
                  <thead>
                    <tr>
                      <th scope="col">Mode</th>
                      <th scope="col">Window</th>
                      <th scope="col">Started</th>
                      <th scope="col">Status</th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        CVEs / fixes
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSyncRuns?.map((run) => (
                      <tr key={run.id}>
                        <td>{run.mode === "MSRC" ? "Microsoft updates" : run.mode === "PUBLISHED" ? "Published" : "Last modified"}</td>
                        <td>
                          {formatDate(run.windowStartAt)} – {formatDate(run.windowEndAt)}
                        </td>
                        <td>{formatDateTime(run.startedAt)}</td>
                        <td>
                          <SyncRunStatus run={run} />
                          {run.errorMessage && <span className="app-muted app-cell-note">{run.errorMessage}</span>}
                        </td>
                        <td className="ep-num" style={{ textAlign: "right" }}>
                          {run.cveUpsertedCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {syncRuns && syncRuns.length > 1 && (
              <div>
                <Button size="sm" variant="ghost" onClick={() => setShowAllSyncRuns((v) => !v)}>
                  {showAllSyncRuns ? "Show latest only" : `Show all records (${syncRuns.length})`}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
