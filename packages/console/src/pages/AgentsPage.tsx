import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useAgents,
  useAssetGroups,
  useIsItemHidden,
  useNetworkDeviceSummary,
  useQuarantineAgent,
  useReleaseAgent,
} from "../api/hooks";
import type { AgentListItem, DeviceType } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import Collapsible from "../components/Collapsible";
import InstallAgentAction from "../components/InstallAgentAction";
import { EndpointStatusDot } from "../components/EndpointLabel";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Quote every cell and double up any internal quotes - the only escaping CSV actually
// needs, and safe even for fields without commas/quotes (Excel doesn't care either way).
function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

// Columns belonging to a hidden nav item (Module Visibility) are dropped from the export too,
// not just from the on-screen table.
function buildAgentsCsv(
  agents: AgentListItem[],
  hidden: { vulnerabilitiesHidden: boolean; zeroTrustHidden: boolean; patchesHidden: boolean },
): string {
  const { vulnerabilitiesHidden: hideVulnerabilities, zeroTrustHidden: hideZeroTrust, patchesHidden: hidePatches } =
    hidden;
  const headers = [
    "Hostname", "Device Type", "Last Logged On User", "Status", "Last Check-in",
    "IP Address", "MAC Address", "Location", "OS Platform", "OS Version", "OS Architecture",
    "OS Edition", "OS License Status", "OS End of Support", "OS EOL", "Processor",
    "Physical Cores", "Logical Cores", "Memory (GB)", "Storage (GB)", "Disk Types",
    "Serial Number", "Vendor", "Purchase Date", "Warranty Expiry", "Warranty Status",
    "Lifecycle Status", "Groups",
    ...(hideZeroTrust ? [] : ["Zero Trust Non-Compliant"]),
    ...(hideVulnerabilities ? [] : ["Open Vulnerabilities"]),
    ...(hidePatches ? [] : ["Last Patch Installed"]),
    "Quarantined", "Agent Version", "Enrolled At",
  ];

  const rows = agents.map((agent) => {
    const inv = agent.inventory;
    const isWarrantyExpired = agent.warrantyExpiryDate ? new Date(agent.warrantyExpiryDate) < new Date() : false;
    return [
      agent.hostname,
      DEVICE_TYPE_LABEL[agent.deviceType],
      inv?.lastLoggedOnUser ?? "",
      agent.status,
      agent.lastCheckinAt ? new Date(agent.lastCheckinAt).toLocaleString() : "never",
      agent.ipAddress ?? "",
      agent.macAddress ?? "",
      agent.location ?? (agent.ipGeoHint ? [agent.ipGeoHint.city, agent.ipGeoHint.country].filter(Boolean).join(", ") : ""),
      agent.osPlatform,
      agent.osVersion,
      agent.osArch,
      agent.osEditionLabel ?? "",
      inv?.osLicenseStatus ?? "",
      agent.osEol ? new Date(agent.osEol.eolDate).toLocaleDateString() : "",
      agent.osEol ? (agent.osEol.isEol ? "EOL" : "Supported") : "",
      inv?.cpuModel ?? "",
      inv?.cpuPhysicalCores ?? "",
      inv?.cpuCores ?? "",
      inv?.totalMemBytes ? (Number(inv.totalMemBytes) / 1024 ** 3).toFixed(1) : "",
      inv?.totalDiskBytes ? (Number(inv.totalDiskBytes) / 1024 ** 3).toFixed(1) : "",
      inv?.diskTypes.join(" + ") ?? "",
      agent.serialNumber ?? "",
      agent.vendor ?? "",
      agent.purchaseDate ? new Date(agent.purchaseDate).toLocaleDateString() : "",
      agent.warrantyExpiryDate ? new Date(agent.warrantyExpiryDate).toLocaleDateString() : "",
      agent.warrantyExpiryDate ? (isWarrantyExpired ? "Expired" : "Active") : "",
      agent.lifecycleStatus,
      agent.groups.map((g) => g.name).join(" | "),
      ...(hideZeroTrust ? [] : [agent.zeroTrustNonCompliantCount]),
      ...(hideVulnerabilities ? [] : [agent.openVulnerabilityCount]),
      ...(hidePatches ? [] : [agent.lastPatchInstalledAt ? new Date(agent.lastPatchInstalledAt).toLocaleString() : "never"]),
      agent.quarantined ? "Yes" : "No",
      agent.agentVersion,
      new Date(agent.createdAt).toLocaleString(),
    ];
  });

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  LAPTOP: "Laptop",
  DESKTOP: "Desktop",
  SERVER: "Server",
};

type StatusFilter = "all" | "ONLINE" | "OFFLINE";

// Same heuristic as NetworkScanPage's DiscoveredHostsTable: the scanner has no real
// OS/device fingerprinting, but phones and tablets never expose Windows management ports
// or SSH the way a PC/server does - used here as an opt-in filter, not a certainty. No
// matchedAgent check needed (unlike NetworkScanPage's version) since every host reaching
// this panel is, by definition, already unmanaged.
const COMPUTER_SIGNATURE_PORTS = [22, 135, 139, 445, 3389];

function looksLikeComputer(openPorts: number[]): boolean {
  return openPorts.some((p) => COMPUTER_SIGNATURE_PORTS.includes(p));
}

// DOM id the "Network devices (unmanaged)" panel is rendered with, and the id the
// Unmanaged tile above the endpoints table targets — see NETWORK_DEVICES_PANEL_ID usage
// below and Collapsible's `id` prop.
const NETWORK_DEVICES_PANEL_ID = "network-devices-unmanaged-panel";

// The panel lives lower on this same page (in a collapsed-by-default <details>), so
// "opening" it from the Unmanaged tile just means forcing it open and scrolling to it —
// no route change needed, unlike a normal tile-click filter.
function scrollToUnmanagedNetworkDevices() {
  const el = document.getElementById(NETWORK_DEVICES_PANEL_ID);
  if (el instanceof HTMLDetailsElement) {
    el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function NetworkDevicesPanel() {
  const { data: summary } = useNetworkDeviceSummary();
  const [search, setSearch] = useState("");
  const [computersOnly, setComputersOnly] = useState(true);

  const term = search.trim().toLowerCase();
  const filteredHosts = summary?.unmanagedHosts
    .filter((h) => !computersOnly || looksLikeComputer(h.openPorts))
    .filter(
      (h) =>
        !term ||
        h.vlanName.toLowerCase().includes(term) ||
        h.ipAddress.toLowerCase().includes(term) ||
        (h.macAddress ?? "").toLowerCase().includes(term) ||
        (h.hostname ?? "").toLowerCase().includes(term),
    );
  const totalCount = summary?.unmanagedHosts.length ?? 0;
  const computerCount = summary?.unmanagedHosts.filter((h) => looksLikeComputer(h.openPorts)).length ?? 0;
  const hiddenByTypeCount = computersOnly ? totalCount - computerCount : 0;

  return (
    <Collapsible id={NETWORK_DEVICES_PANEL_ID} title="Network devices (unmanaged)" defaultOpen={false}>
      <p>
        Devices seen on a scanned VLAN with no agent installed — routers, switches, printers, and similar
        infrastructure. From each VLAN's most recent Network Scan.
      </p>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by hostname, IP, MAC, or VLAN…"
        style={{ marginBottom: "0.6rem", width: "100%", maxWidth: "24rem" }}
      />
      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
        <input type="checkbox" checked={computersOnly} onChange={(e) => setComputersOnly(e.target.checked)} />
        <span className="mono-cell">
          ({computerCount}/{totalCount})
        </span>
        Laptops/desktops/servers only (hides phones, tablets, routers, switches, printers, and other non-PC devices)
      </label>
      {computersOnly && hiddenByTypeCount > 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85em" }}>
          {hiddenByTypeCount} device{hiddenByTypeCount === 1 ? "" : "s"} hidden — heuristic based on open ports (no
          Windows/SSH management ports responded), not a guaranteed device type.
        </p>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>VLAN</th>
            <th>IP address</th>
            <th>MAC address</th>
            <th>Hostname</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredHosts?.map((h) => (
            <tr key={`${h.vlanName}-${h.ipAddress}`}>
              <td>{h.vlanName}</td>
              <td className="mono-cell">{h.ipAddress}</td>
              <td className="mono-cell">{h.macAddress ?? "—"}</td>
              <td>{h.hostname ?? "—"}</td>
              <td>
                <InstallAgentAction hostname={h.hostname} ipAddress={h.ipAddress} />
              </td>
            </tr>
          ))}
          {summary?.unmanagedHosts.length === 0 && (
            <tr>
              <td colSpan={5}>No unmanaged devices found — scan a VLAN on the Network Scan page.</td>
            </tr>
          )}
          {summary && summary.unmanagedHosts.length > 0 && filteredHosts?.length === 0 && (
            <tr>
              <td colSpan={5}>{term ? `No devices match "${search}".` : "All unmanaged devices were filtered out by the computers-only filter."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </Collapsible>
  );
}

export default function AgentsPage() {
  const { data: agents, isLoading, error } = useAgents();
  const { data: groups } = useAssetGroups();
  // Shares the query-cache entry with NetworkDevicesPanel's own call below — only one
  // network request either way, just needed here too for the Unmanaged tile's count.
  const { data: networkDeviceSummary } = useNetworkDeviceSummary();
  const vulnerabilitiesHidden = useIsItemHidden("/vulnerabilities");
  const zeroTrustHidden = useIsItemHidden("/zero-trust");
  const patchesHidden = useIsItemHidden("/patches");
  // Initial filters can come from the URL, so Dashboard charts/tiles can deep-link here
  // pre-filtered (e.g. /endpoints?status=OFFLINE, ?deviceType=LAPTOP, ?os=..., ?vuln=open).
  const [searchParams, setSearchParams] = useSearchParams();
  const [groupFilter, setGroupFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const s = searchParams.get("status");
    return s === "ONLINE" || s === "OFFLINE" ? s : "all";
  });
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<DeviceType | "">(() => {
    const t = searchParams.get("deviceType");
    return t === "LAPTOP" || t === "DESKTOP" || t === "SERVER" ? t : "";
  });
  // No dropdowns for these two — they're only ever set by a Dashboard link, and shown as a
  // removable chip below so it's obvious why the list is narrowed.
  const [osFilter, setOsFilter] = useState(() => searchParams.get("os") ?? "");
  const [vulnFilter, setVulnFilter] = useState<"" | "open" | "none">(() => {
    const v = searchParams.get("vuln");
    return v === "open" || v === "none" ? v : "";
  });
  const [hostnameFilter, setHostnameFilter] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const quarantine = useQuarantineAgent();
  const release = useReleaseAgent();
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);

  if (isLoading) return <p>Loading endpoints…</p>;
  if (error) return <p className="error-text">{(error as Error).message}</p>;

  function handleQuarantineToggle(agent: AgentListItem) {
    if (agent.quarantined) {
      const confirmed = window.confirm(
        `Release ${agent.hostname} from quarantine?\n\nThis restores normal outbound network access on the endpoint.`,
      );
      if (!confirmed) return;
      setPendingAgentId(agent.id);
      release.mutate(agent.id, { onSettled: () => setPendingAgentId(null) });
    } else {
      const confirmed = window.confirm(
        `Quarantine ${agent.hostname}?\n\nThis locks the endpoint's firewall down to DNS and this server only — ` +
          `all other network access is blocked until you release it. The endpoint must be online to pick up the command.`,
      );
      if (!confirmed) return;
      setPendingAgentId(agent.id);
      quarantine.mutate(agent.id, { onSettled: () => setPendingAgentId(null) });
    }
  }

  const totalCount = agents?.length ?? 0;
  const onlineCount = agents?.filter((a) => a.status === "ONLINE").length ?? 0;
  const offlineCount = agents?.filter((a) => a.status === "OFFLINE").length ?? 0;
  const unmanagedCount = networkDeviceSummary?.unmanagedHosts.length ?? 0;

  const filteredAgents = agents
    ?.filter((agent) => !groupFilter || agent.groups.some((g) => g.id === groupFilter))
    .filter((agent) => statusFilter === "all" || agent.status === statusFilter)
    .filter((agent) => !deviceTypeFilter || agent.deviceType === deviceTypeFilter)
    // Same "Unknown" fallback the Dashboard's OS chart uses (dashboard.service.ts).
    .filter((agent) => !osFilter || (agent.osEditionLabel || "Unknown") === osFilter)
    .filter(
      (agent) =>
        !vulnFilter || (vulnFilter === "open" ? agent.openVulnerabilityCount > 0 : agent.openVulnerabilityCount === 0),
    )
    .filter((agent) => !hostnameFilter.trim() || agent.hostname.toLowerCase().includes(hostnameFilter.trim().toLowerCase()))
    .filter((agent) => !ipFilter.trim() || (agent.ipAddress ?? "").toLowerCase().includes(ipFilter.trim().toLowerCase()))
    .filter(
      (agent) =>
        !userFilter.trim() || (agent.inventory?.lastLoggedOnUser ?? "").toLowerCase().includes(userFilter.trim().toLowerCase()),
    );

  return (
    <div>
      <h1>Endpoints</h1>

      <div className="tiles">
        <div className={`tile ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>
          <div className="tile-label">Total endpoints</div>
          <div className="tile-value">{totalCount}</div>
        </div>
        <div
          className={`tile accent-good ${statusFilter === "ONLINE" ? "active" : ""}`}
          onClick={() => setStatusFilter("ONLINE")}
        >
          <div className="tile-label">Online</div>
          <div className="tile-value">{onlineCount}</div>
        </div>
        <div
          className={`tile accent-critical ${statusFilter === "OFFLINE" ? "active" : ""}`}
          onClick={() => setStatusFilter("OFFLINE")}
        >
          <div className="tile-label">Offline</div>
          <div className="tile-value">{offlineCount}</div>
        </div>
        <div
          className="tile accent-warn"
          onClick={scrollToUnmanagedNetworkDevices}
          title="Devices seen on a scanned VLAN with no agent installed — jumps to the Network devices (unmanaged) panel below"
        >
          <div className="tile-label">Unmanaged</div>
          <div className="tile-value">{unmanagedCount}</div>
        </div>
      </div>

      {(osFilter || vulnFilter) && (
        <p>
          {osFilter && (
            <span className="filter-chip">
              Operating system: {osFilter}{" "}
              <button
                type="button"
                aria-label="Clear operating system filter"
                onClick={() => {
                  setOsFilter("");
                  searchParams.delete("os");
                  setSearchParams(searchParams, { replace: true });
                }}
              >
                ×
              </button>
            </span>
          )}
          {vulnFilter && (
            <span className="filter-chip">
              {vulnFilter === "open" ? "Has open vulnerabilities" : "No open vulnerabilities"}{" "}
              <button
                type="button"
                aria-label="Clear vulnerability filter"
                onClick={() => {
                  setVulnFilter("");
                  searchParams.delete("vuln");
                  setSearchParams(searchParams, { replace: true });
                }}
              >
                ×
              </button>
            </span>
          )}
        </p>
      )}

      {groups && groups.length > 0 && (
        <label style={{ display: "inline-block", marginBottom: "1rem", marginRight: "1rem" }}>
          Filter by group
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label style={{ display: "inline-block", marginBottom: "1rem", marginRight: "1rem" }}>
        Filter by device type
        <select value={deviceTypeFilter} onChange={(e) => setDeviceTypeFilter(e.target.value as DeviceType | "")}>
          <option value="">All types</option>
          <option value="LAPTOP">Laptop</option>
          <option value="DESKTOP">Desktop</option>
          <option value="SERVER">Server</option>
        </select>
      </label>

      <label style={{ display: "inline-block", marginBottom: "1rem", marginRight: "1rem" }}>
        Filter by hostname
        <input
          type="text"
          value={hostnameFilter}
          onChange={(e) => setHostnameFilter(e.target.value)}
          placeholder="Hostname…"
        />
      </label>

      <label style={{ display: "inline-block", marginBottom: "1rem", marginRight: "1rem" }}>
        Filter by IP
        <input
          type="text"
          value={ipFilter}
          onChange={(e) => setIpFilter(e.target.value)}
          placeholder="IP address…"
        />
      </label>

      <label style={{ display: "inline-block", marginBottom: "1rem", marginRight: "1rem" }}>
        Filter by user
        <input
          type="text"
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          placeholder="Logged-on user…"
        />
      </label>

      <button
        type="button"
        onClick={() => downloadTextFile("endpoints.csv", buildAgentsCsv(filteredAgents ?? [], { vulnerabilitiesHidden, zeroTrustHidden, patchesHidden }))}
        disabled={!filteredAgents || filteredAgents.length === 0}
        style={{ verticalAlign: "top" }}
      >
        Export to CSV
      </button>

      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Host name</th>
              <th>Device type</th>
              <th>User</th>
              <th>Status</th>
              <th>Last check-in</th>
              <th>IP</th>
              <th>Location</th>
              <th>OS</th>
              <th>OS license</th>
              <th>OS end of support</th>
              <th>Processor</th>
              <th>Memory</th>
              <th>Storage</th>
              <th>Warranty expiry</th>
              {!patchesHidden && <th>Last patch installed</th>}
              <th>Groups</th>
            </tr>
          </thead>
          <tbody>
            {filteredAgents?.map((agent) => {
              const inv = agent.inventory;
              const isWarrantyExpired = agent.warrantyExpiryDate
                ? new Date(agent.warrantyExpiryDate) < new Date()
                : false;

              return (
                <>
                <tr key={agent.id}>
                  <td>
                    <EndpointStatusDot agentId={agent.id} />
                    <Link to={`/endpoints/${agent.id}`}>{agent.hostname}</Link>
                  </td>
                  <td>{DEVICE_TYPE_LABEL[agent.deviceType]}</td>
                  <td>{inv?.lastLoggedOnUser ?? "—"}</td>
                  <td>
                    <StatusBadge kind={agent.status === "ONLINE" ? "pass" : "fail"} label={agent.status} />
                  </td>
                  <td>{agent.lastCheckinAt ? new Date(agent.lastCheckinAt).toLocaleString() : "never"}</td>
                  <td>{agent.ipAddress ?? "—"}</td>
                  <td>
                    {agent.location ??
                      (agent.ipGeoHint
                        ? `${[agent.ipGeoHint.city, agent.ipGeoHint.country].filter(Boolean).join(", ")} (via IP)`
                        : "—")}
                  </td>
                  <td>
                    {agent.osPlatform} {agent.osVersion} ({agent.osArch})
                  </td>
                  <td>
                    {inv?.osLicenseStatus ?? "—"}
                    {inv?.osLicenseChannel ? ` (${inv.osLicenseChannel})` : ""}
                  </td>
                  <td>
                    {agent.osEol ? (
                      <>
                        {agent.osEol.versionName} — {new Date(agent.osEol.eolDate).toLocaleDateString()}{" "}
                        <span className={`status-badge ${agent.osEol.isEol ? "danger" : "online"}`}>
                          {agent.osEol.isEol ? "EOL" : "Supported"}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {inv?.cpuModel ?? "—"}
                    {inv?.cpuSpeedGhz ? ` @ ${inv.cpuSpeedGhz} GHz` : ""}
                    {inv ? ` — ${inv.cpuPhysicalCores ?? "?"}/${inv.cpuCores ?? "?"} cores` : ""}
                  </td>
                  <td>
                    {formatBytes(inv?.totalMemBytes ? Number(inv.totalMemBytes) : null)}
                    {inv && inv.memLayout.length > 0
                      ? ` (${inv.memLayout
                          .map((m) => `${formatBytes(m.sizeBytes ? Number(m.sizeBytes) : null)} ${m.type ?? ""}`.trim())
                          .join(" + ")})`
                      : ""}
                  </td>
                  <td>
                    {inv?.totalDiskBytes
                      ? `${formatBytes(Number(inv.totalDiskBytes))}${inv.diskTypes.length > 0 ? ` (${inv.diskTypes.join(" + ")})` : ""}`
                      : "—"}
                  </td>
                  <td>
                    {agent.warrantyExpiryDate ? (
                      <>
                        {new Date(agent.warrantyExpiryDate).toLocaleDateString()}
                        {isWarrantyExpired && <span className="status-badge danger"> Expired</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  {!patchesHidden && (
                    <td>
                      {agent.lastPatchInstalledAt ? new Date(agent.lastPatchInstalledAt).toLocaleDateString() : "—"}
                    </td>
                  )}
                  <td>{agent.groups.map((g) => g.name).join(", ") || "—"}</td>
                </tr>
                <tr key={`${agent.id}-summary`} className="agent-summary-row">
                  <td colSpan={16}>
                    <div className="agent-summary-row-content">
                      {!zeroTrustHidden && (
                        <StatusBadge
                          kind={agent.zeroTrustNonCompliantCount > 0 ? "fail" : "pass"}
                          label={`Zero Trust: ${agent.zeroTrustNonCompliantCount} non-compliant`}
                        />
                      )}
                      {!vulnerabilitiesHidden && (
                        <StatusBadge
                          kind={agent.openVulnerabilityCount > 0 ? "warn" : "pass"}
                          label={`${agent.openVulnerabilityCount} vulnerabilit${agent.openVulnerabilityCount === 1 ? "y" : "ies"}`}
                        />
                      )}
                      {agent.quarantined && <StatusBadge kind="lock" label="Quarantined" />}
                      {agent.paused && <StatusBadge kind="warn" label="Paused" />}
                      <button
                        type="button"
                        className="quarantine-toggle-btn"
                        onClick={() => handleQuarantineToggle(agent)}
                        disabled={pendingAgentId === agent.id}
                      >
                        {pendingAgentId === agent.id
                          ? "Working…"
                          : agent.quarantined
                            ? "Release from quarantine"
                            : "Quarantine"}
                      </button>
                    </div>
                  </td>
                </tr>
                </>
              );
            })}
            {filteredAgents?.length === 0 && (
              <tr>
                <td colSpan={16}>No endpoints match this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <NetworkDevicesPanel />
    </div>
  );
}
