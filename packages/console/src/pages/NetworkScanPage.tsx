import { useState, type FormEvent } from "react";
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

function statusBadgeClass(status: string): string {
  if (status === "SUCCESS") return "online";
  if (status === "FAILED") return "danger";
  return "warn"; // PENDING or RUNNING
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

  return (
    <div className="panel">
      <h3>Discovered hosts — {runDetail.cidr}</h3>
      {runDetail.status === "FAILED" && runDetail.errorMessage && <p className="error-text">{runDetail.errorMessage}</p>}
      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
        <input type="checkbox" checked={computersOnly} onChange={(e) => setComputersOnly(e.target.checked)} />
        <span className="mono-cell">
          ({computerCount}/{totalCount})
        </span>
        Laptops/desktops/servers only (hides phones, tablets, and other non-PC devices)
      </label>
      {computersOnly && hiddenCount > 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85em" }}>
          {hiddenCount} device{hiddenCount === 1 ? "" : "s"} hidden — heuristic based on open ports (no Windows/SSH
          management ports responded), not a guaranteed device type.
        </p>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "0.75rem" }}>
        <label style={{ display: "inline-block" }}>
          Status
          <select value={managedFilter} onChange={(e) => setManagedFilter(e.target.value as ManagedFilter)}>
            <option value="all">All</option>
            <option value="managed">Managed</option>
            <option value="unmanaged">Unmanaged</option>
          </select>
        </label>
        <label style={{ display: "inline-block" }}>
          IP address
          <input type="text" value={ipFilter} onChange={(e) => setIpFilter(e.target.value)} placeholder="192.168.1…" />
        </label>
        <label style={{ display: "inline-block" }}>
          MAC address
          <input type="text" value={macFilter} onChange={(e) => setMacFilter(e.target.value)} placeholder="AA:BB:…" />
        </label>
        <label style={{ display: "inline-block" }}>
          Hostname
          <input type="text" value={hostnameFilter} onChange={(e) => setHostnameFilter(e.target.value)} placeholder="Hostname…" />
        </label>
        <label style={{ display: "inline-block" }}>
          Open ports
          <input type="text" value={portFilter} onChange={(e) => setPortFilter(e.target.value)} placeholder="e.g. 445" />
        </label>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>IP address</th>
            <th>MAC address</th>
            <th>Hostname</th>
            <th>Open ports</th>
            <th>Response</th>
            <th>Status</th>
            <th>User</th>
          </tr>
        </thead>
        <tbody>
          {visibleHosts.map((host) => (
            <tr key={host.id}>
              <td className="mono-cell">{host.ipAddress}</td>
              <td className="mono-cell">{host.macAddress ?? "—"}</td>
              <td>{host.hostname ?? "—"}</td>
              <td>{host.openPorts.join(", ") || "—"}</td>
              <td>{host.responseTimeMs !== null ? `${host.responseTimeMs} ms` : "—"}</td>
              <td>
                {host.matchedAgent ? (
                  <span className="status-badge online">
                    Managed (<EndpointLabel hostname={host.matchedAgent.hostname} agentId={host.matchedAgent.id} />)
                  </span>
                ) : (
                  <span className="status-badge offline">Unmanaged</span>
                )}
              </td>
              <td>{host.matchedAgent?.lastLoggedOnUser ?? "—"}</td>
            </tr>
          ))}
          {visibleHosts.length === 0 && runDetail.hosts.length > 0 && (
            <tr>
              <td colSpan={7}>No discovered hosts match the current filters.</td>
            </tr>
          )}
          {runDetail.hosts.length === 0 && runDetail.status === "SUCCESS" && (
            <tr>
              <td colSpan={7}>No hosts responded on this range.</td>
            </tr>
          )}
          {(runDetail.status === "PENDING" || runDetail.status === "RUNNING") && (
            <tr>
              <td colSpan={7}>{runDetail.status === "PENDING" ? "Waiting for the assigned agent to pick this up…" : "Scan in progress…"}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ScanRunsTable({ runs }: { runs: NetworkScanRunListItem[] | undefined }) {
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const { data: runDetail } = useNetworkScanRun(selectedRunId);

  return (
    <>
      <table className="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Hosts scanned</th>
            <th>Hosts found</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs?.map((run) => (
            <tr key={run.id} className="clickable-row" onClick={() => setSelectedRunId(run.id)}>
              <td>
                <span className={`status-badge ${statusBadgeClass(run.status)}`}>{run.status}</span>
              </td>
              <td>{run.hostsScanned}</td>
              <td>{run.hostsFound}</td>
              <td>{new Date(run.startedAt).toLocaleString()}</td>
            </tr>
          ))}
          {runs?.length === 0 && (
            <tr>
              <td colSpan={4}>No scans run yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {runDetail && <DiscoveredHostsTable runDetail={runDetail} />}
    </>
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
    <Collapsible title={`${vlan.name} — latest scan`} defaultOpen={false}>
      {!latestRun && <p>No scans run yet for this VLAN.</p>}
      {latestRun && (
        <>
          <p>
            <span className={`status-badge ${statusBadgeClass(latestRun.status)}`}>{latestRun.status}</span>{" "}
            {latestRun.hostsScanned} scanned, {latestRun.hostsFound} found — started{" "}
            {new Date(latestRun.startedAt).toLocaleString()}
          </p>
          {runDetail && <DiscoveredHostsTable runDetail={runDetail} />}
        </>
      )}
    </Collapsible>
  );
}

function VlanForm({
  vlan,
  onDone,
}: {
  vlan?: NetworkVlanListItem;
  onDone?: () => void;
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
        { onSuccess: () => onDone?.() },
      );
    } else {
      create.mutate(body, {
        onSuccess: () => {
          setName("");
          setDescription("");
          setCidr("");
          setAssignedAgentId("");
          onDone?.();
        },
      });
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Description
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        CIDR range
        <input
          type="text"
          value={cidr}
          onChange={(e) => setCidr(e.target.value)}
          placeholder={suggested?.cidr ?? "e.g. 192.168.1.0/24"}
          required={isEdit}
          autoComplete="off"
        />
      </label>
      <label>
        Assigned agent (runs the scan on this VLAN's behalf — leave blank to scan from the server itself)
        <select value={assignedAgentId} onChange={(e) => setAssignedAgentId(e.target.value)}>
          <option value="">— None (run from server) —</option>
          {agents?.map((a) => (
            <EndpointOption key={a.id} value={a.id} hostname={a.hostname} agentId={a.id} />
          ))}
        </select>
      </label>
      {mutation.isError && <p className="error-text">{(mutation.error as Error).message}</p>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" disabled={mutation.isPending || !name.trim()}>
          {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add VLAN"}
        </button>
        {isEdit && (
          <button type="button" onClick={() => onDone?.()}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function VlanRow({ vlan }: { vlan: NetworkVlanListItem }) {
  const update = useUpdateNetworkVlan();
  const del = useDeleteNetworkVlan();
  const triggerScan = useTriggerVlanScan();
  const [editing, setEditing] = useState(false);

  function toggleEnabled(enabled: boolean) {
    update.mutate({ id: vlan.id, enabled });
  }

  function handleDelete() {
    if (!window.confirm(`Delete VLAN "${vlan.name}"? Past scan history is kept, just no longer grouped under a live VLAN.`)) return;
    del.mutate(vlan.id);
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={7}>
          <VlanForm vlan={vlan} onDone={() => setEditing(false)} />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{vlan.name}</td>
      <td>{vlan.description ?? "—"}</td>
      <td className="mono-cell">{vlan.cidr}</td>
      <td>{vlan.assignedAgentId ? vlan.assignedAgentHostname : "Server-side"}</td>
      <td>
        <input
          type="checkbox"
          checked={vlan.enabled}
          onChange={(e) => toggleEnabled(e.target.checked)}
          title="Enabled — controls whether this VLAN is included in 'Scan All Enabled VLANs'. Its own Scan Now button and scan history still work either way."
        />
      </td>
      <td>
        {vlan.latestRun ? (
          <span className={`status-badge ${statusBadgeClass(vlan.latestRun.status)}`}>
            {vlan.latestRun.status} — {vlan.latestRun.hostsFound} host{vlan.latestRun.hostsFound === 1 ? "" : "s"}
          </span>
        ) : (
          "Never scanned"
        )}
      </td>
      <td style={{ display: "flex", gap: "0.4rem" }}>
        <button type="button" onClick={() => triggerScan.mutate(vlan.id)} disabled={triggerScan.isPending}>
          Scan now
        </button>
        <button type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" onClick={handleDelete}>
          Delete
        </button>
      </td>
    </tr>
  );
}

export default function NetworkScanPage() {
  const { data: vlans } = useNetworkVlans();
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

  return (
    <div>
      <h1>Network Scan</h1>

      <div className="panel" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <button type="button" onClick={handleScanAll} disabled={scanAll.isPending}>
          {scanAll.isPending ? "Starting…" : "Scan all enabled VLANs"}
        </button>
        <button type="button" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "Add VLAN"}
        </button>
        {scanAllSummary && <span>{scanAllSummary}</span>}
      </div>

      {showAddForm && <VlanForm onDone={() => setShowAddForm(false)} />}

      <h2>VLANs</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>CIDR</th>
            <th>Assigned agent</th>
            <th>Enabled</th>
            <th>Latest scan</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {vlans?.map((vlan) => (
            <VlanRow key={vlan.id} vlan={vlan} />
          ))}
          {vlans?.length === 0 && (
            <tr>
              <td colSpan={7}>No VLANs defined yet — add one above to start scanning.</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Results by VLAN</h2>
      {vlans?.map((vlan) => (
        <LatestVlanScanPanel key={vlan.id} vlan={vlan} />
      ))}

      {legacyRuns && legacyRuns.length > 0 && (
        <Collapsible title="(No VLAN — manual scans)" defaultOpen={false}>
          <ScanRunsTable runs={legacyRuns} />
        </Collapsible>
      )}
    </div>
  );
}
