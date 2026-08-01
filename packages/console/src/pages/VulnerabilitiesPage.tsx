import { useState, type FormEvent } from "react";
import {
  useRemediateBySeverity,
  useRemediateVulnerability,
  useTriggerVulnerabilityRescan,
  useTriggerVulnerabilitySync,
  useVulnerabilityDetail,
  useVulnerabilitySummary,
  useVulnerabilitySyncRuns,
} from "../api/hooks";
import type { VulnerabilityRemediationResult } from "../api/types";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function severityBadgeClass(severity: string | null): string {
  const s = (severity ?? "").toUpperCase();
  if (s === "CRITICAL" || s === "HIGH") return "danger";
  if (s === "MEDIUM" || s === "MODERATE") return "warn";
  if (s === "LOW") return "online";
  return "offline";
}

function remediationSummaryText(result: VulnerabilityRemediationResult): string {
  return (
    `Dispatched ${result.jobIds.length} job(s) across ${result.agentsTargeted} agent(s) for ${result.softwareGroups} software title(s)` +
    `${result.skippedLowConfidence > 0 ? ` — ${result.skippedLowConfidence} finding(s) skipped (low confidence, review individually)` : ""}` +
    `. Check the Commands page for status; findings clear automatically once each agent's next inventory check-in confirms the software is gone (up to ~10 minutes).`
  );
}

export default function VulnerabilitiesPage() {
  const { data: summary } = useVulnerabilitySummary();
  const { data: syncRuns } = useVulnerabilitySyncRuns();
  const triggerSync = useTriggerVulnerabilitySync();
  const triggerRescan = useTriggerVulnerabilityRescan();
  const remediateVuln = useRemediateVulnerability();
  const remediateSeverity = useRemediateBySeverity();

  const [mode, setMode] = useState<"PUBLISHED" | "LAST_MODIFIED">("PUBLISHED");
  const [selectedDefId, setSelectedDefId] = useState<string | undefined>();
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>([]);
  const [severityResult, setSeverityResult] = useState<VulnerabilityRemediationResult | null>(null);
  const [cveResult, setCveResult] = useState<VulnerabilityRemediationResult | null>(null);
  const [findingsSeverityFilter, setFindingsSeverityFilter] = useState("ALL");

  const filteredSummary = summary?.filter(
    (item) => findingsSeverityFilter === "ALL" || (item.cvssSeverity ?? "UNKNOWN").toUpperCase() === findingsSeverityFilter,
  );

  const { data: detail } = useVulnerabilityDetail(selectedDefId);

  function handleSync(e: FormEvent) {
    e.preventDefault();
    triggerSync.mutate({ mode });
  }

  function toggleSeverity(s: string) {
    setSelectedSeverities((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function handleRemediateSeverities() {
    if (selectedSeverities.length === 0) return;
    const confirmed = window.confirm(
      `Uninstall the vulnerable software for every OPEN ${selectedSeverities.join("/")} finding across the fleet?\n\n` +
        `This dispatches a real uninstall command to every affected endpoint. Lower-confidence (name-only) matches are skipped automatically.`,
    );
    if (!confirmed) return;
    setSeverityResult(null);
    remediateSeverity.mutate(selectedSeverities, { onSuccess: (result) => setSeverityResult(result) });
  }

  function handleRemediateVulnerability() {
    if (!detail) return;
    const agentCount = new Set(detail.findings.map((f) => f.agentId)).size;
    const confirmed = window.confirm(
      `Uninstall the software matched to ${detail.cveId} on ${agentCount} endpoint(s)?\n\n` +
        `This dispatches a real uninstall command to every affected endpoint. Lower-confidence (name-only) matches are skipped automatically.`,
    );
    if (!confirmed) return;
    setCveResult(null);
    remediateVuln.mutate(detail.vulnerabilityDefinitionId, { onSuccess: (result) => setCveResult(result) });
  }

  return (
    <div>
      <h1>Vulnerabilities</h1>
      <p className="error-text">
        Heuristic matches based on installed-software name/version text, not CPE-tagged inventory — expect false
        positives and false negatives. Confirm manually before acting.
      </p>

      <form className="panel" onSubmit={handleSync}>
        <h2>Sync CVE catalog from NVD</h2>
        <label>
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as "PUBLISHED" | "LAST_MODIFIED")}>
            <option value="PUBLISHED">Published (default: last 3 years)</option>
            <option value="LAST_MODIFIED">Last modified (for incremental resync)</option>
          </select>
        </label>
        {triggerSync.isError && <p className="error-text">{(triggerSync.error as Error).message}</p>}
        <button type="submit" disabled={triggerSync.isPending}>
          {triggerSync.isPending ? "Starting…" : "Sync now"}
        </button>
        <button
          type="button"
          onClick={() => triggerRescan.mutate()}
          disabled={triggerRescan.isPending}
          style={{ marginLeft: "0.5rem" }}
        >
          {triggerRescan.isPending ? "Rescanning…" : "Rescan fleet"}
        </button>
      </form>

      <div className="panel">
        <h2>Remediate by severity</h2>
        <p>Uninstalls the vulnerable software (via the existing Commands dispatch) on every endpoint with an OPEN finding at the selected severity.</p>
        {SEVERITIES.map((s) => (
          <label key={s} className="checkbox-row">
            <input type="checkbox" checked={selectedSeverities.includes(s)} onChange={() => toggleSeverity(s)} />
            {s}
          </label>
        ))}
        {remediateSeverity.isError && <p className="error-text">{(remediateSeverity.error as Error).message}</p>}
        <button
          type="button"
          onClick={handleRemediateSeverities}
          disabled={remediateSeverity.isPending || selectedSeverities.length === 0}
        >
          {remediateSeverity.isPending ? "Dispatching…" : "Remediate selected severities"}
        </button>
        {severityResult && <p>{remediationSummaryText(severityResult)}</p>}
      </div>

      <h2>Sync history</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Mode</th>
            <th>Window</th>
            <th>Started</th>
            <th>Status</th>
            <th>CVEs</th>
          </tr>
        </thead>
        <tbody>
          {syncRuns?.map((run) => (
            <tr key={run.id}>
              <td>{run.mode}</td>
              <td>
                {new Date(run.windowStartAt).toLocaleDateString()} – {new Date(run.windowEndAt).toLocaleDateString()}
              </td>
              <td>{new Date(run.startedAt).toLocaleString()}</td>
              <td>
                {run.status}
                {run.errorMessage && <span className="error-text"> — {run.errorMessage}</span>}
              </td>
              <td>{run.cveUpsertedCount}</td>
            </tr>
          ))}
          {syncRuns?.length === 0 && (
            <tr>
              <td colSpan={5}>No syncs run yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Fleet findings (possible matches)</h2>
      <label>
        Severity
        <select value={findingsSeverityFilter} onChange={(e) => setFindingsSeverityFilter(e.target.value)}>
          <option value="ALL">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value="UNKNOWN">Unknown</option>
        </select>
      </label>
      <table className="data-table">
        <thead>
          <tr>
            <th>CVE</th>
            <th>Description</th>
            <th>CVSS</th>
            <th>Severity</th>
            <th>Affected endpoints</th>
          </tr>
        </thead>
        <tbody>
          {filteredSummary?.map((item) => (
            <tr
              key={item.vulnerabilityDefinitionId}
              className="clickable-row"
              onClick={() => {
                setSelectedDefId(item.vulnerabilityDefinitionId);
                setCveResult(null);
              }}
            >
              <td>
                <a
                  href={`https://nvd.nist.gov/vuln/detail/${item.cveId}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.cveId}
                </a>
              </td>
              <td>{truncate(item.description, 100)}</td>
              <td>{item.cvssBaseScore ?? "—"}</td>
              <td>
                {item.cvssSeverity ? (
                  <span className={`status-badge ${severityBadgeClass(item.cvssSeverity)}`}>{item.cvssSeverity}</span>
                ) : (
                  "—"
                )}
              </td>
              <td>{item.affectedAgentCount}</td>
            </tr>
          ))}
          {filteredSummary?.length === 0 && (
            <tr>
              <td colSpan={5}>
                {summary?.length === 0
                  ? "No possible matches found yet — sync the catalog and rescan the fleet."
                  : "No findings match this severity filter."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {detail && (
        <div className="panel">
          <h2>
            <a href={`https://nvd.nist.gov/vuln/detail/${detail.cveId}`} target="_blank" rel="noreferrer">
              {detail.cveId}
            </a>{" "}
            — {detail.cvssSeverity ?? "—"} ({detail.cvssBaseScore ?? "—"})
          </h2>
          <p>{detail.description}</p>
          {remediateVuln.isError && <p className="error-text">{(remediateVuln.error as Error).message}</p>}
          <button type="button" onClick={handleRemediateVulnerability} disabled={remediateVuln.isPending}>
            {remediateVuln.isPending
              ? "Dispatching…"
              : `Remediate — uninstall on ${new Set(detail.findings.map((f) => f.agentId)).size} endpoint(s)`}
          </button>
          {cveResult && <p>{remediationSummaryText(cveResult)}</p>}
          <table className="data-table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Matched software</th>
                <th>Version</th>
                <th>Confidence</th>
                <th>CPE criteria</th>
              </tr>
            </thead>
            <tbody>
              {detail.findings.map((f) => (
                <tr key={f.id}>
                  <td>{f.hostname}</td>
                  <td>{f.matchedSoftwareName}</td>
                  <td>{f.matchedSoftwareVersion ?? "—"}</td>
                  <td>{f.matchConfidence === "PRODUCT_AND_VERSION" ? "Name + version" : "Name only"}</td>
                  <td className="mono-cell">{f.matchedCpeCriteria}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
