import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Clock,
  Download,
  FolderSearch,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import {
  useAssignThreatProtectionPolicy,
  useCreateThreatProtectionPolicy,
  useDeleteThreatProtectionPolicy,
  useRequestThreatAction,
  useRequestThreatScan,
  useResolveThreat,
  useThreatDetections,
  useThreatOverview,
  useThreatPolicySync,
  useThreatProtectionAssignments,
  useThreatProtectionPolicies,
  useThreatProtectionPolicy,
  useThreatTasks,
  useUnassignThreatProtectionPolicy,
  useUpdateThreatProtectionPolicy,
  type ThreatProtectionPolicyBody,
} from "../api/hooks";
import type { ThreatDetectionView, ThreatEndpointState, ThreatEndpointView, ThreatProtectionPolicyView, ThreatTaskView } from "../api/types";
import EndpointLabel from "../components/EndpointLabel";
import { AssignmentEditor, NewPolicyDialog, PolicyDetail, PolicySettingsForm, SyncStatusTable } from "../components/policy";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  FormGrid,
  Kpi,
  KpiStrip,
  Modal,
  PageHeader,
  Pagination,
  RowMenu,
  SearchInput,
  Segmented,
  Skeleton,
  Switch,
  Tag,
  Toolbar,
  useConfirm,
  usePagedList,
  useToast,
  type BadgeTone,
  type MenuItem,
} from "../components/ui";
import { formatDateTime, formatRelative } from "../format";

// Threat Protection: Microsoft Defender managed from the console.
//  Overview (Pattern A, list with KPI strip) - every Windows endpoint's protection state, with
//    scans and signature updates for one or many endpoints;
//  Threats (Pattern A) - what Defender found, with remove / restore / allow / mark resolved;
//  Scans and actions (Pattern A) - what was sent to endpoints and the result;
//  Policies (Pattern B + detail) - Defender settings assigned to groups or endpoints.

const WINDOWS_NOTE = "Windows endpoints with Microsoft Defender, agent 0.2.28 or later.";

// ---- Shared bits

const STATE: Record<ThreatEndpointState, { label: string; tone: BadgeTone }> = {
  AT_RISK: { label: "Threat found", tone: "crit" },
  UNPROTECTED: { label: "Not protected", tone: "crit" },
  OUT_OF_DATE: { label: "Signatures out of date", tone: "high" },
  PROTECTED: { label: "Protected", tone: "ok" },
  THIRD_PARTY: { label: "Other antivirus", tone: "neu" },
  NOT_REPORTED: { label: "Not reported", tone: "neu" },
  NOT_WINDOWS: { label: "Not Windows", tone: "neu" },
};

const SEVERITY: Record<ThreatDetectionView["severity"], { label: string; tone: BadgeTone }> = {
  SEVERE: { label: "Critical", tone: "crit" },
  HIGH: { label: "High", tone: "high" },
  MODERATE: { label: "Medium", tone: "med" },
  LOW: { label: "Low", tone: "low" },
  UNKNOWN: { label: "Unknown", tone: "neu" },
};

const THREAT_STATUS: Record<ThreatDetectionView["status"], { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "Active", tone: "crit" },
  FAILED: { label: "Action failed", tone: "crit" },
  QUARANTINED: { label: "Quarantined", tone: "ok" },
  REMOVED: { label: "Removed", tone: "ok" },
  RESOLVED: { label: "Resolved", tone: "ok" },
  ALLOWED: { label: "Allowed", tone: "neu" },
};

const TASK_WHAT: Record<string, string> = {
  QUICK: "Quick scan",
  FULL: "Full scan",
  CUSTOM: "Custom scan",
  REMOVE: "Remove active threats",
  RESTORE: "Restore from quarantine",
  ALLOW: "Allow on this endpoint",
  UPDATE_SIGNATURES: "Update signatures",
};

function taskStatus(status: string) {
  if (status === "DONE") return <Badge tone="ok">Done</Badge>;
  if (status === "FAILED") return <Badge tone="crit">Failed</Badge>;
  if (status === "RUNNING" || status === "SENT") return <Badge tone="med">Running</Badge>;
  return <Badge tone="neu">Waiting for endpoint</Badge>;
}

const onOff = (v: boolean | null) => (v === null ? <span className="app-muted">—</span> : v ? <Badge tone="ok">On</Badge> : <Badge tone="crit">Off</Badge>);

const RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];

function RangeSelect({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <select className="ep-select" aria-label="Period" value={days} onChange={(e) => onChange(Number(e.target.value))}>
      {RANGES.map((r) => (
        <option key={r.days} value={r.days}>
          {r.label}
        </option>
      ))}
    </select>
  );
}

// Folders to scan, one per line: the custom scan dialog.
function CustomScanDialog({ agentIds, onClose }: { agentIds: string[]; onClose: () => void }) {
  const scan = useRequestThreatScan();
  const toast = useToast();
  const [text, setText] = useState("");
  const paths = text.split("\n").map((p) => p.trim()).filter(Boolean);
  return (
    <Modal
      title="Scan folders"
      description={`Microsoft Defender scans these folders or files on ${agentIds.length === 1 ? "the endpoint" : `${agentIds.length} endpoints`}.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={paths.length === 0 || scan.isPending}
            onClick={() =>
              scan.mutate(
                { agentIds, scanType: "CUSTOM", paths },
                {
                  onSuccess: (r) => {
                    toast(`Scan sent to ${r.created} ${r.created === 1 ? "endpoint" : "endpoints"}.`);
                    onClose();
                  },
                },
              )
            }
          >
            {scan.isPending ? "Sending…" : "Start scan"}
          </Button>
        </>
      }
    >
      <Field label="Folders or files" htmlFor="tp-scan-paths" help="One per line, for example C:\Users\Public\Downloads. Up to 20.">
        <textarea id="tp-scan-paths" className="ep-textarea ep-mono" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="C:\Users\Public\Downloads" />
      </Field>
      {scan.isError && <Alert tone="critical">{(scan.error as Error).message}</Alert>}
    </Modal>
  );
}

function useEndpointActions() {
  const scan = useRequestThreatScan();
  const action = useRequestThreatAction();
  const toast = useToast();
  const sent = (r: { created: number }, what: string) =>
    toast(r.created > 0 ? `${what} sent to ${r.created} ${r.created === 1 ? "endpoint" : "endpoints"}. It starts at their next check-in.` : "None of those endpoints run Windows.");
  return {
    pending: scan.isPending || action.isPending,
    quickScan: (agentIds: string[]) => scan.mutate({ agentIds, scanType: "QUICK" }, { onSuccess: (r) => sent(r, "Quick scan") }),
    fullScan: (agentIds: string[]) => scan.mutate({ agentIds, scanType: "FULL" }, { onSuccess: (r) => sent(r, "Full scan") }),
    updateSignatures: (agentIds: string[]) => action.mutate({ action: "UPDATE_SIGNATURES", agentIds }, { onSuccess: (r) => sent(r, "Signature update") }),
  };
}

// ---- Overview

type OverviewFilter = "all" | "attention" | ThreatEndpointState;

export function ThreatOverviewPage() {
  const { data, isLoading, error, refetch } = useThreatOverview();
  const actions = useEndpointActions();
  const [filter, setFilter] = useState<OverviewFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [customFor, setCustomFor] = useState<string[] | null>(null);

  const windowsEndpoints = useMemo(() => (data?.endpoints ?? []).filter((e) => e.state !== "NOT_WINDOWS"), [data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return windowsEndpoints
      .filter((e) =>
        filter === "all" ? true : filter === "attention" ? ["AT_RISK", "UNPROTECTED", "OUT_OF_DATE"].includes(e.state) : e.state === filter,
      )
      .filter((e) => !q || e.hostname.toLowerCase().includes(q));
  }, [windowsEndpoints, filter, search]);
  const paged = usePagedList(rows, 25);
  const t = data?.totals;

  useEffect(() => setSelected((prev) => prev.filter((id) => windowsEndpoints.some((e) => e.agentId === id))), [windowsEndpoints]);

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allOnPage = paged.pageItems.length > 0 && paged.pageItems.every((e) => selected.includes(e.agentId));

  function rowMenu(e: ThreatEndpointView): MenuItem[] {
    return [
      { label: "Quick scan", icon: ScanSearch, onSelect: () => actions.quickScan([e.agentId]) },
      { label: "Full scan", icon: ScanSearch, onSelect: () => actions.fullScan([e.agentId]) },
      { label: "Scan folders…", icon: FolderSearch, onSelect: () => setCustomFor([e.agentId]) },
      { label: "Update signatures", icon: Download, onSelect: () => actions.updateSignatures([e.agentId]) },
    ];
  }

  return (
    <>
      <PageHeader
        title="Threat Protection"
        description="Microsoft Defender on every Windows endpoint, managed from here: protection status, threats found, scans and signature updates."
      />
      <Alert tone="info" title={WINDOWS_NOTE}>
        Endpoints protected by another antivirus show as Other antivirus: Defender is passive there, so its settings and scans don&apos;t apply.
      </Alert>

      {isLoading ? (
        <Card>
          <Skeleton />
        </Card>
      ) : error ? (
        <Alert tone="critical" title="Couldn't load protection status" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
          {(error as Error).message}
        </Alert>
      ) : (
        <>
          <KpiStrip>
            <Kpi icon={ShieldCheck} label="Protected" value={t?.protected ?? 0} suffix={`of ${t?.endpoints ?? 0}`} onClick={() => setFilter("PROTECTED")} active={filter === "PROTECTED"} />
            <Kpi
              icon={Bug}
              label="Threat found"
              value={t?.atRisk ?? 0}
              suffix={t && t.activeThreats > 0 ? `${t.activeThreats} active ${t.activeThreats === 1 ? "threat" : "threats"}` : "endpoints"}
              valueTone={t && t.atRisk > 0 ? "critical" : undefined}
              onClick={() => setFilter("AT_RISK")}
              active={filter === "AT_RISK"}
            />
            <Kpi
              icon={ShieldOff}
              label="Not protected"
              value={t?.unprotected ?? 0}
              suffix="endpoints"
              valueTone={t && t.unprotected > 0 ? "critical" : undefined}
              onClick={() => setFilter("UNPROTECTED")}
              active={filter === "UNPROTECTED"}
              title="Defender turned off, or real-time protection off"
            />
            <Kpi
              icon={Clock}
              label="Signatures out of date"
              value={t?.outOfDate ?? 0}
              suffix="endpoints"
              valueTone={t && t.outOfDate > 0 ? "warning" : undefined}
              onClick={() => setFilter("OUT_OF_DATE")}
              active={filter === "OUT_OF_DATE"}
              title="Signatures older than 3 days"
            />
            <Kpi
              icon={AlertTriangle}
              label="Other antivirus / not reported"
              value={(t?.thirdParty ?? 0) + (t?.notReported ?? 0)}
              suffix="endpoints"
              onClick={() => setFilter("NOT_REPORTED")}
              active={filter === "NOT_REPORTED" || filter === "THIRD_PARTY"}
              title="Not reported: the endpoint hasn't sent Defender's status yet (agent older than 0.2.28, or offline)"
            />
          </KpiStrip>

          <Card flush title="Endpoints" hint={`${rows.length} shown · ${t?.endpoints ?? 0} Windows endpoints`}>
            <Toolbar>
              <SearchInput placeholder="Search endpoints" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Segmented<OverviewFilter>
                label="Show"
                value={filter === "AT_RISK" || filter === "UNPROTECTED" || filter === "OUT_OF_DATE" || filter === "attention" ? "attention" : filter === "all" ? "all" : filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "attention", label: "Needs attention" },
                  { value: "PROTECTED", label: "Protected" },
                  { value: "THIRD_PARTY", label: "Other antivirus" },
                  { value: "NOT_REPORTED", label: "Not reported" },
                ]}
              />
            </Toolbar>
            {selected.length > 0 && (
              <div className="ep-cb app-cell-actions">
                <span className="app-muted">{selected.length} selected</span>
                <Button size="sm" icon={ScanSearch} disabled={actions.pending} onClick={() => actions.quickScan(selected)}>
                  Quick scan
                </Button>
                <Button size="sm" icon={ScanSearch} disabled={actions.pending} onClick={() => actions.fullScan(selected)}>
                  Full scan
                </Button>
                <Button size="sm" icon={FolderSearch} onClick={() => setCustomFor(selected)}>
                  Scan folders
                </Button>
                <Button size="sm" icon={Download} disabled={actions.pending} onClick={() => actions.updateSignatures(selected)}>
                  Update signatures
                </Button>
                <Button size="sm" onClick={() => setSelected([])}>
                  Clear
                </Button>
              </div>
            )}
            {windowsEndpoints.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="No Windows endpoints yet">
                Enroll Windows endpoints from Enrollment tokens; their Defender status appears here within a few minutes.
              </EmptyState>
            ) : rows.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="No endpoints match">
                Choose All to see every endpoint.
              </EmptyState>
            ) : (
              <div className="app-table-scroll">
                <table className="ep-tbl">
                  <thead>
                    <tr>
                      <th scope="col">
                        <input
                          type="checkbox"
                          aria-label="Select all endpoints on this page"
                          checked={allOnPage}
                          onChange={() =>
                            setSelected((prev) =>
                              allOnPage ? prev.filter((id) => !paged.pageItems.some((e) => e.agentId === id)) : [...new Set([...prev, ...paged.pageItems.map((e) => e.agentId)])],
                            )
                          }
                        />
                      </th>
                      <th scope="col">Endpoint</th>
                      <th scope="col">Protection</th>
                      <th scope="col">Real-time</th>
                      <th scope="col">Signatures</th>
                      <th scope="col">Last scan</th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Threats
                      </th>
                      <th scope="col">
                        <span className="app-vh">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.pageItems.map((e) => {
                      const state = STATE[e.state];
                      const lastScan = [e.lastQuickScanAt, e.lastFullScanAt].filter((d): d is string => !!d).sort().pop() ?? null;
                      const other = e.antivirusProducts.filter((p) => !/defender/i.test(p.name)).map((p) => p.name);
                      return (
                        <tr key={e.agentId} className={selected.includes(e.agentId) ? "ep-sel" : undefined}>
                          <td>
                            <input type="checkbox" aria-label={`Select ${e.hostname}`} checked={selected.includes(e.agentId)} onChange={() => toggle(e.agentId)} />
                          </td>
                          <td>
                            <EndpointLabel hostname={e.hostname} agentId={e.agentId} hideUser />
                          </td>
                          <td>
                            <Badge tone={state.tone}>{state.label}</Badge>
                            {e.state === "THIRD_PARTY" && other.length > 0 && <span className="app-row-sub">{other.join(", ")}</span>}
                            {e.externallyManaged && <span className="app-row-sub">Settings managed by Group Policy or Intune</span>}
                          </td>
                          <td>{e.state === "NOT_REPORTED" ? <span className="app-muted">—</span> : onOff(e.realTimeOn)}</td>
                          <td>
                            {e.signatureVersion ? <span className="ep-mono">{e.signatureVersion}</span> : <span className="app-muted">—</span>}
                            {e.signatureUpdatedAt && <span className="app-row-sub">{formatRelative(e.signatureUpdatedAt)}</span>}
                          </td>
                          <td className="app-muted">{lastScan ? formatRelative(lastScan) : "—"}</td>
                          <td className="ep-num" style={{ textAlign: "right" }}>
                            {e.activeThreats > 0 ? (
                              <Link to={`/threat-protection/threats?agent=${e.agentId}`}>
                                <Badge tone="crit">{e.activeThreats}</Badge>
                              </Link>
                            ) : (
                              <span className="app-muted">0</span>
                            )}
                          </td>
                          <td>
                            <div className="app-cell-actions">
                              <RowMenu label={`Actions for ${e.hostname}`} items={rowMenu(e)} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} noun="endpoints" onPageChange={paged.setPage} onPageSizeChange={paged.setPageSize} />
              </div>
            )}
          </Card>
        </>
      )}
      {customFor && <CustomScanDialog agentIds={customFor} onClose={() => setCustomFor(null)} />}
    </>
  );
}

// ---- Threats

export function ThreatsPage() {
  const [searchParams] = useSearchParams();
  const agentFilter = searchParams.get("agent") ?? undefined;
  const [view, setView] = useState<"open" | "all">("open");
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState("");
  const { data, isLoading, error, refetch } = useThreatDetections(view, days, agentFilter);
  const action = useRequestThreatAction();
  const resolve = useResolveThreat();
  const confirm = useConfirm();
  const toast = useToast();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((d) => !q || [d.threatName, d.hostname, d.filePath ?? "", d.username ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [data, search]);
  const paged = usePagedList(rows, 25);

  async function run(d: ThreatDetectionView, kind: "REMOVE" | "RESTORE" | "ALLOW") {
    const text = {
      REMOVE: { title: `Remove active threats on ${d.hostname}?`, body: "Microsoft Defender removes every active threat it has found on this endpoint (Defender has no option to remove just one).", confirmLabel: "Remove threats" },
      RESTORE: { title: `Restore ${d.threatName}?`, body: "The quarantined item goes back where it was. Defender may quarantine it again at the next scan unless you also allow it.", confirmLabel: "Restore" },
      ALLOW: { title: `Allow ${d.threatName} on ${d.hostname}?`, body: "Defender stops acting on this threat on this endpoint and restores it from quarantine. Only do this for a file you know is safe.", confirmLabel: "Allow" },
    }[kind];
    const ok = await confirm({ ...text, tone: kind === "REMOVE" ? undefined : "danger" });
    if (ok) action.mutate({ action: kind, detectionId: d.id }, { onSuccess: () => toast("Sent to the endpoint. The result shows under Scans and actions.") });
  }

  function menu(d: ThreatDetectionView): MenuItem[] {
    const items: MenuItem[] = [];
    if (d.source === "DEFENDER" && (d.status === "ACTIVE" || d.status === "FAILED")) items.push({ label: "Remove active threats", icon: Trash2, onSelect: () => run(d, "REMOVE") });
    if (d.canRestoreOrAllow && d.status === "QUARANTINED") items.push({ label: "Restore from quarantine", icon: RotateCcw, onSelect: () => run(d, "RESTORE") });
    if (d.canRestoreOrAllow && d.status !== "ALLOWED") items.push({ label: "Allow on this endpoint", icon: ShieldOff, danger: true, onSelect: () => run(d, "ALLOW") });
    if (d.status !== "RESOLVED") {
      items.push({
        label: "Mark resolved",
        icon: CheckCircle2,
        dividerBefore: items.length > 0,
        onSelect: () => resolve.mutate(d.id, { onSuccess: () => toast("Marked resolved. It comes back if Defender reports it active again.") }),
      });
    }
    return items;
  }

  return (
    <>
      <PageHeader title="Threats" description="What Microsoft Defender found on your endpoints, what it did about it, and what still needs action." />
      <Card flush title={view === "open" ? "Open threats" : "All threats"} hint={data ? `${rows.length} shown` : undefined}>
        <Toolbar>
          <SearchInput placeholder="Search threat, endpoint, file or user" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Segmented<"open" | "all">
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: "open", label: "Needs action" },
              { value: "all", label: "All" },
            ]}
          />
          {view === "all" && <RangeSelect days={days} onChange={setDays} />}
          {agentFilter && (
            <Link to="/threat-protection/threats" className="ep-btn ep-btn-sm">
              Show every endpoint
            </Link>
          )}
        </Toolbar>
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert tone="critical" title="Couldn't load threats" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
              {(error as Error).message}
            </Alert>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title={view === "open" ? "No threats need action" : "No threats in this period"}>
            {view === "open" ? "Defender has dealt with everything it found. Choose All to see past detections." : "Run a scan from Overview to check endpoints now."}
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Detected</th>
                  <th scope="col">Endpoint</th>
                  <th scope="col">Threat</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Status</th>
                  <th scope="col">User</th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((d) => {
                  const sev = SEVERITY[d.severity];
                  const st = THREAT_STATUS[d.status];
                  const items = menu(d);
                  return (
                    <tr key={d.id}>
                      <td className="ep-num">
                        {formatDateTime(d.detectedAt)}
                        {d.lastSeenAt !== d.detectedAt && <span className="app-row-sub">Last change {formatRelative(d.lastSeenAt)}</span>}
                      </td>
                      <td>
                        <EndpointLabel hostname={d.hostname} agentId={d.agentId} hideUser />
                      </td>
                      <td>
                        <b>{d.threatName}</b>
                        {d.filePath && (
                          <span className="app-row-sub ep-mono" title={d.resources.join("\n")}>
                            {d.filePath}
                          </span>
                        )}
                        {!d.filePath && d.resources.length > 0 && <span className="app-row-sub ep-mono">{d.resources[0]}</span>}
                      </td>
                      <td>
                        <Badge tone={sev.tone}>{sev.label}</Badge>
                      </td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {d.actionDetail && <span className="app-row-sub">{d.actionDetail}</span>}
                      </td>
                      <td>{d.username ?? <span className="app-muted">—</span>}</td>
                      <td>
                        <div className="app-cell-actions">{items.length > 0 && <RowMenu label={`Actions for ${d.threatName}`} items={items} />}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} noun="threats" onPageChange={paged.setPage} onPageSizeChange={paged.setPageSize} />
          </div>
        )}
      </Card>
    </>
  );
}

// ---- Scans and actions

export function ThreatActivityPage() {
  const [days, setDays] = useState(7);
  const { data, isLoading, error, refetch } = useThreatTasks(days);
  const paged = usePagedList(data ?? [], 25);
  const describe = (t: ThreatTaskView) => (t.kind === "SCAN" && t.what === "CUSTOM" && t.paths.length > 0 ? t.paths.join(", ") : t.threatName);

  return (
    <>
      <PageHeader title="Scans and actions" description="Every scan, signature update and threat action sent to endpoints from Threat Protection, and what happened." />
      <Card flush title="Requests" hint={data ? `${data.length} in this period` : undefined} actions={<RangeSelect days={days} onChange={setDays} />}>
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert tone="critical" title="Couldn't load scans and actions" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
              {(error as Error).message}
            </Alert>
          </div>
        ) : !data || data.length === 0 ? (
          <EmptyState icon={ListChecks} title="Nothing sent in this period">
            Start a scan or a signature update from Overview, or act on a threat from Threats.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Requested</th>
                  <th scope="col">Endpoint</th>
                  <th scope="col">What</th>
                  <th scope="col">Status</th>
                  <th scope="col">Finished</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((t) => (
                  <tr key={`${t.kind}-${t.id}`}>
                    <td className="ep-num">{formatDateTime(t.requestedAt)}</td>
                    <td>
                      <EndpointLabel hostname={t.hostname} agentId={t.agentId} hideUser />
                    </td>
                    <td>
                      {TASK_WHAT[t.what] ?? t.what}
                      {describe(t) && <span className={`app-row-sub ${t.kind === "SCAN" ? "ep-mono" : ""}`}>{describe(t)}</span>}
                    </td>
                    <td>{taskStatus(t.status)}</td>
                    <td className="app-muted">{formatDateTime(t.finishedAt)}</td>
                    <td className="app-muted">{t.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} noun="requests" onPageChange={paged.setPage} onPageSizeChange={paged.setPageSize} />
          </div>
        )}
      </Card>
    </>
  );
}

// ---- Policies

interface SettingsValues {
  realTimeProtection: boolean;
  cloudProtection: boolean;
  submitSamples: boolean;
  puaProtection: boolean;
  scanType: "QUICK" | "FULL";
  scanScheduleDay: number;
  scanScheduleTime: string;
  signatureUpdateHours: number;
  pathsText: string;
  extensionsText: string;
  processesText: string;
}

const DEFAULT_SETTINGS: SettingsValues = {
  realTimeProtection: true,
  cloudProtection: true,
  submitSamples: true,
  puaProtection: true,
  scanType: "QUICK",
  scanScheduleDay: 0,
  scanScheduleTime: "02:00",
  signatureUpdateHours: 4,
  pathsText: "",
  extensionsText: "",
  processesText: "",
};

const DAYS = ["Every day", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Never"];

const lines = (text: string) =>
  text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

function toSettings(p: ThreatProtectionPolicyView): SettingsValues {
  return {
    realTimeProtection: p.realTimeProtection,
    cloudProtection: p.cloudProtection,
    submitSamples: p.submitSamples,
    puaProtection: p.puaProtection,
    scanType: p.scanType,
    scanScheduleDay: p.scanScheduleDay,
    scanScheduleTime: p.scanScheduleTime,
    signatureUpdateHours: p.signatureUpdateHours,
    pathsText: p.excludedPaths.join("\n"),
    extensionsText: p.excludedExtensions.join("\n"),
    processesText: p.excludedProcesses.join("\n"),
  };
}

function toBody(v: SettingsValues): Omit<ThreatProtectionPolicyBody, "name"> {
  return {
    realTimeProtection: v.realTimeProtection,
    cloudProtection: v.cloudProtection,
    submitSamples: v.submitSamples,
    puaProtection: v.puaProtection,
    scanType: v.scanType,
    scanScheduleDay: v.scanScheduleDay,
    scanScheduleTime: v.scanScheduleTime,
    signatureUpdateHours: v.signatureUpdateHours,
    excludedPaths: lines(v.pathsText),
    excludedExtensions: lines(v.extensionsText),
    excludedProcesses: lines(v.processesText),
  };
}

const settingsValid = (v: SettingsValues) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v.scanScheduleTime) && v.signatureUpdateHours >= 1 && v.signatureUpdateHours <= 24;

function SettingsFields({ idPrefix, value, onChange }: { idPrefix: string; value: SettingsValues; onChange: (next: SettingsValues) => void }) {
  const set = (patch: Partial<SettingsValues>) => onChange({ ...value, ...patch });
  return (
    <>
      <div className="app-stack-sm" role="group" aria-label="Protection">
        <span className="app-subhead">Protection (turned on and kept on)</span>
        <Check checked={value.realTimeProtection} onChange={(c) => set({ realTimeProtection: c })} label="Real-time protection" hint="Scans files as they're opened, downloaded or run, and watches program behaviour" />
        <Check checked={value.cloudProtection} onChange={(c) => set({ cloudProtection: c })} label="Cloud protection" hint="Asks Microsoft's cloud about new files and blocks brand-new malware at first sight" />
        <Check checked={value.puaProtection} onChange={(c) => set({ puaProtection: c })} label="Block potentially unwanted apps" hint="Adware, bundled toolbars, coin miners and similar software" />
        <Check
          checked={value.submitSamples}
          onChange={(c) => set({ submitSamples: c })}
          label="Send safe samples to Microsoft"
          hint="Lets Defender upload suspicious files that contain no personal data for analysis. Off: never send samples."
        />
        <span className="app-muted">Unticking a protection switch leaves it as it is on the endpoint; a policy never turns Defender protection off.</span>
      </div>
      <FormGrid>
        <Field label="Scheduled scan" htmlFor={`${idPrefix}-day`}>
          <select id={`${idPrefix}-day`} className="ep-select" value={value.scanScheduleDay} onChange={(e) => set({ scanScheduleDay: Number(e.target.value) })}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Time" htmlFor={`${idPrefix}-time`} help="The endpoint's own local time, 24-hour">
          <input id={`${idPrefix}-time`} type="time" className="ep-input" value={value.scanScheduleTime} onChange={(e) => set({ scanScheduleTime: e.target.value })} />
        </Field>
        <Field label="Scan type" htmlFor={`${idPrefix}-type`}>
          <select id={`${idPrefix}-type`} className="ep-select" value={value.scanType} onChange={(e) => set({ scanType: e.target.value as "QUICK" | "FULL" })}>
            <option value="QUICK">Quick scan</option>
            <option value="FULL">Full scan</option>
          </select>
        </Field>
        <Field label="Check for new signatures every" htmlFor={`${idPrefix}-sig`} help="Hours, 1 to 24">
          <input
            id={`${idPrefix}-sig`}
            type="number"
            min={1}
            max={24}
            className="ep-input ep-num"
            value={value.signatureUpdateHours}
            onChange={(e) => set({ signatureUpdateHours: Number(e.target.value) })}
          />
        </Field>
      </FormGrid>
      <span className="app-subhead">Exclusions (not scanned)</span>
      <span className="app-muted">Keep these few and narrow: anything excluded is never checked for malware. Whole drives, the Windows folder and Downloads are refused.</span>
      <FormGrid>
        <Field label="Folders or files" htmlFor={`${idPrefix}-paths`} help="One per line">
          <textarea id={`${idPrefix}-paths`} className="ep-textarea ep-mono" rows={3} value={value.pathsText} placeholder="D:\SQLData" onChange={(e) => set({ pathsText: e.target.value })} />
        </Field>
        <Field label="File types" htmlFor={`${idPrefix}-ext`} help="One per line, for example .ldf">
          <textarea id={`${idPrefix}-ext`} className="ep-textarea ep-mono" rows={3} value={value.extensionsText} placeholder=".ldf" onChange={(e) => set({ extensionsText: e.target.value })} />
        </Field>
        <Field label="Programs" htmlFor={`${idPrefix}-proc`} help="Files these programs open aren't scanned. One per line.">
          <textarea id={`${idPrefix}-proc`} className="ep-textarea ep-mono" rows={3} value={value.processesText} placeholder="sqlservr.exe" onChange={(e) => set({ processesText: e.target.value })} />
        </Field>
      </FormGrid>
      {!settingsValid(value) && <Alert tone="warn">Use a 24-hour scan time and a signature interval of 1 to 24 hours.</Alert>}
    </>
  );
}

function protectionTags(p: ThreatProtectionPolicyView): string[] {
  return [
    p.realTimeProtection && "Real-time",
    p.cloudProtection && "Cloud",
    p.puaProtection && "Unwanted apps",
    p.scanScheduleDay !== 8 && `${p.scanType === "FULL" ? "Full" : "Quick"} scan ${DAYS[p.scanScheduleDay].toLowerCase()} ${p.scanScheduleTime}`,
    p.excludedPaths.length + p.excludedExtensions.length + p.excludedProcesses.length > 0 &&
      `${p.excludedPaths.length + p.excludedExtensions.length + p.excludedProcesses.length} exclusions`,
  ].filter((s): s is string => !!s);
}

function PolicySettingsPanel({ policy }: { policy: ThreatProtectionPolicyView }) {
  const updatePolicy = useUpdateThreatProtectionPolicy();
  const [settings, setSettings] = useState(toSettings(policy));
  useEffect(() => {
    setSettings(toSettings(policy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.id, policy.updatedAt]);
  return (
    <PolicySettingsForm
      policyId={policy.id}
      name={policy.name}
      description={policy.description}
      onSave={(values) => {
        if (settingsValid(settings)) updatePolicy.mutate({ id: policy.id, name: values.name, description: values.description, ...toBody(settings) });
      }}
      pending={updatePolicy.isPending}
      error={updatePolicy.error}
      saved={updatePolicy.isSuccess}
    >
      <SettingsFields idPrefix={`tp-${policy.id}`} value={settings} onChange={setSettings} />
    </PolicySettingsForm>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = useThreatProtectionAssignments(policyId);
  const assign = useAssignThreatProtectionPolicy();
  const unassign = useUnassignThreatProtectionPolicy();
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

function SyncPanel({ policyId }: { policyId: string }) {
  const { data, isLoading } = useThreatPolicySync(policyId);
  if (isLoading) return <Skeleton />;
  const rows = (data?.agents ?? []).map((a) => ({
    agentId: a.agentId,
    hostname: a.hostname,
    groupName: null,
    lastLoggedOnUser: null,
    lastSyncStatus: a.windows ? a.lastSyncStatus : "FAILED",
    lastSyncError: a.windows ? a.lastSyncError : "Not a Windows endpoint: Threat Protection policies apply to Windows only.",
    lastSyncedAt: a.lastSyncedAt,
  }));
  return (
    <SyncStatusTable
      rows={rows}
      explanation="Whether each endpoint applied this policy's Defender settings. Failed shows what Windows refused, for example a setting Tamper Protection, Group Policy or Intune controls, or another antivirus being active."
    />
  );
}

export function ThreatPoliciesPage() {
  const { data: policies, isLoading, error, refetch } = useThreatProtectionPolicies();
  const createPolicy = useCreateThreatProtectionPolicy();
  const updatePolicy = useUpdateThreatProtectionPolicy();
  const deletePolicy = useDeleteThreatProtectionPolicy();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [newSettings, setNewSettings] = useState(DEFAULT_SETTINGS);
  const { data: policy } = useThreatProtectionPolicy(selectedId);

  function handleCreate(values: { name: string; description: string | null }) {
    return createPolicy.mutateAsync({ name: values.name, description: values.description, ...toBody(newSettings) }).then((result) => {
      setSelectedId(result.id);
      setNewSettings(DEFAULT_SETTINGS);
    });
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Delete policy "${name}"?`,
      body: "Endpoints keep Defender's current settings; only the exclusions this policy added are removed. Threats already recorded stay. This cannot be undone.",
      confirmLabel: "Delete policy",
      tone: "danger",
    });
    if (ok) deletePolicy.mutate(id, { onSuccess: () => selectedId === id && setSelectedId(undefined) });
  }

  return (
    <>
      <PageHeader
        title="Policies"
        description="Microsoft Defender settings for groups or endpoints: real-time and cloud protection, unwanted-app blocking, the scan schedule, signature updates and exclusions."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        }
      />
      <Alert tone="info" title={WINDOWS_NOTE}>
        When an endpoint has more than one policy, every protection any of them turns on is on, exclusions are combined and the oldest policy&apos;s scan schedule is used.
      </Alert>
      <Card flush title="Policies" hint={policies ? `${policies.length} total · paused policies change nothing` : undefined}>
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
            icon={ShieldCheck}
            title="No Threat Protection policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy with the Defender settings you want, then assign it to groups or endpoints.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Policy</th>
                  <th scope="col">Status</th>
                  <th scope="col">Settings</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Assigned endpoints
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Open threats
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
                      <Switch checked={p.enabled} onChange={(enabled) => updatePolicy.mutate({ id: p.id, enabled })} label={p.enabled ? "Enabled" : "Paused"} />
                    </td>
                    <td>
                      <div className="app-badge-row">
                        {protectionTags(p).map((s) => (
                          <Tag key={s}>{s}</Tag>
                        ))}
                      </div>
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.assignedAgentCount}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.activeThreats > 0 ? <Badge tone="crit">{p.activeThreats}</Badge> : <span className="app-muted">0</span>}
                    </td>
                    <td>
                      <div className="app-cell-actions">
                        <RowMenu
                          label={`Actions for ${p.name}`}
                          items={[
                            { label: "Open policy", icon: Pencil, onSelect: () => setSelectedId(p.id) },
                            { label: "Delete policy", icon: Trash2, danger: true, dividerBefore: true, disabled: deletePolicy.isPending, onSelect: () => handleDelete(p.id, p.name) },
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
          meta={`${protectionTags(policy).join(" · ")} · ${policy.assignedAgentCount} ${policy.assignedAgentCount === 1 ? "endpoint" : "endpoints"}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "sync", label: "Sync status", content: <SyncPanel policyId={policy.id} /> },
            { value: "assignment", label: "Assignment", content: <AssignmentPanel policyId={policy.id} /> },
            { value: "settings", label: "Settings", content: <PolicySettingsPanel policy={policy} /> },
          ]}
        />
      )}

      {creating && (
        <NewPolicyDialog onClose={() => setCreating(false)} pending={createPolicy.isPending} error={createPolicy.error} extraValid={settingsValid(newSettings)} onCreate={handleCreate}>
          <SettingsFields idPrefix="tp-new" value={newSettings} onChange={setNewSettings} />
        </NewPolicyDialog>
      )}
    </>
  );
}
