import { Fragment, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Download, FileUp, ListChecks, Pencil, Plus, ShieldCheck, Trash2, Users, Wrench, X } from "lucide-react";
import type { SecurityBenchmarkTargetType, SecurityRuleOperator, SecurityRuleSeverity } from "@em/shared";
import type { SecurityBenchmarkDetail } from "../api/types";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import {
  useAddSecurityRule,
  useAgents,
  useAssetGroups,
  useAssignSecurityBenchmark,
  useCreateSecurityBenchmark,
  useDeleteSecurityBenchmark,
  useDeleteSecurityRule,
  useImportSecurityRules,
  useAgentSecurityFindings,
  useRemediateAllForAgentInBenchmark,
  useRemediateSelectedForAgentInBenchmark,
  useSecurityBenchmark,
  useSecurityBenchmarkAgentBreakdown,
  useSecurityBenchmarkAssignments,
  useSecurityBenchmarks,
  useUnassignSecurityBenchmark,
  type SecurityRuleInput,
} from "../api/hooks";
import EndpointLabel from "../components/EndpointLabel";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  FormGrid,
  IconButton,
  Modal,
  PageHeader,
  Pill,
  RowMenu,
  Skeleton,
  Status,
  Tabs,
  Tag,
  useConfirm,
} from "../components/ui";

// Policy-style workflow: benchmark list → selected benchmark's tabs (Rules, Assignment,
// Compliance). Creating a benchmark happens in a modal.

const SEVERITIES: SecurityRuleSeverity[] = ["HIGH", "MEDIUM", "LOW"];
const OPERATORS: SecurityRuleOperator[] = ["EQUALS", "NOT_EQUALS", "GTE", "LTE", "CONTAINS", "REGEX_MATCH"];
const TARGET_TYPES: SecurityBenchmarkTargetType[] = ["WINDOWS_10", "WINDOWS_11", "WINDOWS_SERVER", "SQL_SERVER"];

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

function SourceBadge({ source }: { source: string }) {
  return source === "BUILT_IN" ? <Badge tone="ok">Built-in</Badge> : <Badge tone="neu">Custom</Badge>;
}

// PASS / FAIL / ERROR counts as ok / critical / medium badges; a zero count stays neutral.
function CheckCounts({ pass, fail, error }: { pass: number; fail: number; error: number }) {
  return (
    <div className="app-badge-row">
      <Badge tone={pass > 0 ? "ok" : "neu"}>{pass} pass</Badge>
      <Badge tone={fail > 0 ? "crit" : "neu"}>{fail} fail</Badge>
      <Badge tone={error > 0 ? "med" : "neu"}>{error} error</Badge>
    </div>
  );
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
  const confirm = useConfirm();
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleDeleteRule(ruleId: string, ruleTitle: string) {
    const confirmed = await confirm({
      title: `Delete rule "${ruleTitle}"?`,
      body: "Its pass/fail results are no longer reported for this benchmark. This cannot be undone.",
      confirmLabel: "Delete rule",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteRule.mutate({ benchmarkId: benchmark.id, ruleId });
  }

  return (
    <div className="app-stack">
      {benchmark.rules.length === 0 ? (
        <EmptyState icon={ListChecks} title="No rules yet">
          Add one below or import a JSON rule set. A benchmark with no rules checks nothing.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Title</th>
                <th scope="col">Severity</th>
                <th scope="col">Check</th>
                <th scope="col">Pass / Fail / Error</th>
                <th scope="col">Remediation</th>
                <th scope="col">
                  <span className="app-vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {benchmark.rules.map((r) => (
                <tr key={r.id}>
                  <td className="ep-mono">{r.ruleKey}</td>
                  <td>{r.title}</td>
                  <td>
                    <Status value={r.severity} />
                  </td>
                  <td className="ep-mono">
                    {r.operator} {r.expectedValue}
                  </td>
                  <td>
                    <CheckCounts pass={r.passCount} fail={r.failCount} error={r.errorCount} />
                  </td>
                  <td>{r.remediationPowerShell ? "Yes" : <span className="app-muted">—</span>}</td>
                  <td>
                    <div className="app-cell-actions">
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${r.title}`}
                        onClick={() => handleDeleteRule(r.id, r.title)}
                        disabled={deleteRule.isPending}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="app-inset-form">
        <span className="app-subhead">Import rules</span>
        <p className="app-text">Start from the JSON template, then import a file containing an array of rule objects.</p>
        <div className="app-actions-row">
          <Button icon={Download} onClick={downloadTemplate}>
            Download JSON template
          </Button>
          <Button icon={FileUp} onClick={() => fileInputRef.current?.click()} disabled={importRules.isPending}>
            {importRules.isPending ? "Importing…" : "Import JSON file"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="app-vh"
            tabIndex={-1}
            aria-label="Import JSON file"
            onChange={handleImportFile}
          />
        </div>
        {importError && <Alert tone="critical">{importError}</Alert>}
        {importRules.isError && <Alert tone="critical">{(importRules.error as Error).message}</Alert>}
      </div>

      <form onSubmit={handleAddRule} className="app-inset-form">
        <span className="app-subhead">Add rule manually</span>
        <FormGrid>
          <Field label="Rule key" htmlFor="sec-rule-key" required>
            <input id="sec-rule-key" className="ep-input ep-mono" type="text" value={ruleKey} onChange={(e) => setRuleKey(e.target.value)} required />
          </Field>
          <Field label="Title" htmlFor="sec-rule-title" required>
            <input id="sec-rule-title" className="ep-input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="Description" htmlFor="sec-rule-desc" span2>
            <textarea id="sec-rule-desc" className="ep-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Severity" htmlFor="sec-rule-severity">
            <select
              id="sec-rule-severity"
              className="ep-select"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as SecurityRuleSeverity)}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Operator" htmlFor="sec-rule-operator">
            <select
              id="sec-rule-operator"
              className="ep-select"
              value={operator}
              onChange={(e) => setOperator(e.target.value as SecurityRuleOperator)}
            >
              {OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Check PowerShell" htmlFor="sec-rule-check" required span2 help="Must print the current value to stdout.">
            <textarea
              id="sec-rule-check"
              className="ep-textarea ep-mono"
              rows={3}
              value={checkPowerShell}
              onChange={(e) => setCheckPowerShell(e.target.value)}
              required
            />
          </Field>
          <Field label="Expected value" htmlFor="sec-rule-expected" required>
            <input
              id="sec-rule-expected"
              className="ep-input ep-mono"
              type="text"
              value={expectedValue}
              onChange={(e) => setExpectedValue(e.target.value)}
              required
            />
          </Field>
          <Field label="Remediation PowerShell" htmlFor="sec-rule-remediation" span2 help="Optional.">
            <textarea
              id="sec-rule-remediation"
              className="ep-textarea ep-mono"
              rows={3}
              value={remediationPowerShell}
              onChange={(e) => setRemediationPowerShell(e.target.value)}
            />
          </Field>
        </FormGrid>
        {addRule.isError && <Alert tone="critical">{(addRule.error as Error).message}</Alert>}
        <div className="app-actions-row app-end">
          <Button type="submit" variant="primary" icon={Plus} disabled={addRule.isPending}>
            {addRule.isPending ? "Adding…" : "Add rule"}
          </Button>
        </div>
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
    <div className="app-stack">
      <div className="app-stack-sm">
        <span className="app-subhead">Currently assigned</span>
        {!assignments ? (
          <Skeleton lines={2} />
        ) : assignments.length === 0 ? (
          <EmptyState icon={Users} title="Not assigned to any endpoint or group yet">
            Pick groups or endpoints below. A benchmark scans nothing until it's assigned.
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
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.hostname ? <EndpointLabel hostname={a.hostname} agentId={a.agentId} /> : a.groupName}</td>
                    <td>{a.hostname ? "Endpoint" : <Badge tone="neu">Group</Badge>}</td>
                    <td>
                      <div className="app-cell-actions">
                        <IconButton
                          icon={X}
                          label={`Remove ${a.hostname ?? a.groupName ?? "assignment"}`}
                          onClick={() => unassign.mutate({ benchmarkId, assignmentId: a.id })}
                          disabled={unassign.isPending}
                        />
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
          <div className="app-check-grid" role="group" aria-label="Groups">
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

// Drill-down for one endpoint: its failing rules for this benchmark, each with a checkbox,
// and a "Remediate selected" action that dispatches remediation only for the ticked rules.
function AgentFailedRules({ benchmarkId, agentId, hostname }: { benchmarkId: string; agentId: string; hostname: string }) {
  const { data: findings } = useAgentSecurityFindings(agentId);
  const remediateSelected = useRemediateSelectedForAgentInBenchmark();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ remediatedCount: number; skippedCount: number } | null>(null);

  if (!findings) return <Skeleton lines={2} />;
  const failed = findings.filter((f) => f.benchmarkId === benchmarkId && f.status === "FAIL");
  if (failed.length === 0) return <p className="app-text">No failing rules for this benchmark.</p>;

  const remediable = failed.filter((f) => f.hasRemediation);
  const allRemediableSelected = remediable.length > 0 && remediable.every((f) => selected.has(f.ruleId));

  function toggle(ruleId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allRemediableSelected ? new Set() : new Set(remediable.map((f) => f.ruleId)));
  }
  async function handleRemediate() {
    const ruleIds = [...selected];
    if (ruleIds.length === 0) return;
    const confirmed = await confirm({
      title: `Run remediation for ${ruleIds.length} rule(s) on ${hostname}?`,
      body: "Each selected rule's remediation PowerShell runs on the endpoint and changes its configuration.",
      confirmLabel: "Remediate",
      tone: "danger",
    });
    if (!confirmed) return;
    setResult(null);
    remediateSelected.mutate(
      { benchmarkId, agentId, ruleIds },
      {
        onSuccess: (r) => {
          setResult({ remediatedCount: r.remediatedCount, skippedCount: r.skippedCount });
          setSelected(new Set());
        },
      },
    );
  }

  return (
    <div className="app-stack-sm">
      <div className="app-table-wrap" style={{ background: "var(--ep-surface)" }}>
        <table className="ep-tbl">
          <thead>
            <tr>
              <th className="ep-cb" scope="col">
                <input
                  type="checkbox"
                  checked={allRemediableSelected}
                  onChange={toggleAll}
                  disabled={remediable.length === 0}
                  title="Select all remediable rules"
                  aria-label="Select all remediable rules"
                />
              </th>
              <th scope="col">Failed rule</th>
              <th scope="col">Severity</th>
              <th scope="col">Expected</th>
              <th scope="col">Actual</th>
            </tr>
          </thead>
          <tbody>
            {failed.map((f) => (
              <tr key={f.ruleId} className={selected.has(f.ruleId) ? "ep-sel" : undefined}>
                <td className="ep-cb">
                  <input
                    type="checkbox"
                    checked={selected.has(f.ruleId)}
                    onChange={() => toggle(f.ruleId)}
                    disabled={!f.hasRemediation}
                    title={f.hasRemediation ? undefined : "This rule has no remediation script"}
                    aria-label={`Select ${f.title}`}
                  />
                </td>
                <td>
                  {f.title}
                  {!f.hasRemediation && <span className="app-muted app-cell-note">No auto-remediation</span>}
                </td>
                <td>
                  <Status value={f.severity} />
                </td>
                <td className="ep-mono">{f.expectedValue}</td>
                <td className="ep-mono">{f.actualValue ?? <span className="app-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="app-actions-row">
        <Button size="sm" icon={Wrench} onClick={handleRemediate} disabled={selected.size === 0 || remediateSelected.isPending}>
          {remediateSelected.isPending ? "Remediating…" : `Remediate selected (${selected.size})`}
        </Button>
      </div>
      {result && (
        <Alert tone="success">
          Dispatched {result.remediatedCount} job(s){result.skippedCount ? ` — ${result.skippedCount} skipped (no script)` : ""}. See{" "}
          <Link className="ep-link" to="/commands">
            Commands
          </Link>{" "}
          for status; this re-grades on the next scan.
        </Alert>
      )}
      {remediateSelected.isError && <Alert tone="critical">{(remediateSelected.error as Error).message}</Alert>}
    </div>
  );
}

function CompliancePanel({ benchmarkId, onOpenAssignment }: { benchmarkId: string; onOpenAssignment: () => void }) {
  const { data: breakdown } = useSecurityBenchmarkAgentBreakdown(benchmarkId);
  const remediateAll = useRemediateAllForAgentInBenchmark();
  const confirm = useConfirm();
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [remediatingAgentId, setRemediatingAgentId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    agentId: string;
    remediatedCount?: number;
    skippedCount?: number;
    error?: string;
  } | null>(null);

  async function handleRemediateAll(agentId: string, hostname: string, failCount: number) {
    const confirmed = await confirm({
      title: `Remediate all ${failCount} failing rule(s) on ${hostname}?`,
      body: "Every failing rule that has a remediation PowerShell script runs it on the endpoint and changes its configuration.",
      confirmLabel: "Remediate all",
      tone: "danger",
    });
    if (!confirmed) return;
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

  if (!breakdown) return <Skeleton lines={4} />;
  if (breakdown.agents.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Not assigned to any endpoint yet"
        action={
          <Button size="sm" onClick={onOpenAssignment}>
            Assign benchmark
          </Button>
        }
      >
        Assign the benchmark to groups or endpoints to see per-endpoint compliance here.
      </EmptyState>
    );
  }

  const lastResultHost = lastResult && breakdown.agents.find((a) => a.agentId === lastResult.agentId)?.hostname;

  return (
    <div className="app-stack">
      {lastResult?.remediatedCount !== undefined && (
        <Alert tone="success" title={lastResultHost ? `Remediation dispatched for ${lastResultHost}` : "Remediation dispatched"}>
          Dispatched {lastResult.remediatedCount} job(s)
          {lastResult.skippedCount ? ` — ${lastResult.skippedCount} rule(s) had no remediation script` : ""}. Check the{" "}
          <Link className="ep-link" to="/commands">
            Commands
          </Link>{" "}
          page for status; this re-grades on the next scan.
        </Alert>
      )}
      {lastResult?.error && (
        <Alert tone="critical" title={lastResultHost ? `Couldn't remediate ${lastResultHost}` : "Couldn't remediate"}>
          {lastResult.error}
        </Alert>
      )}
      <div className="app-table-wrap">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Endpoint</th>
              <th scope="col">Scanned</th>
              <th scope="col" style={{ textAlign: "right" }}>
                Pass
              </th>
              <th scope="col" style={{ textAlign: "right" }}>
                Fail
              </th>
              <th scope="col" style={{ textAlign: "right" }}>
                Error
              </th>
              <th scope="col">
                <span className="app-vh">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {breakdown.agents.map((a) => {
              const canExpand = a.failCount > 0;
              const isExpanded = expandedAgentId === a.agentId;
              const isRemediating = remediateAll.isPending && remediatingAgentId === a.agentId;
              return (
                <Fragment key={a.agentId}>
                  <tr className={isExpanded ? "ep-sel" : undefined}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {canExpand && (
                          <IconButton
                            icon={isExpanded ? ChevronDown : ChevronRight}
                            label={isExpanded ? `Hide failing rules for ${a.hostname}` : `Show failing rules for ${a.hostname}`}
                            aria-expanded={isExpanded}
                            onClick={() => setExpandedAgentId(isExpanded ? null : a.agentId)}
                          />
                        )}
                        <span>
                          <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
                        </span>
                      </span>
                    </td>
                    <td>{a.scanned ? <Badge tone="ok">Scanned</Badge> : <Pill tone="warn">Pending first scan</Pill>}</td>
                    <td style={{ textAlign: "right" }}>
                      <Badge tone={a.passCount > 0 ? "ok" : "neu"}>{a.passCount}</Badge>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Badge tone={a.failCount > 0 ? "crit" : "neu"}>{a.failCount}</Badge>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Badge tone={a.errorCount > 0 ? "med" : "neu"}>{a.errorCount}</Badge>
                    </td>
                    <td>
                      {a.failCount > 0 && (
                        <div className="app-cell-actions">
                          <Button size="sm" variant="ghost" onClick={() => setExpandedAgentId(isExpanded ? null : a.agentId)}>
                            {isExpanded ? "Hide rules" : "Select & remediate"}
                          </Button>
                          <Button
                            size="sm"
                            icon={Wrench}
                            onClick={() => handleRemediateAll(a.agentId, a.hostname, a.failCount)}
                            disabled={isRemediating}
                          >
                            {isRemediating ? "Remediating…" : "Remediate all failing"}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={6} style={{ background: "var(--ep-surface-2)" }}>
                        <AgentFailedRules benchmarkId={benchmarkId} agentId={a.agentId} hostname={a.hostname} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The selected benchmark: name, target/source, and its sub-views as tabs. Scrolls itself
// into view when a different benchmark is opened, since it renders below the list.
function BenchmarkDetail({ benchmark, onClose }: { benchmark: SecurityBenchmarkDetail; onClose: () => void }) {
  const [tab, setTab] = useState("rules");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab("rules");
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [benchmark.id]);

  return (
    <div ref={ref} className="app-policy-detail" role="region" aria-label={`Benchmark ${benchmark.name}`}>
    <Card
      flush
      title={
        <>
          {benchmark.name} <Tag>{targetTypeLabel(benchmark.targetType)}</Tag> <SourceBadge source={benchmark.source} />
        </>
      }
      hint={`${benchmark.rules.length} ${benchmark.rules.length === 1 ? "rule" : "rules"} · ${benchmark.assignedAgentCount} assigned endpoints`}
      actions={<IconButton icon={X} label="Close benchmark" onClick={onClose} />}
    >
      {benchmark.description && (
        <div className="ep-cb" style={{ paddingBottom: 0 }}>
          <p className="app-text">{benchmark.description}</p>
        </div>
      )}
      <div className="app-policy-tabs">
        <Tabs
          items={[
            { value: "rules", label: `Rules (${benchmark.rules.length})` },
            { value: "assignment", label: "Assignment" },
            { value: "compliance", label: "Compliance by endpoint" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="ep-cb">
        {tab === "rules" && <RulesPanel benchmark={benchmark} />}
        {tab === "assignment" && <AssignmentPanel benchmarkId={benchmark.id} />}
        {tab === "compliance" && <CompliancePanel benchmarkId={benchmark.id} onOpenAssignment={() => setTab("assignment")} />}
      </div>
    </Card>
    </div>
  );
}

export default function SecurityConfigPage() {
  const { data: benchmarks, isLoading, error, refetch } = useSecurityBenchmarks();
  const createBenchmark = useCreateSecurityBenchmark();
  const deleteBenchmark = useDeleteSecurityBenchmark();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
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
          setCreating(false);
        },
      },
    );
  }

  async function handleDelete(id: string, benchmarkName: string) {
    const confirmed = await confirm({
      title: `Delete benchmark "${benchmarkName}"?`,
      body: "Its rules, assignments and compliance results are removed. This cannot be undone.",
      confirmLabel: "Delete benchmark",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteBenchmark.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(undefined);
      },
    });
  }

  const formId = "new-benchmark-form";

  return (
    <>
      <PageHeader
        title="Security configuration"
        description="Scan endpoints against a security benchmark — the seeded CIS-aligned baseline or a benchmark you define — and track pass/fail compliance per rule."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New benchmark
          </Button>
        }
      />

      <Card flush title="Benchmarks" hint={benchmarks ? `${benchmarks.length} total` : undefined}>
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load benchmarks"
              action={
                <Button size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            >
              {(error as Error).message}
            </Alert>
          </div>
        ) : !benchmarks || benchmarks.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No benchmarks yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New benchmark
              </Button>
            }
          >
            Create a custom benchmark, add or import its rules, then assign it to groups or endpoints.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Target</th>
                  <th scope="col">Source</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Rules
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
                {benchmarks.map((b) => (
                  <tr key={b.id} className={`app-clickable ${b.id === selectedId ? "ep-sel" : ""}`} onClick={() => setSelectedId(b.id)}>
                    <td className="ep-host">
                      <b>{b.name}</b>
                      {b.description && <span className="app-row-sub">{b.description}</span>}
                    </td>
                    <td>
                      <Tag>{targetTypeLabel(b.targetType)}</Tag>
                    </td>
                    <td>
                      <SourceBadge source={b.source} />
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {b.ruleCount}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {b.assignedAgentCount}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {b.compliancePercent != null ? `${b.compliancePercent}%` : <span className="app-muted">—</span>}
                    </td>
                    <td>
                      <div className="app-cell-actions">
                        <RowMenu
                          label={`Actions for ${b.name}`}
                          items={[
                            { label: "Open benchmark", icon: Pencil, onSelect: () => setSelectedId(b.id) },
                            {
                              label: "Delete benchmark",
                              icon: Trash2,
                              danger: true,
                              dividerBefore: true,
                              disabled: deleteBenchmark.isPending,
                              onSelect: () => handleDelete(b.id, b.name),
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

      {benchmark && <BenchmarkDetail benchmark={benchmark} onClose={() => setSelectedId(undefined)} />}

      {creating && (
        <Modal
          title="New custom benchmark"
          description="Pick the platform its rules check, then add or import rules once it's created."
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button onClick={() => setCreating(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form={formId} disabled={createBenchmark.isPending || !name.trim()}>
                {createBenchmark.isPending ? "Creating…" : "Create benchmark"}
              </Button>
            </>
          }
        >
          <form id={formId} onSubmit={handleCreate} className="app-stack">
            <Field label="Name" htmlFor="new-benchmark-name" required>
              <input
                id="new-benchmark-name"
                data-autofocus
                className="ep-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <Field label="Target type" htmlFor="new-benchmark-target">
              <select
                id="new-benchmark-target"
                className="ep-select"
                value={targetType}
                onChange={(e) => setTargetType(e.target.value as SecurityBenchmarkTargetType)}
              >
                {TARGET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {targetTypeLabel(t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description" htmlFor="new-benchmark-desc">
              <textarea
                id="new-benchmark-desc"
                className="ep-textarea"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            {createBenchmark.isError && <Alert tone="critical">{(createBenchmark.error as Error).message}</Alert>}
          </form>
        </Modal>
      )}
    </>
  );
}
