import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { SecurityBenchmarkTargetType, SecurityRuleOperator, SecurityRuleSeverity } from "@em/shared";
import type { SecurityBenchmarkDetail } from "../api/types";
import {
  useAddSecurityRule,
  useAgents,
  useAssetGroups,
  useAssignSecurityBenchmark,
  useCreateSecurityBenchmark,
  useDeleteSecurityBenchmark,
  useDeleteSecurityRule,
  useImportSecurityRules,
  useRemediateAllForAgentInBenchmark,
  useSecurityBenchmark,
  useSecurityBenchmarkAgentBreakdown,
  useSecurityBenchmarkAssignments,
  useSecurityBenchmarks,
  useUnassignSecurityBenchmark,
  type SecurityRuleInput,
} from "../api/hooks";

const SEVERITIES: SecurityRuleSeverity[] = ["HIGH", "MEDIUM", "LOW"];
const OPERATORS: SecurityRuleOperator[] = ["EQUALS", "NOT_EQUALS", "GTE", "LTE", "CONTAINS", "REGEX_MATCH"];
const TARGET_TYPES: SecurityBenchmarkTargetType[] = ["WINDOWS_10", "WINDOWS_11", "WINDOWS_SERVER", "SQL_SERVER"];

function severityBadgeClass(severity: SecurityRuleSeverity): string {
  if (severity === "HIGH") return "danger";
  if (severity === "MEDIUM") return "warn";
  return "online";
}

function targetTypeLabel(targetType: SecurityBenchmarkTargetType): string {
  switch (targetType) {
    case "WINDOWS_10":
      return "Windows 10";
    case "WINDOWS_11":
      return "Windows 11";
    case "WINDOWS_SERVER":
      return "Windows Server";
    case "SQL_SERVER":
      return "SQL Server";
    default:
      return targetType;
  }
}

const TEMPLATE_RULES: SecurityRuleInput[] = [
  {
    ruleKey: "custom-1",
    title: "Example: RDP requires Network Level Authentication",
    description: "Reads the UserAuthentication value under the RDP-Tcp WinStation registry key.",
    severity: "HIGH",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp').UserAuthentication",
    operator: "EQUALS",
    expectedValue: "1",
    remediationPowerShell:
      "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp' -Name UserAuthentication -Value 1",
  },
  {
    ruleKey: "custom-2",
    title: "Example: minimum password length",
    description: "Exports the local security policy and reads MinimumPasswordLength.",
    severity: "MEDIUM",
    checkPowerShell:
      "secedit /export /cfg $env:TEMP\\secpol.cfg | Out-Null; (Select-String -Path $env:TEMP\\secpol.cfg -Pattern 'MinimumPasswordLength').Line.Split('=')[1].Trim()",
    operator: "GTE",
    expectedValue: "14",
    remediationPowerShell: null,
  },
];

function downloadTemplate() {
  const blob = new Blob([JSON.stringify(TEMPLATE_RULES, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "security-benchmark-rules-template.json";
  a.click();
  URL.revokeObjectURL(url);
}

function RulesPanel({ benchmark }: { benchmark: SecurityBenchmarkDetail }) {
  const addRule = useAddSecurityRule();
  const importRules = useImportSecurityRules();
  const deleteRule = useDeleteSecurityRule();
  const [importError, setImportError] = useState<string | null>(null);

  const [ruleKey, setRuleKey] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<SecurityRuleSeverity>("MEDIUM");
  const [checkPowerShell, setCheckPowerShell] = useState("");
  const [operator, setOperator] = useState<SecurityRuleOperator>("EQUALS");
  const [expectedValue, setExpectedValue] = useState("");
  const [remediationPowerShell, setRemediationPowerShell] = useState("");

  function handleAddRule(e: FormEvent) {
    e.preventDefault();
    addRule.mutate(
      {
        benchmarkId: benchmark.id,
        ruleKey,
        title,
        description: description.trim() || null,
        severity,
        checkPowerShell,
        operator,
        expectedValue,
        remediationPowerShell: remediationPowerShell.trim() || null,
      },
      {
        onSuccess: () => {
          setRuleKey("");
          setTitle("");
          setDescription("");
          setSeverity("MEDIUM");
          setCheckPowerShell("");
          setOperator("EQUALS");
          setExpectedValue("");
          setRemediationPowerShell("");
        },
      },
    );
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImportError(null);
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of rule objects");
      importRules.mutate({ benchmarkId: benchmark.id, rules: parsed });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Invalid JSON file");
    }
  }

  return (
    <div className="panel">
      <h2>Rules ({benchmark.rules.length})</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Title</th>
            <th>Severity</th>
            <th>Check</th>
            <th>Pass / Fail / Error</th>
            <th>Remediation</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {benchmark.rules.map((r) => (
            <tr key={r.id}>
              <td className="mono-cell">{r.ruleKey}</td>
              <td>{r.title}</td>
              <td>
                <span className={`status-badge ${severityBadgeClass(r.severity)}`}>{r.severity}</span>
              </td>
              <td className="mono-cell">
                {r.operator} {r.expectedValue}
              </td>
              <td>
                {r.passCount} / {r.failCount} / {r.errorCount}
              </td>
              <td>{r.remediationPowerShell ? "Yes" : "—"}</td>
              <td>
                <button
                  type="button"
                  onClick={() => deleteRule.mutate({ benchmarkId: benchmark.id, ruleId: r.id })}
                  disabled={deleteRule.isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {benchmark.rules.length === 0 && (
            <tr>
              <td colSpan={7}>No rules yet — add one below or import a JSON rule set.</td>
            </tr>
          )}
        </tbody>
      </table>

      <h3>Import rules</h3>
      <p>
        <button type="button" onClick={downloadTemplate}>
          Download JSON template
        </button>{" "}
        <label style={{ marginLeft: "0.5rem" }}>
          Import JSON file
          <input type="file" accept="application/json" onChange={handleImportFile} />
        </label>
      </p>
      {importError && <p className="error-text">{importError}</p>}
      {importRules.isError && <p className="error-text">{(importRules.error as Error).message}</p>}

      <h3>Add rule manually</h3>
      <form onSubmit={handleAddRule}>
        <label>
          Rule key
          <input type="text" value={ruleKey} onChange={(e) => setRuleKey(e.target.value)} required />
        </label>
        <label>
          Title
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Description
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Severity
          <select value={severity} onChange={(e) => setSeverity(e.target.value as SecurityRuleSeverity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Check PowerShell (must print the current value to stdout)
          <textarea rows={3} value={checkPowerShell} onChange={(e) => setCheckPowerShell(e.target.value)} required />
        </label>
        <label>
          Operator
          <select value={operator} onChange={(e) => setOperator(e.target.value as SecurityRuleOperator)}>
            {OPERATORS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expected value
          <input type="text" value={expectedValue} onChange={(e) => setExpectedValue(e.target.value)} required />
        </label>
        <label>
          Remediation PowerShell (optional)
          <textarea rows={3} value={remediationPowerShell} onChange={(e) => setRemediationPowerShell(e.target.value)} />
        </label>
        {addRule.isError && <p className="error-text">{(addRule.error as Error).message}</p>}
        <button type="submit" disabled={addRule.isPending}>
          {addRule.isPending ? "Adding…" : "Add rule"}
        </button>
      </form>
    </div>
  );
}

function AssignmentPanel({ benchmarkId }: { benchmarkId: string }) {
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: assignments } = useSecurityBenchmarkAssignments(benchmarkId);
  const assign = useAssignSecurityBenchmark();
  const unassign = useUnassignSecurityBenchmark();

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
      { benchmarkId, agentIds: selectedAgentIds, groupIds: selectedGroupIds },
      { onSuccess: () => { setSelectedAgentIds([]); setSelectedGroupIds([]); } },
    );
  }

  return (
    <div className="panel">
      <h2>Assignment</h2>

      <h3>Currently assigned</h3>
      <ul>
        {assignments?.map((a) => (
          <li key={a.id}>
            {a.hostname ?? `Group: ${a.groupName}`}{" "}
            <button type="button" onClick={() => unassign.mutate({ benchmarkId, assignmentId: a.id })} disabled={unassign.isPending}>
              Remove
            </button>
          </li>
        ))}
        {assignments?.length === 0 && <li>Not assigned to any endpoint or group yet.</li>}
      </ul>

      <h3>Assign to</h3>
      <fieldset>
        <legend>Endpoints</legend>
        {agents?.map((agent) => (
          <label key={agent.id} className="checkbox-row">
            <input type="checkbox" checked={selectedAgentIds.includes(agent.id)} onChange={() => toggleAgent(agent.id)} />
            {agent.hostname} {agent.osEditionLabel && <span style={{ color: "var(--text-muted)" }}>({agent.osEditionLabel})</span>}
          </label>
        ))}
        {agents?.length === 0 && <p>No endpoints enrolled yet.</p>}
      </fieldset>

      {groups && groups.length > 0 && (
        <fieldset>
          <legend>Groups</legend>
          {groups.map((g) => (
            <label key={g.id} className="checkbox-row">
              <input type="checkbox" checked={selectedGroupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
              {g.name} ({g.memberCount})
            </label>
          ))}
        </fieldset>
      )}

      {assign.isError && <p className="error-text">{(assign.error as Error).message}</p>}
      <button
        type="button"
        onClick={handleAssign}
        disabled={assign.isPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
      >
        {assign.isPending ? "Assigning…" : "Assign"}
      </button>
    </div>
  );
}

function CompliancePanel({ benchmarkId }: { benchmarkId: string }) {
  const { data: breakdown } = useSecurityBenchmarkAgentBreakdown(benchmarkId);
  const remediateAll = useRemediateAllForAgentInBenchmark();
  const [remediatingAgentId, setRemediatingAgentId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    agentId: string;
    remediatedCount?: number;
    skippedCount?: number;
    error?: string;
  } | null>(null);

  function handleRemediateAll(agentId: string) {
    setRemediatingAgentId(agentId);
    setLastResult(null);
    remediateAll.mutate(
      { benchmarkId, agentId },
      {
        onSuccess: (result) =>
          setLastResult({ agentId, remediatedCount: result.remediatedCount, skippedCount: result.skippedCount }),
        onError: (err) => setLastResult({ agentId, error: (err as Error).message }),
        onSettled: () => setRemediatingAgentId(null),
      },
    );
  }

  return (
    <div className="panel">
      <h2>Compliance by endpoint</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Scanned</th>
            <th>Pass</th>
            <th>Fail</th>
            <th>Error</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {breakdown?.agents.map((a) => (
            <tr key={a.agentId}>
              <td>{a.hostname}</td>
              <td>{a.scanned ? "Yes" : "Pending first scan"}</td>
              <td>{a.passCount}</td>
              <td>{a.failCount}</td>
              <td>{a.errorCount}</td>
              <td>
                {a.failCount > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleRemediateAll(a.agentId)}
                      disabled={remediateAll.isPending && remediatingAgentId === a.agentId}
                    >
                      {remediateAll.isPending && remediatingAgentId === a.agentId
                        ? "Remediating…"
                        : "Remediate all failing"}
                    </button>
                    {lastResult?.agentId === a.agentId && lastResult.remediatedCount !== undefined && (
                      <div style={{ fontSize: "0.8rem" }}>
                        Dispatched {lastResult.remediatedCount} job(s)
                        {lastResult.skippedCount ? ` — ${lastResult.skippedCount} rule(s) had no remediation script` : ""}
                        . Check the <Link to="/commands">Commands</Link> page for status; this re-grades on the next
                        scan.
                      </div>
                    )}
                    {lastResult?.agentId === a.agentId && lastResult.error && (
                      <div className="error-text" style={{ fontSize: "0.8rem" }}>
                        {lastResult.error}
                      </div>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
          {breakdown?.agents.length === 0 && (
            <tr>
              <td colSpan={6}>Not assigned to any endpoint yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function SecurityConfigPage() {
  const { data: benchmarks } = useSecurityBenchmarks();
  const createBenchmark = useCreateSecurityBenchmark();
  const deleteBenchmark = useDeleteSecurityBenchmark();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetType, setTargetType] = useState<SecurityBenchmarkTargetType>("WINDOWS_10");

  const { data: benchmark } = useSecurityBenchmark(selectedId);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createBenchmark.mutate(
      { name, description: description.trim() || null, targetType },
      {
        onSuccess: (result) => {
          setSelectedId(result.id);
          setName("");
          setDescription("");
          setTargetType("WINDOWS_10");
        },
      },
    );
  }

  function handleDelete(id: string) {
    deleteBenchmark.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(undefined);
      },
    });
  }

  return (
    <div>
      <h1>Security Configuration</h1>
      <p>
        Scan endpoints against a security benchmark — the seeded CIS-aligned baseline or a benchmark you define — and
        track pass/fail compliance per rule.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Target</th>
            <th>Source</th>
            <th>Rules</th>
            <th>Assigned endpoints</th>
            <th>Compliance</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {benchmarks?.map((b) => (
            <tr key={b.id} className="clickable-row" onClick={() => setSelectedId(b.id)}>
              <td>{b.name}</td>
              <td>
                <span className="status-badge offline">{targetTypeLabel(b.targetType)}</span>
              </td>
              <td>
                <span className={`status-badge ${b.source === "BUILT_IN" ? "online" : "offline"}`}>{b.source}</span>
              </td>
              <td>{b.ruleCount}</td>
              <td>{b.assignedAgentCount}</td>
              <td>{b.compliancePercent != null ? `${b.compliancePercent}%` : "—"}</td>
              <td>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(b.id);
                  }}
                  disabled={deleteBenchmark.isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {benchmarks?.length === 0 && (
            <tr>
              <td colSpan={7}>No benchmarks yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="panel" onSubmit={handleCreate}>
        <h2>New custom benchmark</h2>
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Target type
          <select value={targetType} onChange={(e) => setTargetType(e.target.value as SecurityBenchmarkTargetType)}>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {targetTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {createBenchmark.isError && <p className="error-text">{(createBenchmark.error as Error).message}</p>}
        <button type="submit" disabled={createBenchmark.isPending || !name.trim()}>
          {createBenchmark.isPending ? "Creating…" : "Create benchmark"}
        </button>
      </form>

      {benchmark && (
        <>
          <h2>
            {benchmark.name} <span className="status-badge offline">{targetTypeLabel(benchmark.targetType)}</span>{" "}
            <span className={`status-badge ${benchmark.source === "BUILT_IN" ? "online" : "offline"}`}>{benchmark.source}</span>
          </h2>
          {benchmark.description && <p>{benchmark.description}</p>}
          <RulesPanel benchmark={benchmark} />
          <AssignmentPanel benchmarkId={benchmark.id} />
          <CompliancePanel benchmarkId={benchmark.id} />
        </>
      )}
    </div>
  );
}
