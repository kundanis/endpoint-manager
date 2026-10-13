import { Fragment, useEffect, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, FileSearch, FolderSearch, Monitor, Pencil, Plus, Radar, SearchX, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import type { DataDiscoveryRegulation } from "@em/shared";
import {
  useAgentDataDiscoveryFindings,
  useAssignDataDiscoveryPolicy,
  useCreateDataDiscoveryPolicy,
  useDataDiscoveryAgentBreakdown,
  useDataDiscoveryAssignments,
  useDataDiscoveryPolicies,
  useDataDiscoveryPolicy,
  useDeleteDataDiscoveryPolicy,
  useRequestDataDiscoveryScanNow,
  useUnassignDataDiscoveryPolicy,
  useUpdateDataDiscoveryPolicy,
} from "../api/hooks";
import type { DataDiscoveryPolicyDetail } from "../api/types";
import EndpointLabel from "../components/EndpointLabel";
import { AssignmentEditor, NewPolicyDialog, PolicyDetail } from "../components/policy";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormFooter,
  IconButton,
  Kpi,
  KpiStrip,
  PageHeader,
  Pagination,
  RowMenu,
  Skeleton,
  Switch,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatDateTime } from "../format";

const REGULATIONS: DataDiscoveryRegulation[] = ["DPDP", "GDPR", "BOTH"];

const REGULATION_LABEL: Record<DataDiscoveryRegulation, string> = {
  DPDP: "DPDP (India)",
  GDPR: "GDPR (EU)",
  BOTH: "DPDP + GDPR",
};

const DEFAULT_TARGET_PATHS = ["%USERPROFILE%\\Documents", "%USERPROFILE%\\Desktop", "%USERPROFILE%\\Downloads"];

const TARGET_PATHS_HELP = "One per line. %ENV_VAR% placeholders are expanded on each endpoint.";

function pathsToText(paths: string[]): string {
  return paths.join("\n");
}

function textToPaths(text: string): string[] {
  return text
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
}

// Regulation + target paths: the scan-specific fields shared by the create dialog and the
// settings tab.
function ScanFields({
  idPrefix,
  regulation,
  onRegulationChange,
  pathsText,
  onPathsTextChange,
}: {
  idPrefix: string;
  regulation: DataDiscoveryRegulation;
  onRegulationChange: (value: DataDiscoveryRegulation) => void;
  pathsText: string;
  onPathsTextChange: (value: string) => void;
}) {
  return (
    <>
      <Field label="Regulation" htmlFor={`${idPrefix}-regulation`}>
        <select
          id={`${idPrefix}-regulation`}
          className="ep-select"
          value={regulation}
          onChange={(e) => onRegulationChange(e.target.value as DataDiscoveryRegulation)}
        >
          {REGULATIONS.map((r) => (
            <option key={r} value={r}>
              {REGULATION_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Target paths" htmlFor={`${idPrefix}-paths`} required help={TARGET_PATHS_HELP}>
        <textarea
          id={`${idPrefix}-paths`}
          className="ep-textarea ep-mono"
          rows={4}
          value={pathsText}
          onChange={(e) => onPathsTextChange(e.target.value)}
          required
        />
      </Field>
    </>
  );
}

function PolicySettingsPanel({ policy }: { policy: DataDiscoveryPolicyDetail }) {
  const updatePolicy = useUpdateDataDiscoveryPolicy();
  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description ?? "");
  const [regulation, setRegulation] = useState<DataDiscoveryRegulation>(policy.regulation);
  const [pathsText, setPathsText] = useState(pathsToText(policy.targetPaths));

  useEffect(() => {
    setName(policy.name);
    setDescription(policy.description ?? "");
    setRegulation(policy.regulation);
    setPathsText(pathsToText(policy.targetPaths));
  }, [policy.id, policy.name, policy.description, policy.regulation, policy.targetPaths]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    updatePolicy.mutate({
      id: policy.id,
      name,
      description: description.trim() || null,
      regulation,
      targetPaths: textToPaths(pathsText),
    });
  }

  return (
    <form onSubmit={handleSave} className="app-settings-form">
      <div className="app-stack" style={{ maxWidth: 640 }}>
        <Field label="Name" htmlFor={`dd-name-${policy.id}`} required>
          <input id={`dd-name-${policy.id}`} className="ep-input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Description" htmlFor={`dd-desc-${policy.id}`}>
          <textarea id={`dd-desc-${policy.id}`} className="ep-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <ScanFields
          idPrefix={`dd-${policy.id}`}
          regulation={regulation}
          onRegulationChange={setRegulation}
          pathsText={pathsText}
          onPathsTextChange={setPathsText}
        />
        {updatePolicy.isError && <Alert tone="critical">{(updatePolicy.error as Error).message}</Alert>}
      </div>
      <FormFooter>
        {updatePolicy.isSuccess && !updatePolicy.isPending && <span className="app-saved">Saved</span>}
        <Button variant="primary" type="submit" disabled={updatePolicy.isPending || !name.trim() || textToPaths(pathsText).length === 0}>
          {updatePolicy.isPending ? "Saving…" : "Save policy"}
        </Button>
      </FormFooter>
    </form>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = useDataDiscoveryAssignments(policyId);
  const assign = useAssignDataDiscoveryPolicy();
  const unassign = useUnassignDataDiscoveryPolicy();
  return (
    <AssignmentEditor
      assignments={assignments}
      onUnassign={(assignmentId) => unassign.mutate({ policyId, assignmentId })}
      unassignPending={unassign.isPending}
      onAssign={(agentIds, groupIds, done) => assign.mutate({ policyId, agentIds, groupIds }, { onSuccess: done })}
      assignPending={assign.isPending}
      assignError={assign.error}
    />
  );
}

type ResultsFilter = "all" | "flagged" | "clean" | "nothing-scanned";

// Expanded drill-down shown under an endpoint row: the files where personal data was found on
// that endpoint, with the category of each match (Aadhaar, PAN, credit card, …), the match
// count, and masked previews. Scoped to this policy. Reuses the same per-agent findings API
// the endpoint detail page uses.
function AgentFindingsDetail({ agentId, policyId }: { agentId: string; policyId: string }) {
  const { data: findings } = useAgentDataDiscoveryFindings(agentId);
  if (!findings) return <Skeleton lines={3} />;
  const forPolicy = findings.filter((f) => f.policyId === policyId);
  if (forPolicy.length === 0) return <p className="app-muted">No file-level findings recorded for this endpoint yet.</p>;

  return (
    <div className="app-table-wrap">
      <table className="ep-tbl">
        <thead>
          <tr>
            <th scope="col">File path</th>
            <th scope="col">Category of data found</th>
            <th scope="col">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {forPolicy.map((f) => (
            <tr key={f.id}>
              <td className="ep-mono" style={{ overflowWrap: "anywhere" }}>
                {f.filePath}
              </td>
              <td>
                <div className="app-stack-sm">
                  {f.matches.map((m) => (
                    <div key={m.label}>
                      <Badge tone="crit">
                        {m.label} <span className="ep-num">({m.count})</span>
                      </Badge>
                      {m.samples.length > 0 && (
                        <span className="app-cell-note app-muted ep-mono">
                          {m.samples.join(", ")}
                          {m.count > m.samples.length ? ` (+${m.count - m.samples.length} more)` : ""}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </td>
              <td className="app-muted">{formatDateTime(f.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsPanel({ policyId }: { policyId: string }) {
  const { data: breakdown, isLoading } = useDataDiscoveryAgentBreakdown(policyId);
  const scanNow = useRequestDataDiscoveryScanNow();
  const [filter, setFilter] = useState<ResultsFilter>("all");
  // Which endpoint's file-level findings are expanded, if any.
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  const agents = breakdown?.agents ?? [];
  // A scan that read zero files proves nothing — it isn't "clean", it means none of the
  // target folders existed on that endpoint (or none held a supported file type).
  const readNothing = (a: (typeof agents)[number]) => a.scanned && a.filesScanned === 0;
  const flaggedCount = agents.filter((a) => a.fileCount > 0).length;
  const cleanCount = agents.filter((a) => a.scanned && a.fileCount === 0 && !readNothing(a)).length;
  const nothingScannedCount = agents.filter(readNothing).length;
  const filtered = agents.filter((a) => {
    if (filter === "flagged") return a.fileCount > 0;
    if (filter === "clean") return a.scanned && a.fileCount === 0 && !readNothing(a);
    if (filter === "nothing-scanned") return readNothing(a);
    return true;
  });
  const paged = usePagedList(filtered, 25);

  return (
    <div className="app-stack">
      <div className="app-actions-row">
        <Button icon={Radar} onClick={() => scanNow.mutate({ policyId })} disabled={scanNow.isPending || agents.length === 0}>
          {scanNow.isPending ? "Requesting…" : "Scan all assigned now"}
        </Button>
        <span className="app-muted" style={{ fontSize: 12.5 }}>
          Reaches each endpoint on its next check-in (usually within ~30s) rather than waiting for the normal scan interval.
        </span>
      </div>
      {scanNow.isSuccess && <Alert tone="success">Requested for {scanNow.data.requestedCount} endpoint(s).</Alert>}
      {scanNow.isError && <Alert tone="critical">{(scanNow.error as Error).message}</Alert>}

      <KpiStrip>
        <Kpi icon={Monitor} label="Total devices" value={agents.length} suffix="assigned" active={filter === "all"} onClick={() => setFilter("all")} />
        <Kpi
          icon={FileSearch}
          label="Files with personal data"
          value={flaggedCount}
          suffix="devices"
          valueTone={flaggedCount > 0 ? "critical" : undefined}
          active={filter === "flagged"}
          onClick={() => setFilter("flagged")}
        />
        <Kpi
          icon={ShieldCheck}
          label="Clean"
          value={cleanCount}
          suffix="scanned, none found"
          active={filter === "clean"}
          onClick={() => setFilter("clean")}
        />
        <Kpi
          icon={TriangleAlert}
          label="Nothing scanned"
          value={nothingScannedCount}
          suffix="0 files read"
          valueTone={nothingScannedCount > 0 ? "warning" : undefined}
          footer="The target folders don't exist on these endpoints, or hold no supported files"
          active={filter === "nothing-scanned"}
          onClick={() => setFilter("nothing-scanned")}
        />
      </KpiStrip>

      {isLoading ? (
        <Skeleton />
      ) : agents.length === 0 ? (
        <EmptyState icon={Monitor} title="Not assigned to any endpoint yet">
          Assign the policy in the Assignment tab to start scanning.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No devices match this filter"
          action={
            <Button size="sm" onClick={() => setFilter("all")}>
              Show all devices
            </Button>
          }
        />
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">Scanned</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Files read
                </th>
                <th scope="col">Files with personal data</th>
                <th scope="col">Last scan</th>
                <th scope="col">
                  <span className="app-vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((a) => {
                const canExpand = a.fileCount > 0;
                const isExpanded = expandedAgentId === a.agentId;
                const toggle = () => setExpandedAgentId(isExpanded ? null : a.agentId);
                return (
                  <Fragment key={a.agentId}>
                    <tr
                      className={`${canExpand ? "app-clickable" : ""} ${isExpanded ? "ep-sel" : ""}`}
                      onClick={canExpand ? toggle : undefined}
                      title={canExpand ? "Click to show the files and the type of data found" : undefined}
                    >
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {canExpand && (
                            <IconButton
                              icon={isExpanded ? ChevronDown : ChevronRight}
                              label={isExpanded ? `Hide files on ${a.hostname}` : `Show files on ${a.hostname}`}
                              aria-expanded={isExpanded}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle();
                              }}
                            />
                          )}
                          <span>
                            <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
                          </span>
                        </span>
                      </td>
                      <td>{a.scanned ? "Yes" : <span className="app-muted">Pending first scan</span>}</td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {a.filesScanned ?? "—"}
                      </td>
                      <td>
                        {a.fileCount > 0 ? (
                          <Badge tone="crit">{`${a.fileCount} file${a.fileCount === 1 ? "" : "s"}`}</Badge>
                        ) : readNothing(a) ? (
                          <Badge tone="med">Nothing scanned — check target paths</Badge>
                        ) : a.scanned ? (
                          <Badge tone="ok">None found</Badge>
                        ) : (
                          <span className="app-muted">—</span>
                        )}
                      </td>
                      <td className="app-muted">{formatDateTime(a.lastScanAt)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="app-cell-actions">
                          {a.scanPending ? (
                            <span className="app-muted" style={{ fontSize: 12.5 }}>
                              Scan requested…
                            </span>
                          ) : (
                            <Button size="sm" onClick={() => scanNow.mutate({ policyId, agentId: a.agentId })} disabled={scanNow.isPending}>
                              Scan now
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} style={{ background: "var(--ep-surface-2)" }}>
                          <AgentFindingsDetail agentId={a.agentId} policyId={policyId} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <Pagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            noun="devices"
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
        </div>
      )}
    </div>
  );
}

export default function DataDiscoveryPage() {
  const { data: policies, isLoading, error, refetch } = useDataDiscoveryPolicies();
  const createPolicy = useCreateDataDiscoveryPolicy();
  const updatePolicy = useUpdateDataDiscoveryPolicy();
  const deletePolicy = useDeleteDataDiscoveryPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [regulation, setRegulation] = useState<DataDiscoveryRegulation>("DPDP");
  const [pathsText, setPathsText] = useState(pathsToText(DEFAULT_TARGET_PATHS));

  const { data: policy } = useDataDiscoveryPolicy(selectedId);

  function handleCreate(values: { name: string; description: string | null }) {
    return createPolicy
      .mutateAsync({ name: values.name, description: values.description, regulation, targetPaths: textToPaths(pathsText) })
      .then((result) => {
        setSelectedId(result.id);
        setPathsText(pathsToText(DEFAULT_TARGET_PATHS));
      });
  }

  function toggleEnabled(id: string, enabled: boolean) {
    updatePolicy.mutate({ id, enabled });
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm({
      title: `Delete policy "${name}"?`,
      body: "Assigned endpoints stop scanning for it. This cannot be undone.",
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

  return (
    <>
      <PageHeader
        title="Data discovery"
        description="Find where personal data lives across your endpoints, for DPDP (India's Digital Personal Data Protection Act) and GDPR"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        }
      />

      <Alert tone="info" title="Only masked previews leave the endpoint">
        Each policy scans a set of folders on assigned endpoints for patterns relevant to DPDP and/or GDPR (Aadhaar,
        PAN, email, phone numbers, card numbers, IP addresses, and more). Findings report the file path, match counts,
        and a handful of <em>masked</em> previews per pattern (e.g. "••••••••6789") — enough to confirm a real match,
        but the unmasked value never leaves the endpoint.
      </Alert>

      <Card flush title="Policies" hint={policies ? `${policies.length} total · paused policies are skipped entirely and don't scan any device` : undefined}>
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert tone="critical" title="Couldn't load policies" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
              {(error as Error).message}
            </Alert>
          </div>
        ) : !policies || policies.length === 0 ? (
          <EmptyState
            icon={FolderSearch}
            title="No data discovery policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, choose the folders to scan, then assign it to groups or endpoints.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Policy</th>
                  <th scope="col">Status</th>
                  <th scope="col">Regulation</th>
                  <th scope="col">Target paths</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Assigned endpoints
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Files with personal data
                  </th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} className={`app-clickable ${p.id === selectedId ? "ep-sel" : ""}`} onClick={() => setSelectedId(p.id)}>
                    <td className="ep-host">
                      <b>{p.name}</b>
                      {p.description && <span className="app-row-sub">{p.description}</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Switch checked={p.enabled} onChange={(enabled) => toggleEnabled(p.id, enabled)} label={p.enabled ? "Enabled" : "Paused"} />
                    </td>
                    <td>{REGULATION_LABEL[p.regulation]}</td>
                    <td className="ep-mono" style={{ overflowWrap: "anywhere" }}>
                      {p.targetPaths.join(", ")}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.assignedAgentCount}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.filesWithFindingsCount > 0 ? <Badge tone="crit">{p.filesWithFindingsCount}</Badge> : p.filesWithFindingsCount}
                    </td>
                    <td>
                      <div className="app-cell-actions">
                        <RowMenu
                          label={`Actions for ${p.name}`}
                          items={[
                            { label: "Open policy", icon: Pencil, onSelect: () => setSelectedId(p.id) },
                            {
                              label: "Delete policy",
                              icon: Trash2,
                              danger: true,
                              dividerBefore: true,
                              disabled: deletePolicy.isPending,
                              onSelect: () => handleDelete(p.id, p.name),
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

      {policy && (
        <PolicyDetail
          policyId={policy.id}
          name={policy.name}
          enabled={policy.enabled}
          meta={`${REGULATION_LABEL[policy.regulation]} · ${policy.assignedAgentCount} ${policy.assignedAgentCount === 1 ? "endpoint" : "endpoints"}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "results", label: "Discovery results", content: <ResultsPanel policyId={policy.id} /> },
            { value: "assignment", label: "Assignment", content: <AssignmentPanel policyId={policy.id} /> },
            { value: "settings", label: "Settings", content: <PolicySettingsPanel policy={policy} /> },
          ]}
        />
      )}

      {creating && (
        <NewPolicyDialog
          onClose={() => setCreating(false)}
          pending={createPolicy.isPending}
          error={createPolicy.error}
          extraValid={textToPaths(pathsText).length > 0}
          onCreate={handleCreate}
        >
          <ScanFields
            idPrefix="dd-new"
            regulation={regulation}
            onRegulationChange={setRegulation}
            pathsText={pathsText}
            onPathsTextChange={setPathsText}
          />
        </NewPolicyDialog>
      )}
    </>
  );
}
