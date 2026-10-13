import { useState, type FormEvent } from "react";
import { Network, Pencil, Plus, Radar, SearchX, Server, Trash2, TriangleAlert } from "lucide-react";
import {
  useAgents,
  useCreateNetworkVlan,
  useDeleteNetworkVlan,
  useLegacyNetworkScanRuns,
  useNetworkScanRun,
  useNetworkVlans,
  useScanAllEnabledVlans,
  useSuggestedCidr,
  useTriggerVlanScan,
  useUpdateNetworkVlan,
  useVlanScanRuns,
} from "../api/hooks";
import type { NetworkScanRunDetail, NetworkScanRunListItem, NetworkVlanListItem } from "../api/types";
import Collapsible from "../components/Collapsible";
import EndpointLabel, { EndpointOption } from "../components/EndpointLabel";
import {
  Alert,
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
  Pill,
  RowMenu,
  Segmented,
  Skeleton,
  Switch,
  useConfirm,
  usePagedList,
  type PillTone,
} from "../components/ui";
import { formatDateTime, formatRelative } from "../format";

// Pattern B (design-system/docs/PAGE_PATTERNS.md, "Network Manager → Scans / devices"):
// VLAN list card, then each VLAN's latest scan with its discovered hosts.

type ScanStatus = NetworkScanRunListItem["status"];

const SCAN_STATUS: Record<ScanStatus, { tone: PillTone; label: string }> = {
  SUCCESS: { tone: "ok", label: "Success" },
  FAILED: { tone: "critical", label: "Failed" },
  PENDING: { tone: "warn", label: "Pending" },
  RUNNING: { tone: "warn", label: "Running" },
};

function ScanStatusPill({ status }: { status: ScanStatus }) {
  const s = SCAN_STATUS[status] ?? { tone: "neutral" as PillTone, label: status };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

// The scanner never fingerprints OS/device type (it's just ping + ARP + a fixed port probe +
// hostname resolution) - there's no real "this is a tablet" signal available. What we do have
// is a reliable negative signal: phones and tablets never expose Windows management ports or
// SSH, while every laptop/desktop/server that answers at all typically has at least one of
// these reachable (even behind a host firewall, RDP/SMB is commonly left open on a managed
// LAN). Used as a heuristic filter below, not a certainty - a PC with every one of these
// closed would be mis-excluded, which is why it's an opt-in toggle rather than baked in.
const COMPUTER_SIGNATURE_PORTS = [22, 135, 139, 445, 3389];

function looksLikeComputer(host: { openPorts: number[]; matchedAgent: unknown }): boolean {
  // A matched Agent means this IP belongs to an enrolled endpoint we already know is a real
  // managed Windows machine - trust that over the port heuristic regardless of what ports
  // happened to respond (e.g. behind a strict host firewall).
  if (host.matchedAgent) return true;
  return host.openPorts.some((p) => COMPUTER_SIGNATURE_PORTS.includes(p));
}

// Shared discovered-hosts table, used both by the run-history picker below (legacy/no-VLAN
// scans) and by the per-VLAN "latest scan only" panel.
type ManagedFilter = "all" | "managed" | "unmanaged";

function DiscoveredHostsTable({ runDetail }: { runDetail: NetworkScanRunDetail }) {
  const [computersOnly, setComputersOnly] = useState(true);
  const [managedFilter, setManagedFilter] = useState<ManagedFilter>("all");
  const [ipFilter, setIpFilter] = useState("");
  const [macFilter, setMacFilter] = useState("");
  const [hostnameFilter, setHostnameFilter] = useState("");
  const [portFilter, setPortFilter] = useState("");

  const totalCount = runDetail.hosts.length;
  const computerCount = runDetail.hosts.filter(looksLikeComputer).length;
  const afterComputerFilter = computersOnly ? runDetail.hosts.filter(looksLikeComputer) : runDetail.hosts;
  const hiddenCount = runDetail.hosts.length - afterComputerFilter.length;

  const ipTerm = ipFilter.trim().toLowerCase();
  const macTerm = macFilter.trim().toLowerCase();
  const hostnameTerm = hostnameFilter.trim().toLowerCase();
  const portTerm = portFilter.trim();
  const visibleHosts = afterComputerFilter
    .filter((h) => managedFilter === "all" || (managedFilter === "managed" ? !!h.matchedAgent : !h.matchedAgent))
    .filter((h) => !ipTerm || h.ipAddress.toLowerCase().includes(ipTerm))
    .filter((h) => !macTerm || (h.macAddress ?? "").toLowerCase().includes(macTerm))
    .filter((h) => !hostnameTerm || (h.hostname ?? "").toLowerCase().includes(hostnameTerm))
    .filter((h) => !portTerm || h.openPorts.some((p) => String(p).includes(portTerm)));
  const paged = usePagedList(visibleHosts, 25);

  const managedCount = afterComputerFilter.filter((h) => !!h.matchedAgent).length;

  function clearFilters() {
    setComputersOnly(false);
    setManagedFilter("all");
    setIpFilter("");
    setMacFilter("");
    setHostnameFilter("");
    setPortFilter("");
  }

  const inProgress = runDetail.status === "PENDING" || runDetail.status === "RUNNING";

  return (
    <div className="app-stack">
      <span className="app-subhead">
        Discovered hosts — <span className="ep-mono">{runDetail.cidr}</span>
      </span>
      {runDetail.status === "FAILED" && runDetail.errorMessage && (
        <Alert tone="critical" title="Scan failed">
          {runDetail.errorMessage}
        </Alert>
      )}

      <div className="app-actions-row">
        <Segmented
          label="Managed status"
          value={managedFilter}
          onChange={setManagedFilter}
          options={[
            { value: "all", label: `All ${afterComputerFilter.length}` },
            { value: "managed", label: `Managed ${managedCount}` },
            { value: "unmanaged", label: `Unmanaged ${afterComputerFilter.length - managedCount}` },
          ]}
        />
        <Check
          checked={computersOnly}
          onChange={setComputersOnly}
          label={
            <>
              Laptops, desktops and servers only{" "}
              <span className="app-muted ep-num">
                ({computerCount} of {totalCount})
              </span>
            </>
          }
          hint={
            computersOnly && hiddenCount > 0
              ? `${hiddenCount} device${hiddenCount === 1 ? "" : "s"} hidden (phones, tablets and other non-PC devices) — heuristic based on open ports (no Windows/SSH management ports responded), not a guaranteed device type.`
              : "Hides phones, tablets and other non-PC devices."
          }
        />
      </div>

      <div className="app-actions-row">
        <input
          className="ep-input ep-mono"
          style={{ width: 160 }}
          value={ipFilter}
          onChange={(e) => setIpFilter(e.target.value)}
          placeholder="IP: 192.168.1…"
          aria-label="Filter by IP address"
        />
        <input
          className="ep-input ep-mono"
          style={{ width: 160 }}
          value={macFilter}
          onChange={(e) => setMacFilter(e.target.value)}
          placeholder="MAC: AA:BB:…"
          aria-label="Filter by MAC address"
        />
        <input
          className="ep-input"
          style={{ width: 180 }}
          value={hostnameFilter}
          onChange={(e) => setHostnameFilter(e.target.value)}
          placeholder="Hostname…"
          aria-label="Filter by hostname"
        />
        <input
          className="ep-input ep-mono"
          style={{ width: 140 }}
          value={portFilter}
          onChange={(e) => setPortFilter(e.target.value)}
          placeholder="Port, e.g. 445"
          aria-label="Filter by open port"
        />
      </div>

      {inProgress && runDetail.hosts.length === 0 ? (
        <EmptyState icon={Radar} title={runDetail.status === "PENDING" ? "Scan queued" : "Scan in progress"}>
          {runDetail.status === "PENDING" ? "Waiting for the assigned agent to pick this up…" : "Scan in progress…"}
        </EmptyState>
      ) : runDetail.hosts.length === 0 ? (
        runDetail.status === "SUCCESS" ? (
          <EmptyState icon={Radar} title="No hosts responded on this range">
            Check the CIDR range and the scanner's network reach, then run the scan again.
          </EmptyState>
        ) : null
      ) : visibleHosts.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No discovered hosts match the current filters"
          action={
            <Button size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
        {inProgress && (
          <Alert tone="info">{runDetail.status === "PENDING" ? "Waiting for the assigned agent to pick this up…" : "Scan in progress…"}</Alert>
        )}
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">IP address</th>
                <th scope="col">MAC address</th>
                <th scope="col">Hostname</th>
                <th scope="col">Open ports</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Response
                </th>
                <th scope="col">Status</th>
                <th scope="col">User</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((host) => (
                <tr key={host.id}>
                  <td className="ep-mono">{host.ipAddress}</td>
                  <td className="ep-mono">{host.macAddress ?? <span className="app-muted">—</span>}</td>
                  <td>{host.hostname ?? <span className="app-muted">—</span>}</td>
                  <td className="ep-mono">{host.openPorts.join(", ") || <span className="app-muted">—</span>}</td>
                  <td className="ep-num" style={{ textAlign: "right" }}>
                    {host.responseTimeMs !== null ? `${host.responseTimeMs} ms` : <span className="app-muted">—</span>}
                  </td>
                  <td>
                    {host.matchedAgent ? (
                      <div className="app-badge-row">
                        <Pill tone="ok">Managed</Pill>
                        <span>
                          <EndpointLabel hostname={host.matchedAgent.hostname} agentId={host.matchedAgent.id} />
                        </span>
                      </div>
                    ) : (
                      <Pill tone="warn">Unmanaged</Pill>
                    )}
                  </td>
                  <td>{host.matchedAgent?.lastLoggedOnUser ?? <span className="app-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {paged.total > paged.pageSize && (
            <Pagination
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              noun="hosts"
              onPageChange={paged.setPage}
              onPageSizeChange={paged.setPageSize}
            />
          )}
        </div>
        </>
      )}
    </div>
  );
}

function ScanRunsTable({ runs }: { runs: NetworkScanRunListItem[] | undefined }) {
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const { data: runDetail } = useNetworkScanRun(selectedRunId);

  return (
    <div className="app-stack">
      {runs && runs.length === 0 ? (
        <EmptyState icon={Radar} title="No scans run yet" />
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Range</th>
                <th scope="col">Status</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Hosts scanned
                </th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Hosts found
                </th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs?.map((run) => (
                <tr
                  key={run.id}
                  className={`app-clickable ${run.id === selectedRunId ? "ep-sel" : ""}`}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <td className="ep-mono">{run.cidr}</td>
                  <td>
                    <ScanStatusPill status={run.status} />
                  </td>
                  <td className="ep-num" style={{ textAlign: "right" }}>
                    {run.hostsScanned}
                  </td>
                  <td className="ep-num" style={{ textAlign: "right" }}>
                    {run.hostsFound}
                  </td>
                  <td className="app-muted">{formatDateTime(run.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {runDetail && <DiscoveredHostsTable runDetail={runDetail} />}
    </div>
  );
}

// One entry per VLAN, always its latest scan - no run-history picker here. Older runs for
// this VLAN still exist and are queryable, but this panel deliberately shows only the most
// recent one; that's the point of it being "current unmanaged devices for this VLAN", not a
// scan log (VlanRunsPanel used to list every past run instead, which is what actually
// prompted this - one VLAN was showing 7 entries, one per historical scan).
function LatestVlanScanPanel({ vlan }: { vlan: NetworkVlanListItem }) {
  const { data: runs } = useVlanScanRuns(vlan.id);
  const latestRun = runs?.[0]; // useVlanScanRuns is server-sorted startedAt desc
  const { data: runDetail } = useNetworkScanRun(latestRun?.id);

  return (
    <Collapsible
      title={`${vlan.name} — latest scan`}
      hint={vlan.cidr}
      actions={latestRun ? <ScanStatusPill status={latestRun.status} /> : undefined}
      defaultOpen={false}
    >
      {!latestRun && (
        <EmptyState icon={Radar} title="No scans run yet for this VLAN">
          Use "Scan now" on the VLAN above to discover its hosts.
        </EmptyState>
      )}
      {latestRun && (
        <div className="app-stack">
          <p className="app-text">
            <span className="ep-num">{latestRun.hostsScanned}</span> scanned, <span className="ep-num">{latestRun.hostsFound}</span>{" "}
            found — started {formatDateTime(latestRun.startedAt)}
          </p>
          {runDetail && <DiscoveredHostsTable runDetail={runDetail} />}
        </div>
      )}
    </Collapsible>
  );
}

function VlanFormModal({
  vlan,
  onDone,
}: {
  vlan?: NetworkVlanListItem;
  onDone: () => void;
}) {
  const { data: agents } = useAgents();
  const { data: suggested } = useSuggestedCidr();
  const create = useCreateNetworkVlan();
  const update = useUpdateNetworkVlan();

  const [name, setName] = useState(vlan?.name ?? "");
  const [description, setDescription] = useState(vlan?.description ?? "");
  const [cidr, setCidr] = useState(vlan?.cidr ?? "");
  const [assignedAgentId, setAssignedAgentId] = useState(vlan?.assignedAgentId ?? "");

  const mutation = vlan ? update : create;
  const isEdit = Boolean(vlan);
  const formId = isEdit ? `vlan-form-${vlan?.id}` : "vlan-form-new";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      name,
      description: description.trim() || undefined,
      cidr: cidr.trim() || suggested?.cidr || "",
      assignedAgentId: assignedAgentId || undefined,
      enabled: vlan?.enabled ?? true,
    };
    if (isEdit && vlan) {
      update.mutate(
        { id: vlan.id, ...body, description: description.trim() || null, assignedAgentId: assignedAgentId || null },
        { onSuccess: () => onDone() },
      );
    } else {
      create.mutate(body, {
        onSuccess: () => {
          setName("");
          setDescription("");
          setCidr("");
          setAssignedAgentId("");
          onDone();
        },
      });
    }
  }

  return (
    <Modal
      title={isEdit ? `Edit VLAN "${vlan?.name}"` : "Add VLAN"}
      description="A named address range to scan for hosts, optionally scanned from an endpoint inside it."
      onClose={onDone}
      footer={
        <>
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={mutation.isPending || !name.trim()}>
            {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add VLAN"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="app-stack">
        <FormGrid>
          <Field label="Name" htmlFor={`${formId}-name`} required>
            <input
              id={`${formId}-name`}
              data-autofocus
              className="ep-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="CIDR range"
            htmlFor={`${formId}-cidr`}
            required={isEdit}
            help={!isEdit && suggested?.cidr ? `Leave blank to use ${suggested.cidr}.` : undefined}
          >
            <input
              id={`${formId}-cidr`}
              className="ep-input ep-mono"
              type="text"
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
              placeholder={suggested?.cidr ?? "e.g. 192.168.1.0/24"}
              required={isEdit}
              autoComplete="off"
            />
          </Field>
          <Field label="Description" htmlFor={`${formId}-desc`} span2>
            <input
              id={`${formId}-desc`}
              className="ep-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field
            label="Assigned agent"
            htmlFor={`${formId}-agent`}
            span2
            help="Runs the scan on this VLAN's behalf — leave blank to scan from the server itself."
          >
            <select
              id={`${formId}-agent`}
              className="ep-select"
              value={assignedAgentId}
              onChange={(e) => setAssignedAgentId(e.target.value)}
            >
              <option value="">— None (run from server) —</option>
              {agents?.map((a) => (
                <EndpointOption key={a.id} value={a.id} hostname={a.hostname} agentId={a.id} />
              ))}
            </select>
          </Field>
        </FormGrid>
        {mutation.isError && <Alert tone="critical">{(mutation.error as Error).message}</Alert>}
      </form>
    </Modal>
  );
}

function VlanRow({ vlan }: { vlan: NetworkVlanListItem }) {
  const update = useUpdateNetworkVlan();
  const del = useDeleteNetworkVlan();
  const confirm = useConfirm();
  const triggerScan = useTriggerVlanScan();
  const [editing, setEditing] = useState(false);

  function toggleEnabled(enabled: boolean) {
    update.mutate({ id: vlan.id, enabled });
  }

  async function handleDelete() {
    const confirmed = await confirm({
      title: `Delete VLAN "${vlan.name}"?`,
      body: "Past scan history is kept, just no longer grouped under a live VLAN.",
      confirmLabel: "Delete VLAN",
      tone: "danger",
    });
    if (!confirmed) return;
    del.mutate(vlan.id);
  }

  return (
    <tr>
      <td className="ep-host">
        <b>{vlan.name}</b>
        {vlan.description && <span className="app-row-sub">{vlan.description}</span>}
      </td>
      <td className="ep-mono">{vlan.cidr}</td>
      <td>
        {vlan.assignedAgentId ? (
          <EndpointLabel hostname={vlan.assignedAgentHostname} agentId={vlan.assignedAgentId} />
        ) : (
          <span className="app-muted">Server-side</span>
        )}
      </td>
      <td>
        <span title="Enabled — controls whether this VLAN is included in 'Scan all enabled VLANs'. Its own Scan now button and scan history still work either way.">
          <Switch checked={vlan.enabled} onChange={toggleEnabled} label={vlan.enabled ? "Enabled" : "Disabled"} />
        </span>
      </td>
      <td>
        {vlan.latestRun ? (
          <div className="app-badge-row">
            <ScanStatusPill status={vlan.latestRun.status} />
            <span className="ep-num">
              {vlan.latestRun.hostsFound} host{vlan.latestRun.hostsFound === 1 ? "" : "s"}
            </span>
            <span className="app-muted" title={formatDateTime(vlan.latestRun.startedAt)}>
              · {formatRelative(vlan.latestRun.startedAt)}
            </span>
          </div>
        ) : (
          <span className="app-muted">Never scanned</span>
        )}
      </td>
      <td>
        <div className="app-cell-actions">
          <Button size="sm" icon={Radar} onClick={() => triggerScan.mutate(vlan.id)} disabled={triggerScan.isPending}>
            Scan now
          </Button>
          <RowMenu
            label={`Actions for ${vlan.name}`}
            items={[
              { label: "Edit VLAN", icon: Pencil, onSelect: () => setEditing(true) },
              { label: "Delete VLAN", icon: Trash2, danger: true, dividerBefore: true, onSelect: handleDelete },
            ]}
          />
        </div>
        {editing && <VlanFormModal vlan={vlan} onDone={() => setEditing(false)} />}
      </td>
    </tr>
  );
}

export default function NetworkScanPage() {
  const { data: vlans, isLoading, error, refetch } = useNetworkVlans();
  const { data: legacyRuns } = useLegacyNetworkScanRuns();
  const scanAll = useScanAllEnabledVlans();
  const [scanAllSummary, setScanAllSummary] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  function handleScanAll() {
    scanAll.mutate(undefined, {
      onSuccess: (results) => {
        const ok = results.filter((r) => r.scanRunId).length;
        const failed = results.filter((r) => r.error);
        setScanAllSummary(
          `${ok} scan(s) started${failed.length > 0 ? `, ${failed.length} skipped (${failed.map((f) => f.error).join("; ")})` : ""}`,
        );
      },
    });
  }

  const enabledCount = vlans?.filter((v) => v.enabled).length ?? 0;
  const hostsFound = vlans?.reduce((sum, v) => sum + (v.latestRun?.hostsFound ?? 0), 0) ?? 0;
  const neverScanned = vlans?.filter((v) => !v.latestRun).length ?? 0;
  const failedLatest = vlans?.filter((v) => v.latestRun?.status === "FAILED").length ?? 0;

  const header = (
    <PageHeader
      title="Network scan"
      description="Scan VLANs for hosts and see which ones don't have the agent installed yet."
      actions={
        <>
          <Button icon={Plus} onClick={() => setShowAddForm(true)}>
            Add VLAN
          </Button>
          <Button variant="primary" icon={Radar} onClick={handleScanAll} disabled={scanAll.isPending}>
            {scanAll.isPending ? "Starting…" : "Scan all enabled VLANs"}
          </Button>
        </>
      }
    />
  );

  return (
    <>
      {header}

      {scanAllSummary && <Alert tone="info">{scanAllSummary}</Alert>}
      {scanAll.isError && <Alert tone="critical">{(scanAll.error as Error).message}</Alert>}

      {isLoading ? (
        <Card>
          <Skeleton lines={6} />
        </Card>
      ) : error && !vlans ? (
        <Alert tone="critical" title="Couldn't load VLANs" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
          {(error as Error).message}
        </Alert>
      ) : (
        <>
          {vlans && vlans.length > 0 && (
            <KpiStrip>
              <Kpi icon={Network} label="VLANs" value={vlans.length} suffix={`${enabledCount} enabled`} />
              <Kpi icon={Server} label="Hosts found" value={hostsFound} suffix="in latest scans" />
              <Kpi
                icon={Radar}
                label="Never scanned"
                value={neverScanned}
                valueTone={neverScanned > 0 ? "warning" : undefined}
                suffix={`of ${vlans.length}`}
              />
              <Kpi
                icon={TriangleAlert}
                label="Latest scan failed"
                value={failedLatest}
                valueTone={failedLatest > 0 ? "critical" : undefined}
                suffix={`of ${vlans.length}`}
              />
            </KpiStrip>
          )}

          <Card flush title="VLANs" hint={vlans ? `${vlans.length} total` : undefined}>
            {!vlans || vlans.length === 0 ? (
              <EmptyState
                icon={Network}
                title="No VLANs defined yet"
                action={
                  <Button size="sm" icon={Plus} onClick={() => setShowAddForm(true)}>
                    Add VLAN
                  </Button>
                }
              >
                Add a VLAN to start scanning.
              </EmptyState>
            ) : (
              <div className="app-table-scroll">
                <table className="ep-tbl">
                  <thead>
                    <tr>
                      <th scope="col">VLAN</th>
                      <th scope="col">CIDR</th>
                      <th scope="col">Assigned agent</th>
                      <th scope="col">Enabled</th>
                      <th scope="col">Latest scan</th>
                      <th scope="col">
                        <span className="app-vh">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vlans.map((vlan) => (
                      <VlanRow key={vlan.id} vlan={vlan} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {vlans?.map((vlan) => (
            <LatestVlanScanPanel key={vlan.id} vlan={vlan} />
          ))}
        </>
      )}

      {legacyRuns && legacyRuns.length > 0 && (
        <Collapsible title="No VLAN — manual scans" hint={`${legacyRuns.length} runs`} defaultOpen={false}>
          <ScanRunsTable runs={legacyRuns} />
        </Collapsible>
      )}

      {showAddForm && <VlanFormModal onDone={() => setShowAddForm(false)} />}
    </>
  );
}
