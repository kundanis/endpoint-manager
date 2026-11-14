import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Bug, History, RefreshCw, SearchX, ShieldAlert, Trash2, X } from "lucide-react";
import {
  useAgents,
  useAssetGroups,
  useCreateVulnerabilityException,
  useDeleteVulnerabilityException,
  useRemediateBySeverity,
  useRemediateVulnerability,
  useTriggerVulnerabilityRescan,
  useTriggerVulnerabilitySync,
  useVulnerabilityDetail,
  useVulnerabilitySummary,
  useVulnerabilityExceptions,
  useVulnerabilitySyncRuns,
} from "../api/hooks";
import type {
  VulnerabilityExceptionReason,
  VulnerabilityExceptionView,
  VulnerabilityRemediationResult,
  VulnerabilitySyncRunView,
} from "../api/types";
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
  Modal,
  FormGrid,
  PageHeader,
  Pagination,
  Pill,
  Skeleton,
  Status,
  Toolbar,
  useConfirm,
  usePagedList,
  useToast,
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

const EXCEPTION_REASON_LABELS: Record<VulnerabilityExceptionReason, string> = {
  FALSE_POSITIVE: "False positive",
  NOT_APPLICABLE: "Not applicable",
  RISK_ACCEPTED: "Risk accepted",
};

// "Mark as…" on a CVE in the findings list: the vulnerability itself is a false positive, not
// applicable here, or a risk accepted - for all the software matched to it, on every endpoint, a
// group, or the endpoint the page is filtered to. Covered findings leave the counts and are never
// remediated; every rescan keeps them marked.
function MarkExceptionDialog({
  cveId,
  vulnerabilityDefinitionId,
  affectedAgentCount,
  filterAgent,
  filterGroupId,
  onClose,
}: {
  cveId: string;
  vulnerabilityDefinitionId: string;
  affectedAgentCount: number;
  filterAgent?: { id: string; hostname: string };
  filterGroupId?: string;
  onClose: (message?: string) => void;
}) {
  const create = useCreateVulnerabilityException();
  const { data: groups } = useAssetGroups();
  const [reason, setReason] = useState<VulnerabilityExceptionReason>("FALSE_POSITIVE");
  const [scope, setScope] = useState<"AGENT" | "GROUP" | "ALL">(filterAgent ? "AGENT" : filterGroupId ? "GROUP" : "ALL");
  const [groupId, setGroupId] = useState(filterGroupId ?? "");
  const [note, setNote] = useState("");
  const [reviewDate, setReviewDate] = useState("");

  const where =
    scope === "AGENT" ? filterAgent?.hostname ?? "this endpoint" : scope === "GROUP" ? `group ${groups?.find((g) => g.id === groupId)?.name ?? ""}`.trim() : "every endpoint";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        vulnerabilityDefinitionId,
        // "*": every piece of software matched to this CVE.
        softwareName: "*",
        softwareVersion: null,
        scope,
        ...(scope === "AGENT" && filterAgent ? { agentId: filterAgent.id } : {}),
        ...(scope === "GROUP" ? { groupId } : {}),
        reason,
        note: note.trim(),
        expiresAt: reason === "RISK_ACCEPTED" && reviewDate ? new Date(`${reviewDate}T23:59:59`).toISOString() : null,
      },
      { onSuccess: () => onClose(`${cveId} marked ${EXCEPTION_REASON_LABELS[reason].toLowerCase()} on ${where}.`) },
    );
  }

  return (
    <Modal
      title={`Mark ${cveId} as…`}
      description={`Currently matched on ${affectedAgentCount} endpoint${affectedAgentCount === 1 ? "" : "s"}${filterAgent || filterGroupId ? " in this filter" : ""}. Marked findings leave the counts, are never uninstalled by Remediate, and stay marked after every sync and rescan. Remove the exception under Exceptions to undo it.`}
      onClose={() => onClose()}
      footer={
        <>
          <Button onClick={() => onClose()}>Cancel</Button>
          <Button type="submit" form="vuln-exception-form" variant="primary" disabled={create.isPending || note.trim().length < 3 || (scope === "GROUP" && !groupId)}>
            {create.isPending ? "Saving…" : "Mark"}
          </Button>
        </>
      }
    >
      <form id="vuln-exception-form" onSubmit={handleSubmit} className="app-stack">
        <FormGrid>
          <Field label="Mark as" htmlFor="vex-reason" required>
            <select id="vex-reason" className="ep-select" value={reason} onChange={(e) => setReason(e.target.value as VulnerabilityExceptionReason)}>
              <option value="FALSE_POSITIVE">False positive — not actually affected</option>
              <option value="NOT_APPLICABLE">Not applicable — the issue can't occur here</option>
              <option value="RISK_ACCEPTED">Risk accepted — affected, but we accept it</option>
            </select>
          </Field>
          <Field label="Applies to" htmlFor="vex-scope" required>
            <select id="vex-scope" className="ep-select" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="ALL">Every endpoint</option>
              <option value="GROUP">A group</option>
              {filterAgent && <option value="AGENT">This endpoint ({filterAgent.hostname})</option>}
            </select>
          </Field>
          {scope === "GROUP" && (
            <Field label="Group" htmlFor="vex-group" required span2>
              <select id="vex-group" className="ep-select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Choose a group</option>
                {(groups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Why" htmlFor="vex-note" required span2 help="Others see this when they review the exception.">
            <textarea id="vex-note" className="ep-textarea" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} required />
          </Field>
          {reason === "RISK_ACCEPTED" && (
            <Field label="Review by (optional)" htmlFor="vex-review" help="After this date the findings come back as open.">
              <input id="vex-review" className="ep-input" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
            </Field>
          )}
        </FormGrid>
        {create.isError && <Alert tone="critical">{(create.error as Error).message}</Alert>}
      </form>
    </Modal>
  );
}

// Every exception, with who set it and why; Remove puts its findings back to open.
function ExceptionsCard({ onOpenCve }: { onOpenCve: (vulnerabilityDefinitionId: string) => void }) {
  const { data, isLoading } = useVulnerabilityExceptions();
  const remove = useDeleteVulnerabilityException();
  const confirm = useConfirm();
  const paged = usePagedList(data ?? [], 10);

  async function handleRemove(x: VulnerabilityExceptionView) {
    const ok = await confirm({
      title: `Remove the exception for ${x.cveId}?`,
      body: "The findings it covered come back as open and can be remediated again.",
      confirmLabel: "Remove exception",
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(x.id);
  }

  return (
    <Card flush title="Exceptions" hint={data ? `${data.length} marked false positive, not applicable or risk accepted` : undefined}>
      {isLoading ? (
        <div className="ep-cb">
          <Skeleton />
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No exceptions">
          Use Mark as… on a CVE in the findings list to mark it a false positive, not applicable or a risk accepted.
        </EmptyState>
      ) : (
        <>
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">CVE</th>
                  <th scope="col">Software</th>
                  <th scope="col">Applies to</th>
                  <th scope="col">Marked as</th>
                  <th scope="col">Why</th>
                  <th scope="col">By</th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((x) => (
                  <tr key={x.id}>
                    <td className="ep-mono" style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="ep-link" onClick={() => onOpenCve(x.vulnerabilityDefinitionId)}>
                        {x.cveId}
                      </button>{" "}
                      <SeverityBadge severity={x.cvssSeverity} />
                    </td>
                    <td>
                      {x.softwareName === "*" ? <span className="app-muted">All matched software</span> : x.softwareName}
                      {x.softwareVersion && <span className="app-row-sub">version {x.softwareVersion} only</span>}
                    </td>
                    <td>{x.scope === "AGENT" ? (x.hostname ?? "Endpoint") : x.scope === "GROUP" ? `Group ${x.groupName ?? ""}` : "Every endpoint"}</td>
                    <td>
                      <Badge tone="neu">{EXCEPTION_REASON_LABELS[x.reason]}</Badge>
                      {x.expiresAt && (
                        <span className="app-row-sub">
                          {x.expired ? <Badge tone="med">Review date passed</Badge> : `review by ${formatDate(x.expiresAt)}`}
                        </span>
                      )}
                    </td>
                    <td style={{ overflowWrap: "anywhere" }}>{x.note}</td>
                    <td className="app-muted">
                      {x.createdBy ?? "—"}
                      <span className="app-row-sub">{formatDateTime(x.createdAt)}</span>
                    </td>
                    <td>
                      <IconButton icon={Trash2} label={`Remove exception for ${x.cveId}`} onClick={() => handleRemove(x)} disabled={remove.isPending} />
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
            noun="exceptions"
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
        </>
      )}
      {remove.isError && (
        <div className="ep-cb">
          <Alert tone="critical">{(remove.error as Error).message}</Alert>
        </div>
      )}
    </Card>
  );
}

export default function VulnerabilitiesPage() {
  // Endpoint / Group filter, kept in the address (?agent= / ?group=) so Security posture on an
  // endpoint can link straight here. Neither set = the whole fleet, as before.
  const [searchParams, setSearchParams] = useSearchParams();
  const agentFilter = searchParams.get("agent") ?? "";
  const groupFilter = agentFilter ? "" : (searchParams.get("group") ?? "");
  const scope = agentFilter ? { agentId: agentFilter } : groupFilter ? { groupId: groupFilter } : undefined;
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const scopeLabel = agentFilter
    ? (agents?.find((a) => a.id === agentFilter)?.hostname ?? "this endpoint")
    : groupFilter
      ? `group ${groups?.find((g) => g.id === groupFilter)?.name ?? ""}`.trim()
      : null;

  function setScope(next: { agent?: string; group?: string }) {
    const params = new URLSearchParams(searchParams);
    params.delete("agent");
    params.delete("group");
    if (next.agent) params.set("agent", next.agent);
    else if (next.group) params.set("group", next.group);
    setSearchParams(params, { replace: true });
    setSelectedDefId(undefined);
    setSeverityResult(null);
    setCveResult(null);
  }

  const { data: summary, isLoading: summaryLoading, error: summaryError, refetch: refetchSummary } = useVulnerabilitySummary(scope);
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

  const { data: detail } = useVulnerabilityDetail(selectedDefId, scope);
  const toast = useToast();
  const [markingCve, setMarkingCve] = useState<{ id: string; cveId: string; affected: number } | null>(null);
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
  const allFindingIds = detail?.findings.filter((f) => f.status !== "EXCEPTED").map((f) => f.id) ?? [];
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
      title: `Uninstall the vulnerable software for every OPEN ${selectedSeverities.join("/")} finding ${scopeLabel ? `on ${scopeLabel}` : "across the fleet"}?`,
      body:
        "This dispatches a real uninstall command to every affected endpoint. Lower-confidence (name-only) matches " +
        "are skipped automatically.",
      confirmLabel: "Uninstall software",
      tone: "danger",
    });
    if (!confirmed) return;
    setSeverityResult(null);
    remediateSeverity.mutate({ severities: selectedSeverities, scope }, { onSuccess: (result) => setSeverityResult(result) });
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
        description={scopeLabel ? `Possible CVE matches on ${scopeLabel}, and uninstall-based remediation` : "Possible CVE matches across the fleet, and uninstall-based remediation"}
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
            at the selected severity{scopeLabel ? <> — only on {scopeLabel}, as filtered below</> : null}.
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

      <Card flush title={scopeLabel ? "Findings" : "Fleet findings"} hint={scopeLabel ? `possible matches on ${scopeLabel}` : "possible matches"}>
        <Toolbar
          right={
            scope && (
              <Button size="sm" onClick={() => setScope({})}>
                Show all endpoints
              </Button>
            )
          }
        >
          <select
            className="ep-select"
            aria-label="Endpoint"
            value={agentFilter}
            onChange={(e) => setScope({ agent: e.target.value })}
          >
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
            value={groupFilter}
            onChange={(e) => setScope({ group: e.target.value })}
          >
            <option value="">Group: All</option>
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
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
          scopeLabel ? (
            <EmptyState
              icon={SearchX}
              title={`No possible matches on ${scopeLabel}`}
              action={
                <Button size="sm" onClick={() => setScope({})}>
                  Show all endpoints
                </Button>
              }
            />
          ) : (
            <EmptyState icon={Bug} title="No possible matches found yet" action={rescanButton("sm")}>
              Sync the CVE catalog below, then rescan the fleet.
            </EmptyState>
          )
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
                    <th scope="col">
                      <span className="app-vh">Actions</span>
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
                      <td>
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMarkingCve({ id: item.vulnerabilityDefinitionId, cveId: item.cveId, affected: item.affectedAgentCount });
                          }}
                          title="False positive, not applicable or risk accepted"
                        >
                          Mark as…
                        </Button>
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
                        {new Set(detail.findings.filter((f) => f.status !== "EXCEPTED").map((f) => f.agentId)).size} endpoints ·{" "}
                        {detail.findings.filter((f) => f.status !== "EXCEPTED").length} findings
                        {detail.findings.some((f) => f.status === "EXCEPTED") &&
                          ` · ${detail.findings.filter((f) => f.status === "EXCEPTED").length} marked as exceptions`}
                      </span>
                    ),
                  },
                  { label: "Description", value: detail.description },
                ]}
              />
              <p className="app-text">
                Tick the endpoints to remediate, or use the header checkbox to select all. Name-only matches (version not
                confirmed) are uninstalled too if selected — check them before remediating. To mark this CVE a false
                positive, not applicable or a risk accepted, use Mark as… on its row in the findings list.
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
                        className={f.status === "EXCEPTED" ? undefined : `app-clickable ${selectedFindingIds.includes(f.id) ? "ep-sel" : ""}`}
                        onClick={f.status === "EXCEPTED" ? undefined : () => toggleFinding(f.id)}
                      >
                        <td className="ep-cb">
                          {f.status !== "EXCEPTED" && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${f.hostname}`}
                              checked={selectedFindingIds.includes(f.id)}
                              onChange={() => toggleFinding(f.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
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
                          {f.status === "EXCEPTED" ? <Badge tone="neu">Exception — not remediated</Badge> : <RemediationStatus remediation={f.remediation} />}
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

      {markingCve && (
        <MarkExceptionDialog
          cveId={markingCve.cveId}
          vulnerabilityDefinitionId={markingCve.id}
          affectedAgentCount={markingCve.affected}
          filterAgent={agentFilter ? { id: agentFilter, hostname: scopeLabel ?? "this endpoint" } : undefined}
          filterGroupId={groupFilter || undefined}
          onClose={(message) => {
            setMarkingCve(null);
            if (message) {
              toast(message);
              setSelectedFindingIds([]);
            }
          }}
        />
      )}

      <ExceptionsCard onOpenCve={openCve} />

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
