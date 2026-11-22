import { Fragment, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Download, FileUp, RefreshCw, ListChecks, Pencil, Plus, ShieldCheck, Trash2, Users, Wrench, X } from "lucide-react";
import type { GpoImportPreview, SecurityBenchmarkTargetType, SecurityRuleOperator, SecurityRuleSeverity } from "@em/shared";
import type { SecurityBenchmarkDetail } from "../api/types";
import {
  useAddSecurityRule,
  useAssignSecurityBenchmark,
  useCreateSecurityBenchmark,
  useDeleteSecurityBenchmark,
  useDeleteSecurityRule,
  useImportSecurityRules,
  useInstallBuiltInBenchmarks,
  useBenchmarkScanNow,
  usePreviewGpoBackup,
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
import { AssignmentEditor } from "../components/policy";
import RemediationStatus from "../components/RemediationStatus";
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
  useToast,
} from "../components/ui";
import { pluralize } from "../format";

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

// Preview of an uploaded Group Policy backup: one checkbox per GPO found in the .zip. Only
// the ticked GPOs' rules are imported; rules the benchmark already has are skipped server-side.
function GpoImportModal({
  benchmark,
  preview,
  onClose,
}: {
  benchmark: SecurityBenchmarkDetail;
  preview: GpoImportPreview;
  onClose: (result?: string) => void;
}) {
  const importRules = useImportSecurityRules();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preview.gpos.filter((g) => g.rules.length > 0).map((g) => g.guid)));

  const chosen = preview.gpos.filter((g) => selected.has(g.guid));
  const rules = chosen.flatMap((g) => g.rules);
  const skipped = preview.gpos.flatMap((g) => g.skipped.map((s) => `${g.name}: ${s}`));
  const warnings = preview.gpos.flatMap((g) => g.warnings.map((w) => `${g.name}: ${w}`));

  function toggle(guid: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(guid);
      else next.delete(guid);
      return next;
    });
  }

  function handleImport() {
    const before = benchmark.rules.length;
    importRules.mutate(
      { benchmarkId: benchmark.id, rules },
      {
        onSuccess: (updated) => {
          const added = updated.rules.length - before;
          const already = rules.length - added;
          onClose(
            `Imported ${pluralize(added, "rule")} from ${pluralize(chosen.length, "GPO")}` +
              (already > 0 ? ` (${already} already in this benchmark)` : "") +
              ".",
          );
        },
      },
    );
  }

  return (
    <Modal
      title="Import From Group Policy Backup"
      description="Each computer setting becomes a rule with a check and a fix. Choose the GPOs to import."
      onClose={() => onClose()}
      footer={
        <>
          <Button onClick={() => onClose()}>Cancel</Button>
          <Button variant="primary" icon={FileUp} onClick={handleImport} disabled={rules.length === 0 || importRules.isPending}>
            {importRules.isPending ? "Importing…" : `Import ${pluralize(rules.length, "rule")}`}
          </Button>
        </>
      }
    >
      <div className="app-stack">
        <div className="app-stack-sm">
          {preview.gpos.map((g) => (
            <Check
              key={g.guid}
              checked={selected.has(g.guid)}
              disabled={g.rules.length === 0}
              onChange={(on) => toggle(g.guid, on)}
              label={g.name}
              hint={`${pluralize(g.rules.length, "rule")}${g.skipped.length ? ` · ${g.skipped.length} not checkable` : ""}`}
            />
          ))}
        </div>
        {warnings.length > 0 && (
          <Alert tone="info">
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </Alert>
        )}
        {skipped.length > 0 && (
          <details>
            <summary className="app-text">
              {pluralize(skipped.length, "setting")} can't be checked as a single value and will be left out
            </summary>
            <pre className="app-pre">{skipped.join("\n")}</pre>
          </details>
        )}
        {importRules.isError && <Alert tone="critical">{(importRules.error as Error).message}</Alert>}
      </div>
    </Modal>
  );
}

function RulesPanel({ benchmark }: { benchmark: SecurityBenchmarkDetail }) {
  const addRule = useAddSecurityRule();
  const importRules = useImportSecurityRules();
  const deleteRule = useDeleteSecurityRule();
  const confirm = useConfirm();
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewGpo = usePreviewGpoBackup();
  const gpoInputRef = useRef<HTMLInputElement>(null);
  const [gpoResult, setGpoResult] = useState<string | null>(null);

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

  function handleGpoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setGpoResult(null);
    previewGpo.mutate({ benchmarkId: benchmark.id, file });
  }

  async function handleDeleteRule(ruleId: string, ruleTitle: string) {
    const confirmed = await confirm({
      title: `Delete Rule "${ruleTitle}"?`,
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
        <span className="app-subhead">Import Rules</span>
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

      <div className="app-inset-form">
        <span className="app-subhead">Import From Group Policy</span>
        <p className="app-text">
          Upload a Group Policy backup as a .zip — a Microsoft Security Compliance Toolkit baseline, a CIS Build Kit, or
          your own <span className="ep-mono">Backup-GPO</span> export. Its computer settings (administrative templates,
          password and lockout policy, user rights, security options, advanced audit policy) become rules with a check
          and a fix. You'll choose which GPOs to import before anything is saved.
        </p>
        <div className="app-actions-row">
          <Button icon={FileUp} onClick={() => gpoInputRef.current?.click()} disabled={previewGpo.isPending}>
            {previewGpo.isPending ? "Reading backup…" : "Upload GPO backup (.zip)"}
          </Button>
          <input
            ref={gpoInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="app-vh"
            tabIndex={-1}
            aria-label="Upload GPO backup"
            onChange={handleGpoFile}
          />
        </div>
        {previewGpo.isError && <Alert tone="critical">{(previewGpo.error as Error).message}</Alert>}
        {gpoResult && <Alert tone="success">{gpoResult}</Alert>}
      </div>

      {previewGpo.data && (
        <GpoImportModal
          benchmark={benchmark}
          preview={previewGpo.data}
          onClose={(result) => {
            previewGpo.reset();
            if (result) setGpoResult(result);
          }}
        />
      )}

      <form onSubmit={handleAddRule} className="app-inset-form">
        <span className="app-subhead">Add Rule Manually</span>
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
  const { data: assignments } = useSecurityBenchmarkAssignments(benchmarkId);
  const assign = useAssignSecurityBenchmark();
  const unassign = useUnassignSecurityBenchmark();
  return (
    <AssignmentEditor
      assignments={assignments}
      onUnassign={(assignmentId) => unassign.mutate({ benchmarkId, assignmentId })}
      unassignPending={unassign.isPending}
      onAssign={(agentIds, groupIds, done) => assign.mutate({ benchmarkId, agentIds, groupIds }, { onSuccess: done })}
      assignPending={assign.isPending}
      assignError={assign.error}
      renderAgentExtra={(agent) => agent.osEditionLabel && <span className="app-muted">({agent.osEditionLabel})</span>}
    />
  );
}

// Drill-down for one endpoint: its failing rules for this benchmark, each with a checkbox,
// and a "Remediate selected" action that dispatches remediation only for the ticked rules.
function AgentFailedRules({ benchmarkId, agentId, hostname }: { benchmarkId: string; agentId: string; hostname: string }) {
  const { data: findings } = useAgentSecurityFindings(agentId);
  const remediateSelected = useRemediateSelectedForAgentInBenchmark();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ remediatedCount: number; skippedCount: number; needsReview?: string[] } | null>(null);

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
      title: `Run Remediation for ${ruleIds.length} Rule(s) on ${hostname}?`,
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
          setResult({ remediatedCount: r.remediatedCount, skippedCount: r.skippedCount, needsReview: r.needsReview });
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
              <th scope="col">Fix</th>
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
                <td>
                  <RemediationStatus
                    remediation={f.remediation ? { ...f.remediation, action: "configure" } : null}
                    emptyLabel={f.hasRemediation ? "Not run" : "—"}
                  />
                </td>
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
          Dispatched {result.remediatedCount} fix(es){result.skippedCount ? ` — ${result.skippedCount} skipped` : ""}.
          {result.needsReview && result.needsReview.length > 0 && (
            <> Not fixed automatically because they change how Windows starts or signs in: {result.needsReview.join(", ")}. Apply them one device at a time from the endpoint's Security tab.</>
          )} Each
          rule's Fix column shows its progress and result; a successful fix re-checks the rule automatically (agent 0.2.10+).
          Details are also under{" "}
          <Link className="ep-link" to="/commands">
            Commands
          </Link>
          .
        </Alert>
      )}
      {remediateSelected.isError && <Alert tone="critical">{(remediateSelected.error as Error).message}</Alert>}
    </div>
  );
}

function CompliancePanel({
  benchmarkId,
  onOpenAssignment,
  initialExpandedAgentId,
}: {
  benchmarkId: string;
  onOpenAssignment: () => void;
  initialExpandedAgentId?: string;
}) {
  const { data: breakdown } = useSecurityBenchmarkAgentBreakdown(benchmarkId);
  const remediateAll = useRemediateAllForAgentInBenchmark();
  const confirm = useConfirm();
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(initialExpandedAgentId ?? null);
  const [remediatingAgentId, setRemediatingAgentId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    agentId: string;
    remediatedCount?: number;
    skippedCount?: number;
    needsReview?: string[];
    error?: string;
  } | null>(null);

  async function handleRemediateAll(agentId: string, hostname: string, failCount: number) {
    const confirmed = await confirm({
      title: `Remediate All ${failCount} Failing Rule(s) on ${hostname}?`,
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
          setLastResult({ agentId, remediatedCount: result.remediatedCount, skippedCount: result.skippedCount, needsReview: result.needsReview }),
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
          {lastResult.skippedCount ? ` — ${lastResult.skippedCount} rule(s) not fixed automatically` : ""}.
          {lastResult.needsReview && lastResult.needsReview.length > 0 && (
            <> Apply these one device at a time (they change how Windows starts or signs in): {lastResult.needsReview.join(", ")}.</>
          )}{" "}
          Check the{" "}
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
// Rendered with key={benchmark.id}, so opening another benchmark starts it fresh.
// initialTab / focusAgentId come from a deep link (an endpoint's Security posture).
function BenchmarkDetail({
  benchmark,
  onClose,
  initialTab = "rules",
  focusAgentId,
}: {
  benchmark: SecurityBenchmarkDetail;
  onClose: () => void;
  initialTab?: string;
  focusAgentId?: string;
}) {
  const scanNow = useBenchmarkScanNow();
  const toast = useToast();

  function handleScanNow() {
    scanNow.mutate(benchmark.id, {
      onSuccess: (r) =>
          toast(
            r.agentCount === 0
              ? "No endpoints are assigned yet - assign it first."
              : `Scan requested on ${r.agentCount} endpoint${r.agentCount === 1 ? "" : "s"}. Results appear within a minute of their next check-in.`,
          ),
      onError: (err) => toast((err as Error).message),
    });
  }

  const [tab, setTab] = useState(initialTab);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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
      actions={
        <>
          <Button size="sm" icon={RefreshCw} onClick={handleScanNow} disabled={scanNow.isPending}>
            {scanNow.isPending ? "Requesting…" : "Scan now"}
          </Button>
          <IconButton icon={X} label="Close benchmark" onClick={onClose} />
        </>
      }
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
            { value: "compliance", label: "Compliance by Endpoint" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="ep-cb">
        {tab === "rules" && <RulesPanel benchmark={benchmark} />}
        {tab === "assignment" && <AssignmentPanel benchmarkId={benchmark.id} />}
        {tab === "compliance" && (
          <CompliancePanel benchmarkId={benchmark.id} onOpenAssignment={() => setTab("assignment")} initialExpandedAgentId={focusAgentId} />
        )}
      </div>
    </Card>
    </div>
  );
}

export default function SecurityConfigPage() {
  const { data: benchmarks, isLoading, error, refetch } = useSecurityBenchmarks();
  const createBenchmark = useCreateSecurityBenchmark();
  const deleteBenchmark = useDeleteSecurityBenchmark();
  const installBuiltIns = useInstallBuiltInBenchmarks();
  const confirm = useConfirm();
  const toast = useToast();

  // Deep link: /security-config?benchmark=<id>&tab=compliance&endpoint=<agentId>
  const [searchParams] = useSearchParams();
  const [deepLink] = useState(() => ({
    benchmarkId: searchParams.get("benchmark") ?? undefined,
    tab: searchParams.get("tab") ?? undefined,
    agentId: searchParams.get("endpoint") ?? undefined,
  }));
  const [selectedId, setSelectedId] = useState<string | undefined>(deepLink.benchmarkId);
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
      title: `Delete Benchmark "${benchmarkName}"?`,
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

  function handleInstallBuiltIns() {
    installBuiltIns.mutate(undefined, {
      onSuccess: ({ created }) =>
        toast(
          created.length === 0
            ? "All built-in benchmarks are already here."
            : `Added ${created.map((b) => `${b.name} (${pluralize(b.rules, "rule")})`).join(", ")}.`,
        ),
    });
  }

  return (
    <>
      <PageHeader
        title="Security Configuration"
        description="Scan endpoints against a security benchmark — the built-in CIS-aligned baselines, a Group Policy baseline you import, or rules you define — and track pass/fail compliance per rule."
        actions={
          <>
            <Button icon={ShieldCheck} onClick={handleInstallBuiltIns} disabled={installBuiltIns.isPending}>
              {installBuiltIns.isPending ? "Adding…" : "Add built-in benchmarks"}
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              New benchmark
            </Button>
          </>
        }
      />
      {installBuiltIns.isError && <Alert tone="critical">{(installBuiltIns.error as Error).message}</Alert>}

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

      {benchmark && (
        <BenchmarkDetail
          key={benchmark.id}
          benchmark={benchmark}
          onClose={() => setSelectedId(undefined)}
          initialTab={benchmark.id === deepLink.benchmarkId ? deepLink.tab : undefined}
          focusAgentId={benchmark.id === deepLink.benchmarkId ? deepLink.agentId : undefined}
        />
      )}

      {creating && (
        <Modal
          title="New Custom Benchmark"
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
