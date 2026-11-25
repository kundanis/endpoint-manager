import ConsentBadge from "../components/ConsentBadge";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Download, KeyRound, Lock, LockOpen, Monitor, Network, Radar, SearchX, Wifi, WifiOff } from "lucide-react";
import {
  useAgents,
  useAssetGroups,
  useIsItemHidden,
  useBulkQuarantine,
  useBulkRelease,
  useNetworkDeviceSummary,
  useQuarantineAgent,
  useReleaseAgent,
} from "../api/hooks";
import type { AgentListItem, DeviceType } from "../api/types";
import { CHART_SEMANTIC } from "../chartTheme";
import Collapsible from "../components/Collapsible";
import InstallAgentAction from "../components/InstallAgentAction";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  ColumnPicker,
  EmptyState,
  FilterChips,
  Kpi,
  KpiStrip,
  PageHeader,
  Pagination,
  Pill,
  SearchInput,
  Segmented,
  Skeleton,
  Tag,
  Toolbar,
  useConfirm,
  useToast,
  usePagedList,
} from "../components/ui";
import { formatBytes, formatDate, formatDateTime, formatRelative } from "../format";
import { downloadCsv } from "../csv";
import { groupsBelow } from "../groupTree";
import { useFeatureLicensed } from "../licenseFeatures";

// Pattern B — list page (design-system/docs/PAGE_PATTERNS.md, reference/endpoints-list.html).

// Columns belonging to a hidden nav item (Module Visibility) are dropped from the export too,
// not just from the on-screen table. Written with the shared downloadCsv (../csv), which also
// neutralises cells that start like a spreadsheet formula - hostnames, user names and the
// like come from endpoints, so they aren't trusted.
function buildAgentsCsv(
  agents: AgentListItem[],
  hidden: { vulnerabilitiesHidden: boolean; zeroTrustHidden: boolean; patchesHidden: boolean },
): { headers: string[]; rows: (string | number)[][] } {
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

  return { headers, rows };
}

const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  LAPTOP: "Laptop",
  DESKTOP: "Desktop",
  SERVER: "Server",
};

type StatusFilter = "all" | "ONLINE" | "OFFLINE" | "QUARANTINED";

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
// Unmanaged tile above the endpoints table targets — see Collapsible's `id` prop.
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

// Optional table columns (the endpoint identity and actions columns are always shown).
// The default set keeps the table scannable; the rest are one click away in "Columns".
type ColumnKey =
  | "user"
  | "status"
  | "os"
  | "posture"
  | "lastCheckin"
  | "groups"
  | "deviceType"
  | "location"
  | "osLicense"
  | "osEol"
  | "processor"
  | "memory"
  | "storage"
  | "warranty"
  | "lastPatch";

const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "user", label: "User" },
  { key: "status", label: "Status" },
  { key: "os", label: "Operating system" },
  { key: "posture", label: "Security posture" },
  { key: "lastCheckin", label: "Last check-in" },
  { key: "groups", label: "Groups" },
  { key: "deviceType", label: "Device type" },
  { key: "location", label: "Location" },
  { key: "osLicense", label: "OS license" },
  { key: "osEol", label: "OS end of support" },
  { key: "processor", label: "Processor" },
  { key: "memory", label: "Memory" },
  { key: "storage", label: "Storage" },
  { key: "warranty", label: "Warranty expiry" },
  { key: "lastPatch", label: "Last patch installed" },
];

const DEFAULT_COLUMNS: ColumnKey[] = ["user", "status", "os", "posture", "lastCheckin", "groups"];
const COLUMNS_STORAGE_KEY = "endpoints.visibleColumns";

// A per-viewer convenience only, so storage failures (private mode, blocked site data)
// silently fall back to the default set.
function loadColumns(): ColumnKey[] {
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((k): k is ColumnKey => ALL_COLUMNS.some((c) => c.key === k));
  } catch {
    // fall through
  }
  return DEFAULT_COLUMNS;
}

function saveColumns(columns: ColumnKey[]) {
  try {
    window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // ignore
  }
}

function cellFor(key: ColumnKey, agent: AgentListItem, hidden: { vulnerabilitiesHidden: boolean; zeroTrustHidden: boolean }): ReactNode {
  const inv = agent.inventory;
  switch (key) {
    case "user":
      return inv?.lastLoggedOnUser ?? <span className="app-muted">—</span>;
    case "status":
      // Quarantined replaces Online/Offline; once released the endpoint shows Online/Offline
      // again. A quarantine or release still waiting shows on the row's button, not here.
      return (
        <div className="app-badge-row">
          {agent.quarantined ? (
            <Badge tone="crit">Quarantined</Badge>
          ) : (
            <Pill tone={agent.status === "ONLINE" ? "ok" : "neutral"}>{agent.status === "ONLINE" ? "Online" : "Offline"}</Pill>
          )}
          {agent.uninstallingSince && (
            <span title={`Uninstall started ${formatDateTime(agent.uninstallingSince)}`}>
              <Badge tone="high">Uninstalling</Badge>
            </span>
          )}
          <ConsentBadge consent={agent.consent} />
          {agent.paused && <Badge tone="med">Paused</Badge>}
        </div>
      );
    case "os":
      return (
        <div className="ep-host">
          <b>{agent.osEditionLabel ?? agent.osPlatform}</b>
          <small>
            {agent.osVersion} · {agent.osArch}
          </small>
        </div>
      );
    case "posture": {
      const badges: ReactNode[] = [];
      if (!hidden.vulnerabilitiesHidden && agent.openVulnerabilityCount > 0) {
        badges.push(
          <Badge key="v" tone="high">
            {agent.openVulnerabilityCount} {agent.openVulnerabilityCount === 1 ? "vulnerability" : "vulnerabilities"}
          </Badge>,
        );
      }
      if (!hidden.zeroTrustHidden && agent.zeroTrustNonCompliantCount > 0) {
        badges.push(
          <Badge key="z" tone="crit">
            {agent.zeroTrustNonCompliantCount} Zero Trust failing
          </Badge>,
        );
      }
      if (agent.osEol?.isEol) badges.push(<Badge key="e" tone="med">OS end of life</Badge>);
      if (badges.length === 0) return hidden.vulnerabilitiesHidden && hidden.zeroTrustHidden ? <span className="app-muted">—</span> : <Badge tone="ok">Clean</Badge>;
      return <div className="app-badge-row">{badges}</div>;
    }
    case "lastCheckin":
      return (
        <span className="app-muted" title={formatDateTime(agent.lastCheckinAt, "Never")}>
          {formatRelative(agent.lastCheckinAt)}
        </span>
      );
    case "groups":
      return agent.groups.length > 0 ? (
        <div className="app-badge-row">
          {agent.groups.map((g) => (
            <Tag key={g.id}>{g.path ?? g.name}</Tag>
          ))}
        </div>
      ) : (
        <span className="app-muted">—</span>
      );
    case "deviceType":
      return DEVICE_TYPE_LABEL[agent.deviceType];
    case "location":
      return (
        agent.location ??
        (agent.ipGeoHint ? (
          <>
            {[agent.ipGeoHint.city, agent.ipGeoHint.country].filter(Boolean).join(", ")} <span className="app-muted">(via IP)</span>
          </>
        ) : (
          <span className="app-muted">—</span>
        ))
      );
    case "osLicense":
      return inv?.osLicenseStatus ? (
        <>
          {inv.osLicenseStatus}
          {inv.osLicenseChannel && <span className="app-muted"> · {inv.osLicenseChannel}</span>}
        </>
      ) : (
        <span className="app-muted">—</span>
      );
    case "osEol":
      return agent.osEol ? (
        <div className="app-badge-row">
          <span>
            {agent.osEol.versionName} · {formatDate(agent.osEol.eolDate)}
          </span>
          <Badge tone={agent.osEol.isEol ? "crit" : "ok"}>{agent.osEol.isEol ? "End of life" : "Supported"}</Badge>
        </div>
      ) : (
        <span className="app-muted">—</span>
      );
    case "processor":
      return inv?.cpuModel ? (
        <div className="ep-host">
          <b>{inv.cpuModel}</b>
          <small>
            {inv.cpuSpeedGhz ? `${inv.cpuSpeedGhz} GHz · ` : ""}
            {inv.cpuPhysicalCores ?? "?"}/{inv.cpuCores ?? "?"} cores
          </small>
        </div>
      ) : (
        <span className="app-muted">—</span>
      );
    case "memory":
      return inv?.totalMemBytes ? (
        <div className="ep-host">
          <b className="ep-num">{formatBytes(inv.totalMemBytes)}</b>
          {inv.memLayout.length > 0 && (
            <small>{inv.memLayout.map((m) => `${formatBytes(m.sizeBytes)} ${m.type ?? ""}`.trim()).join(" + ")}</small>
          )}
        </div>
      ) : (
        <span className="app-muted">—</span>
      );
    case "storage":
      return inv?.totalDiskBytes ? (
        <div className="ep-host">
          <b className="ep-num">{formatBytes(inv.totalDiskBytes)}</b>
          {inv.diskTypes.length > 0 && <small>{inv.diskTypes.join(" + ")}</small>}
        </div>
      ) : (
        <span className="app-muted">—</span>
      );
    case "warranty": {
      if (!agent.warrantyExpiryDate) return <span className="app-muted">—</span>;
      const expired = new Date(agent.warrantyExpiryDate) < new Date();
      return (
        <div className="app-badge-row">
          <span>{formatDate(agent.warrantyExpiryDate)}</span>
          {expired && <Badge tone="crit">Expired</Badge>}
        </div>
      );
    }
    case "lastPatch":
      return agent.lastPatchInstalledAt ? formatDate(agent.lastPatchInstalledAt) : <span className="app-muted">—</span>;
  }
}

function NetworkDevicesPanel() {
  const { data: summary } = useNetworkDeviceSummary();
  const [search, setSearch] = useState("");
  const [computersOnly, setComputersOnly] = useState(true);

  const term = search.trim().toLowerCase();
  const filteredHosts =
    summary?.unmanagedHosts
      .filter((h) => !computersOnly || looksLikeComputer(h.openPorts))
      .filter(
        (h) =>
          !term ||
          h.vlanName.toLowerCase().includes(term) ||
          h.ipAddress.toLowerCase().includes(term) ||
          (h.macAddress ?? "").toLowerCase().includes(term) ||
          (h.hostname ?? "").toLowerCase().includes(term),
      ) ?? [];
  const totalCount = summary?.unmanagedHosts.length ?? 0;
  const computerCount = summary?.unmanagedHosts.filter((h) => looksLikeComputer(h.openPorts)).length ?? 0;
  const hiddenByTypeCount = computersOnly ? totalCount - computerCount : 0;
  const paged = usePagedList(filteredHosts, 10);

  return (
    <Collapsible
      id={NETWORK_DEVICES_PANEL_ID}
      title="Unmanaged Network Devices"
      hint={`${totalCount} seen without an agent`}
      defaultOpen={false}
    >
      <div className="app-stack">
        <p className="app-text">
          Devices seen on a scanned VLAN with no agent installed — routers, switches, printers, and similar
          infrastructure. From each VLAN's most recent network scan.
        </p>
        <div className="app-actions-row">
          <div style={{ width: 320 }}>
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search hostname, IP, MAC or VLAN…" />
          </div>
          <Check
            checked={computersOnly}
            onChange={setComputersOnly}
            label={
              <>
                Laptops, desktops and servers only <span className="app-muted ep-num">({computerCount} of {totalCount})</span>
              </>
            }
            hint={
              computersOnly && hiddenByTypeCount > 0
                ? `${hiddenByTypeCount} hidden — based on open ports (no Windows/SSH management ports responded), not a guaranteed device type.`
                : undefined
            }
          />
        </div>
        {totalCount === 0 ? (
          <EmptyState icon={Radar} title="No unmanaged devices found">
            Scan a VLAN on the Network discovery page to find devices without the agent.
          </EmptyState>
        ) : filteredHosts.length === 0 ? (
          <EmptyState icon={SearchX} title="No devices match">
            {term ? `Nothing matches "${search}".` : "All unmanaged devices were filtered out by the computers-only filter."}
          </EmptyState>
        ) : (
          <div className="app-table-wrap">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Device</th>
                  <th scope="col">MAC address</th>
                  <th scope="col">VLAN</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((h) => (
                  <tr key={`${h.vlanName}-${h.ipAddress}`}>
                    <td className="ep-host">
                      <b className={h.hostname ? undefined : "app-unnamed"}>{h.hostname ?? "Unknown hostname"}</b>
                      <small>{h.ipAddress}</small>
                    </td>
                    <td className="ep-mono">{h.macAddress ?? "—"}</td>
                    <td>{h.vlanName}</td>
                    <td>
                      <div className="app-cell-actions">
                        <InstallAgentAction hostname={h.hostname} ipAddress={h.ipAddress} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paged.total > paged.pageSize && (
              <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} noun="devices" onPageChange={paged.setPage} />
            )}
          </div>
        )}
      </div>
    </Collapsible>
  );
}

export default function AgentsPage() {
  const navigate = useNavigate();
  const { data: agents, isLoading, error, refetch } = useAgents();
  const { data: groups } = useAssetGroups();
  // Shares the query-cache entry with NetworkDevicesPanel's own call below — only one
  // network request either way, just needed here too for the Unmanaged tile's count.
  const { data: networkDeviceSummary } = useNetworkDeviceSummary();
  const vulnerabilitiesHidden = useIsItemHidden("/vulnerabilities");
  const zeroTrustHidden = useIsItemHidden("/zero-trust");
  const patchesHidden = useIsItemHidden("/patches");
  const enrollmentHidden = useIsItemHidden("/enrollment-tokens");
  // Initial filters can come from the URL, so Dashboard charts/tiles can deep-link here
  // pre-filtered (e.g. /endpoints?status=OFFLINE, ?deviceType=LAPTOP, ?os=..., ?vuln=open).
  const [searchParams, setSearchParams] = useSearchParams();
  const [groupFilter, setGroupFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const s = searchParams.get("status");
    return s === "ONLINE" || s === "OFFLINE" || s === "QUARANTINED" ? s : "all";
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
  // Dashboard drill-downs: missing patches / up to date, and benchmark compliance.
  const [patchFilter, setPatchFilter] = useState<"" | "missing" | "none">(() => {
    const v = searchParams.get("patch");
    return v === "missing" || v === "none" ? v : "";
  });
  const [configFilter, setConfigFilter] = useState<"" | "compliant" | "noncompliant" | "unassessed">(() => {
    const v = searchParams.get("config");
    return v === "compliant" || v === "noncompliant" || v === "unassessed" ? v : "";
  });
  // One search box across hostname, IP and logged-on user.
  const [search, setSearch] = useState("");
  const [columns, setColumns] = useState<ColumnKey[]>(loadColumns);
  const { licensed } = useFeatureLicensed();
  const quarantine = useQuarantineAgent();
  const release = useReleaseAgent();
  const bulkQuarantine = useBulkQuarantine();
  const bulkRelease = useBulkRelease();
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const totalCount = agents?.length ?? 0;
  const onlineCount = agents?.filter((a) => a.status === "ONLINE").length ?? 0;
  const offlineCount = agents?.filter((a) => a.status === "OFFLINE").length ?? 0;
  const quarantinedCount = agents?.filter((a) => a.quarantined).length ?? 0;
  const unmanagedCount = networkDeviceSummary?.unmanagedHosts.length ?? 0;

  const term = search.trim().toLowerCase();
  // A group filter covers its sub groups (Mumbai includes Andheri and Ghatkopar).
  const groupFilterIds = groupFilter ? groupsBelow(groups, [groupFilter]) : null;
  const filteredAgents = (agents ?? [])
    .filter((agent) => !groupFilterIds || agent.groups.some((g) => groupFilterIds.has(g.id)))
    .filter((agent) => (statusFilter === "QUARANTINED" ? agent.quarantined : statusFilter === "all" || agent.status === statusFilter))
    .filter((agent) => !deviceTypeFilter || agent.deviceType === deviceTypeFilter)
    // Same "Unknown" fallback the Dashboard's OS chart uses (dashboard.service.ts).
    .filter((agent) => !osFilter || (agent.osEditionLabel || "Unknown") === osFilter)
    .filter(
      (agent) =>
        !vulnFilter || (vulnFilter === "open" ? agent.openVulnerabilityCount > 0 : agent.openVulnerabilityCount === 0),
    )
    .filter((agent) => !patchFilter || (patchFilter === "missing" ? agent.missingPatchCount > 0 : agent.missingPatchCount === 0))
    .filter(
      (agent) =>
        !configFilter ||
        (configFilter === "unassessed"
          ? agent.failingConfigRuleCount === null
          : configFilter === "compliant"
            ? agent.failingConfigRuleCount === 0
            : (agent.failingConfigRuleCount ?? 0) > 0),
    )
    .filter(
      (agent) =>
        !term ||
        agent.hostname.toLowerCase().includes(term) ||
        (agent.ipAddress ?? "").toLowerCase().includes(term) ||
        (agent.inventory?.lastLoggedOnUser ?? "").toLowerCase().includes(term),
    );
  const paged = usePagedList(filteredAgents, 25);

  // Optional columns tied to a hidden module are never offered.
  const availableColumns = ALL_COLUMNS.filter((c) => !(c.key === "lastPatch" && patchesHidden));
  const visibleColumns = availableColumns.filter((c) => columns.includes(c.key));

  if (isLoading) {
    return (
      <>
        <PageHeader title="Endpoints" description="All devices with the Endpoint IQ agent installed" />
        <Card>
          <Skeleton lines={6} />
        </Card>
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Endpoints" />
        <Alert tone="critical" title="Couldn't load endpoints" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
          {(error as Error).message}
        </Alert>
      </>
    );
  }

  async function handleQuarantineToggle(agent: AgentListItem) {
    if (agent.quarantined) {
      const confirmed = await confirm({
        title: `Release ${agent.hostname} From Quarantine?`,
        body: "This restores normal outbound network access on the endpoint.",
        confirmLabel: "Release endpoint",
      });
      if (!confirmed) return;
      setPendingAgentId(agent.id);
      release.mutate(agent.id, {
        onError: (err) => toast(`Couldn't release ${agent.hostname}: ${(err as Error).message}`),
        onSettled: () => setPendingAgentId(null),
      });
    } else {
      const confirmed = await confirm({
        title: `Quarantine ${agent.hostname}?`,
        body:
          "This locks the endpoint's firewall down to DNS and this server only — all other network access is blocked " +
          "until you release it. " +
          (agent.status === "ONLINE"
            ? "It shows Quarantined once the endpoint confirms the block is in force."
            : "It's offline now: it's quarantined as soon as it connects again (within 30 seconds), before anything else it has waiting."),
        confirmLabel: "Quarantine endpoint",
        tone: "danger",
      });
      if (!confirmed) return;
      setPendingAgentId(agent.id);
      quarantine.mutate(agent.id, {
        onError: (err) => toast(`Couldn't quarantine ${agent.hostname}: ${(err as Error).message}`),
        onSettled: () => setPendingAgentId(null),
      });
    }
  }

  // Quarantine all / Release all act on the endpoints the list shows right now (search and
  // filters applied), never on endpoints hidden by a filter. Quarantine is Windows only, and
  // skips endpoints already quarantined or with a quarantine/release still waiting.
  const idle = (a: AgentListItem) => a.quarantineActivity?.state !== "PENDING";
  const toQuarantine = filteredAgents.filter((a) => a.osPlatform === "win32" && !a.quarantined && idle(a));
  const toRelease = filteredAgents.filter((a) => a.quarantined && idle(a));
  const filtersApplied = filteredAgents.length !== totalCount;

  function namesPreview(list: AgentListItem[]): string {
    const names = list.slice(0, 10).map((a) => a.hostname).join(", ");
    return list.length > 10 ? `${names} and ${list.length - 10} more` : names;
  }

  async function handleQuarantineAll() {
    if (toQuarantine.length === 0) return;
    const confirmed = await confirm({
      title: `Quarantine ${toQuarantine.length} Endpoint${toQuarantine.length === 1 ? "" : "s"}?`,
      body:
        `${filtersApplied ? "Every Windows endpoint in the filtered list" : "Every Windows endpoint"} that isn't quarantined yet ` +
        `loses all network access except DNS and this server until released: ${namesPreview(toQuarantine)}. ` +
        "Each one shows Quarantined once it confirms the block is in force; offline ones are quarantined as soon as they connect again.",
      confirmLabel: `Quarantine ${toQuarantine.length}`,
      tone: "danger",
    });
    if (!confirmed) return;
    bulkQuarantine.mutate(
      { agentIds: toQuarantine.map((a) => a.id), groupIds: [] },
      {
        onSuccess: () => toast(`Quarantine sent to ${toQuarantine.length} endpoint(s).`),
        onError: (err) => toast(`Couldn't quarantine: ${(err as Error).message}`),
      },
    );
  }

  async function handleReleaseAll() {
    if (toRelease.length === 0) return;
    const confirmed = await confirm({
      title: `Release ${toRelease.length} Endpoint${toRelease.length === 1 ? "" : "s"} From Quarantine?`,
      body: `Normal network access comes back on: ${namesPreview(toRelease)}.`,
      confirmLabel: `Release ${toRelease.length}`,
    });
    if (!confirmed) return;
    bulkRelease.mutate(
      { agentIds: toRelease.map((a) => a.id), groupIds: [] },
      {
        onSuccess: () => toast(`Release sent to ${toRelease.length} endpoint(s).`),
        onError: (err) => toast(`Couldn't release: ${(err as Error).message}`),
      },
    );
  }

  function clearUrlFilter(key: "os" | "vuln" | "patch" | "config") {
    if (key === "os") setOsFilter("");
    else if (key === "vuln") setVulnFilter("");
    else if (key === "patch") setPatchFilter("");
    else setConfigFilter("");
    searchParams.delete(key);
    setSearchParams(searchParams, { replace: true });
  }

  function clearAllFilters() {
    setSearch("");
    setGroupFilter("");
    setDeviceTypeFilter("");
    setStatusFilter("all");
    setOsFilter("");
    setVulnFilter("");
    setPatchFilter("");
    setConfigFilter("");
    searchParams.delete("os");
    searchParams.delete("vuln");
    searchParams.delete("patch");
    searchParams.delete("config");
    searchParams.delete("status");
    searchParams.delete("deviceType");
    setSearchParams(searchParams, { replace: true });
  }

  const chips = [
    ...(osFilter ? [{ key: "os", label: `Operating system: ${osFilter}`, onRemove: () => clearUrlFilter("os") }] : []),
    ...(vulnFilter
      ? [{ key: "vuln", label: vulnFilter === "open" ? "Has open vulnerabilities" : "No open vulnerabilities", onRemove: () => clearUrlFilter("vuln") }]
      : []),
    ...(patchFilter
      ? [{ key: "patch", label: patchFilter === "missing" ? "Missing patches" : "Patches up to date", onRemove: () => clearUrlFilter("patch") }]
      : []),
    ...(configFilter
      ? [
          {
            key: "config",
            label:
              configFilter === "compliant"
                ? "Configuration compliant"
                : configFilter === "noncompliant"
                  ? "Configuration not compliant"
                  : "Configuration not assessed",
            onRemove: () => clearUrlFilter("config"),
          },
        ]
      : []),
  ];

  const hidden = { vulnerabilitiesHidden, zeroTrustHidden };
  const exportCsv = () => {
    const csv = buildAgentsCsv(filteredAgents, { vulnerabilitiesHidden, zeroTrustHidden, patchesHidden });
    downloadCsv("endpoints.csv", csv.headers, csv.rows);
  };

  return (
    <>
      <PageHeader
        title="Endpoints"
        description="All devices with the Endpoint IQ agent installed"
        actions={
          <>
            <Button icon={Download} onClick={exportCsv} disabled={filteredAgents.length === 0}>
              Export CSV
            </Button>
            {!enrollmentHidden && (
              <Link className="ep-btn ep-btn-primary" to="/enrollment-tokens">
                <KeyRound size={15} strokeWidth={1.7} className="ep-ic" aria-hidden />
                Enroll endpoint
              </Link>
            )}
          </>
        }
      />

      <KpiStrip>
        <Kpi icon={Monitor} label="Total endpoints" value={totalCount} suffix="managed" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
        <Kpi
          icon={Wifi}
          label="Online"
          value={onlineCount}
          suffix={`${totalCount > 0 ? Math.round((onlineCount / totalCount) * 100) : 0}%`}
          bar={[
            { value: onlineCount, color: CHART_SEMANTIC.ok },
            { value: offlineCount, color: CHART_SEMANTIC.neutral },
          ]}
          active={statusFilter === "ONLINE"}
          onClick={() => setStatusFilter("ONLINE")}
        />
        <Kpi icon={WifiOff} label="Offline" value={offlineCount} suffix="no recent check-in" active={statusFilter === "OFFLINE"} onClick={() => setStatusFilter("OFFLINE")} />
        <Kpi
          icon={Lock}
          label="Quarantined"
          value={quarantinedCount}
          valueTone={quarantinedCount > 0 ? "critical" : undefined}
          suffix="isolated from the network"
          active={statusFilter === "QUARANTINED"}
          onClick={() => setStatusFilter("QUARANTINED")}
        />
        <Kpi
          icon={Network}
          label="Unmanaged"
          value={unmanagedCount}
          valueTone={unmanagedCount > 0 ? "warning" : undefined}
          suffix="on scanned VLANs"
          footer="Show devices without an agent"
          onClick={scrollToUnmanagedNetworkDevices}
        />
      </KpiStrip>

      <Card flush>
        <Toolbar
          right={
            <>
              <Segmented
                label="Status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "all", label: `All ${totalCount}` },
                  { value: "ONLINE", label: `Online ${onlineCount}` },
                  { value: "OFFLINE", label: `Offline ${offlineCount}` },
                  { value: "QUARANTINED", label: `Quarantined ${quarantinedCount}` },
                ]}
              />
              <ColumnPicker
                columns={availableColumns}
                visible={columns}
                onChange={(next) => {
                  setColumns(next as ColumnKey[]);
                  saveColumns(next as ColumnKey[]);
                }}
              />
            </>
          }
        >
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search hostname, IP, user…" />
          {groups && groups.length > 0 && (
            <select className="ep-select" aria-label="Group" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
              <option value="">Group: All</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.path ?? g.name}
                </option>
              ))}
            </select>
          )}
          <select
            className="ep-select"
            aria-label="Device type"
            value={deviceTypeFilter}
            onChange={(e) => setDeviceTypeFilter(e.target.value as DeviceType | "")}
          >
            <option value="">Type: All</option>
            <option value="LAPTOP">Laptop</option>
            <option value="DESKTOP">Desktop</option>
            <option value="SERVER">Server</option>
          </select>
          <Button
            variant="danger"
            icon={Lock}
            onClick={handleQuarantineAll}
            disabled={toQuarantine.length === 0 || bulkQuarantine.isPending || !licensed("EH_QUARANTINE")}
            title={
              !licensed("EH_QUARANTINE")
                ? "Quarantine isn't included in your licence"
                : filtersApplied
                ? "Quarantine the Windows endpoints in the filtered list"
                : "Quarantine every Windows endpoint (filter the list first to quarantine only some)"
            }
          >
            {bulkQuarantine.isPending ? "Sending…" : `Quarantine all (${toQuarantine.length})`}
          </Button>
          <Button
            icon={LockOpen}
            onClick={handleReleaseAll}
            disabled={toRelease.length === 0 || bulkRelease.isPending}
            title={filtersApplied ? "Release the quarantined endpoints in the filtered list" : "Release every quarantined endpoint"}
          >
            {bulkRelease.isPending ? "Sending…" : `Release all (${toRelease.length})`}
          </Button>
        </Toolbar>
        <FilterChips chips={chips} />

        {totalCount === 0 ? (
          <EmptyState
            icon={Monitor}
            title="No endpoints enrolled yet"
            action={
              !enrollmentHidden && (
                <Link className="ep-btn ep-btn-sm" to="/enrollment-tokens">
                  Create enrollment token
                </Link>
              )
            }
          >
            Install the agent with an enrollment token and endpoints appear here within a minute.
          </EmptyState>
        ) : filteredAgents.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No endpoints match these filters"
            action={
              <Button size="sm" onClick={clearAllFilters}>
                Clear filters
              </Button>
            }
          >
            Try a different search or remove a filter.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Endpoint</th>
                    {visibleColumns.map((c) => (
                      <th key={c.key} scope="col">
                        {c.label}
                      </th>
                    ))}
                    <th scope="col">
                      <span className="app-vh">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.pageItems.map((agent) => (
                    <tr key={agent.id} className="app-clickable" onClick={() => navigate(`/endpoints/${agent.id}`)}>
                      <td className="ep-host">
                        <b>
                          <Link to={`/endpoints/${agent.id}`} className="app-row-link" onClick={(e) => e.stopPropagation()}>
                            {agent.hostname}
                          </Link>
                        </b>
                        <small>{agent.ipAddress ?? "No IP reported"}</small>
                      </td>
                      {visibleColumns.map((c) => (
                        <td key={c.key}>{cellFor(c.key, agent, hidden)}</td>
                      ))}
                      <td>
                        <div className="app-cell-actions" onClick={(e) => e.stopPropagation()}>
                          {(agent.osPlatform === "win32" || agent.quarantined) && (
                            <Button
                              size="sm"
                              variant={agent.quarantined ? "secondary" : "danger"}
                              icon={agent.quarantined ? LockOpen : Lock}
                              disabled={pendingAgentId === agent.id || agent.quarantineActivity?.state === "PENDING" || (!agent.quarantined && !licensed("EH_QUARANTINE"))}
                              title={!agent.quarantined && !licensed("EH_QUARANTINE") ? "Quarantine isn't included in your licence" : undefined}
                              onClick={() => handleQuarantineToggle(agent)}
                            >
                              {pendingAgentId === agent.id
                                ? "Sending…"
                                : agent.quarantineActivity?.state === "PENDING"
                                  ? agent.quarantineActivity.action === "RELEASE"
                                    ? "Releasing…"
                                    : "Quarantining…"
                                  : agent.quarantined
                                    ? "Release"
                                    : "Quarantine"}
                            </Button>
                          )}
                        </div>
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
              noun="endpoints"
              onPageChange={paged.setPage}
              onPageSizeChange={paged.setPageSize}
            />
          </>
        )}
      </Card>

      <NetworkDevicesPanel />
    </>
  );
}
