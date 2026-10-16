import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Monitor, Network, Radar, ShieldCheck, TriangleAlert, Wifi } from "lucide-react";
import { useDashboardSummary, useIsItemHidden } from "../api/hooks";
import type { DashboardSummary } from "../api/types";
import { CHART_SEMANTIC, CHART_SERIES } from "../chartTheme";
import {
  Alert,
  Badge,
  Button,
  Card,
  CoverageTable,
  Donut,
  EmptyState,
  Kpi,
  KpiStrip,
  Legend,
  PageHeader,
  Pagination,
  RankedBars,
  Row,
  Skeleton,
  type ChartDatum,
  type CoverageRow,
} from "../components/ui";

// Pattern A — overview dashboard (design-system/docs/PAGE_PATTERNS.md, reference/dashboard.html).

// The server's label for endpoints whose OS edition couldn't be read (dashboard.service.ts).
const UNKNOWN_OS_LABEL = "Unknown";
const UNMANAGED_PAGE_SIZE = 10;

function percentOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function relativeTime(from: number, now: number): string {
  const minutes = Math.floor((now - from) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

// Re-render periodically so "Updated N min ago" stays truthful between pushes.
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function LoadingDashboard() {
  return (
    <>
      <PageHeader title="Dashboard" description="Loading fleet summary…" />
      <KpiStrip>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="ep-card ep-kpi">
            <Skeleton lines={3} />
          </div>
        ))}
      </KpiStrip>
      <Row layout="21">
        <Card title="Agent coverage by VLAN">
          <Skeleton />
        </Card>
        <Card title="Security posture">
          <Skeleton />
        </Card>
      </Row>
    </>
  );
}

function CoverageCard({ summary, onOpenNetworkScan }: { summary: DashboardSummary; onOpenNetworkScan: () => void }) {
  // Largest networks first; never-scanned VLANs last, with a call to action instead of a bar.
  const vlans = [...summary.networkDeviceSummary].sort((a, b) => {
    if (a.hasScan !== b.hasScan) return a.hasScan ? -1 : 1;
    return b.total - a.total;
  });
  const rows: CoverageRow[] = vlans.map((v) => ({
    key: v.vlanId,
    name: v.vlanName,
    sub: v.hasScan ? `${v.total} hosts` : "not scanned",
    segments: [
      { value: v.managed, color: CHART_SEMANTIC.ok },
      { value: v.unmanaged, color: CHART_SEMANTIC.warn },
    ],
    managed: v.managed,
    total: v.total,
    noData: v.hasScan ? (v.total === 0 ? "Latest scan found no hosts" : undefined) : "No scan data yet — schedule a network scan",
    onSelect: onOpenNetworkScan,
  }));

  return (
    <Card
      title="Agent coverage by VLAN"
      hint="managed vs. unenrolled hosts from latest scan"
      actions={
        rows.length > 0 && (
          <Legend
            items={[
              { label: "Managed", color: CHART_SEMANTIC.ok },
              { label: "Unmanaged", color: CHART_SEMANTIC.warn },
            ]}
          />
        )
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="No VLANs set up yet"
          action={
            <Button size="sm" onClick={onOpenNetworkScan}>
              Set up network discovery
            </Button>
          }
        >
          Add a VLAN on the Network discovery page to see which hosts have the agent.
        </EmptyState>
      ) : (
        <CoverageTable nameHeader="Network" rows={rows} />
      )}
    </Card>
  );
}

function PostureCard({
  summary,
  showVulnerabilities,
  showZeroTrust,
  goTo,
  endpointsLink,
}: {
  summary: DashboardSummary;
  showVulnerabilities: boolean;
  showZeroTrust: boolean;
  goTo: (to: string | undefined) => (() => void) | undefined;
  endpointsLink: (query?: string) => string | undefined;
}) {
  const { trusted, notTrusted, notAssigned } = summary.trustSummary;
  const trustTotal = trusted + notTrusted + notAssigned;
  const vulnerabilityData: ChartDatum[] = [
    // "Clean" has no CVEs to show, so it lists the clean endpoints instead.
    { label: "Clean", value: summary.vulnerabilitySummary.clean, color: CHART_SEMANTIC.ok, onSelect: goTo(endpointsLink("?vuln=none")) },
    {
      label: "Vulnerable",
      value: summary.vulnerabilitySummary.withVulnerabilities,
      color: CHART_SEMANTIC.critical,
      onSelect: goTo("/vulnerabilities"),
    },
  ];
  const trustSegments = [
    { label: "Trusted", value: trusted, color: CHART_SEMANTIC.ok, to: "/zero-trust?trust=trusted" },
    { label: "Not trusted", value: notTrusted, color: CHART_SEMANTIC.critical, to: "/zero-trust?trust=not-trusted" },
    // No enabled policy covers these, so it opens the page itself (where policies get assigned).
    { label: "Not assessed", value: notAssigned, color: CHART_SEMANTIC.neutral, to: "/zero-trust" },
  ];

  return (
    <Card
      title={showVulnerabilities ? "Vulnerability exposure" : "Zero Trust status"}
      actions={
        showVulnerabilities && (
          <Link className="ep-link" to="/vulnerabilities">
            View all
          </Link>
        )
      }
    >
      {showVulnerabilities && <Donut centerLabel="endpoints" data={vulnerabilityData} />}
      {showZeroTrust && (
        <div className="app-posture-section">
          {showVulnerabilities && <div className="app-posture-title">Zero Trust status</div>}
          {trustTotal === 0 ? (
            <span className="ep-nodata">No endpoints enrolled yet</span>
          ) : (
            <>
              <div className="ep-sbar">
                {trustSegments.map((s) => (
                  <i key={s.label} style={{ width: `${(s.value / trustTotal) * 100}%`, background: s.color }} />
                ))}
              </div>
              <div className="ep-legend">
                {trustSegments.map((s) => (
                  <Link key={s.label} to={s.to} className="app-legend-link">
                    <i className="ep-sw" style={{ background: s.color }} />
                    {s.label} <b className="ep-num">{s.value}</b>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function UnmanagedDevicesCard({ summary, onOpenNetworkScan }: { summary: DashboardSummary; onOpenNetworkScan: () => void }) {
  const [page, setPage] = useState(1);
  const hosts = summary.unmanagedHosts;
  const anyScanned = summary.networkDeviceSummary.some((v) => v.hasScan);
  const pageCount = Math.max(1, Math.ceil(hosts.length / UNMANAGED_PAGE_SIZE));
  // Live updates can shrink the list under the current page.
  const currentPage = Math.min(page, pageCount);
  const visible = hosts.slice((currentPage - 1) * UNMANAGED_PAGE_SIZE, currentPage * UNMANAGED_PAGE_SIZE);

  return (
    <Card
      flush
      title="Unmanaged devices"
      hint="seen by network scan without an agent"
      actions={
        <Link className="ep-link" to="/network-scan">
          Open network discovery
        </Link>
      }
    >
      {hosts.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={anyScanned ? "No unmanaged devices" : "No scan results yet"}
          action={
            <Button size="sm" onClick={onOpenNetworkScan}>
              Run network scan
            </Button>
          }
        >
          {anyScanned
            ? "Every host found on a scanned VLAN has the agent. Scan again after network changes."
            : "Run a network scan to find devices on your network that don't have the agent."}
        </EmptyState>
      ) : (
        <>
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">MAC address</th>
                <th scope="col">VLAN</th>
                <th scope="col">Open ports</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((h) => (
                <tr key={`${h.vlanName}-${h.ipAddress}`}>
                  <td className="ep-host">
                    <b className={h.hostname ? undefined : "app-unnamed"}>{h.hostname ?? "Unknown hostname"}</b>
                    <small>{h.ipAddress}</small>
                  </td>
                  <td className="ep-mono">{h.macAddress ?? "—"}</td>
                  <td>{h.vlanName}</td>
                  <td className="ep-mono">{h.openPorts.length > 0 ? h.openPorts.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hosts.length > UNMANAGED_PAGE_SIZE && (
            <Pagination page={currentPage} pageSize={UNMANAGED_PAGE_SIZE} total={hosts.length} noun="devices" onPageChange={setPage} />
          )}
        </>
      )}
    </Card>
  );
}

// Patch and security-configuration posture (Pattern A supporting row): missing patches by
// severity, configuration compliance across endpoints, and the rules failing most widely.
const PATCH_SEVERITY_ROWS: { key: keyof DashboardSummary["patchSummary"]["missingBySeverity"]; label: string; color: string }[] = [
  { key: "CRITICAL", label: "Critical", color: "var(--ep-sev-critical)" },
  { key: "HIGH", label: "High", color: "var(--ep-sev-high)" },
  { key: "MEDIUM", label: "Medium", color: "var(--ep-sev-medium)" },
  { key: "LOW", label: "Low", color: "var(--ep-sev-low)" },
  { key: "UNKNOWN", label: "Not rated", color: CHART_SEMANTIC.neutral },
];

function MissingPatchesCard({ summary, onOpen }: { summary: DashboardSummary; onOpen: () => void }) {
  const p = summary.patchSummary;
  const data = PATCH_SEVERITY_ROWS.map((r) => ({ label: r.label, value: p.missingBySeverity[r.key], color: r.color, onSelect: onOpen })).filter(
    (d) => d.value > 0,
  );
  return (
    <Card
      title="Missing patches"
      actions={
        <Link className="ep-link" to="/patches">
          Open patches
        </Link>
      }
    >
      {summary.totalAgents === 0 ? (
        <span className="ep-nodata">No endpoints enrolled yet</span>
      ) : p.missingPatches === 0 ? (
        <span className="ep-nodata">Every endpoint is up to date</span>
      ) : (
        <div className="app-stack-sm">
          <span className="app-text">
            <span className="ep-num">{p.endpointsMissingPatches}</span> of <span className="ep-num">{summary.totalAgents}</span> endpoints need{" "}
            <span className="ep-num">{p.missingPatches}</span> {p.missingPatches === 1 ? "patch" : "patches"}
          </span>
          <RankedBars data={data} total={p.missingPatches} />
        </div>
      )}
    </Card>
  );
}

function ConfigurationComplianceCard({ summary }: { summary: DashboardSummary }) {
  const c = summary.configurationSummary;
  const notAssessed = Math.max(summary.totalAgents - c.assessedEndpoints, 0);
  return (
    <Card
      title="Configuration compliance"
      actions={
        <Link className="ep-link" to="/security-config">
          Open benchmarks
        </Link>
      }
    >
      {summary.totalAgents === 0 ? (
        <span className="ep-nodata">No endpoints enrolled yet</span>
      ) : c.assessedEndpoints === 0 ? (
        <span className="ep-nodata">No endpoint assessed yet - assign a benchmark under Security configuration</span>
      ) : (
        <Donut
          centerLabel="endpoints"
          data={[
            { label: "Compliant", value: c.compliantEndpoints, color: CHART_SEMANTIC.ok },
            { label: "Not compliant", value: c.nonCompliantEndpoints, color: CHART_SEMANTIC.critical },
            { label: "Not assessed", value: notAssessed, color: CHART_SEMANTIC.neutral },
          ]}
        />
      )}
    </Card>
  );
}

function FailingRulesCard({ summary }: { summary: DashboardSummary }) {
  const c = summary.configurationSummary;
  return (
    <Card title="Most failed rules" actions={c.failedChecks > 0 && <Badge tone="crit">{c.failedChecks} failed checks</Badge>}>
      {c.topFailingRules.length === 0 ? (
        <span className="ep-nodata">{c.assessedEndpoints === 0 ? "No benchmark results yet" : "No failing rules"}</span>
      ) : (
        <RankedBars
          data={c.topFailingRules.map((r) => ({ label: r.title, value: r.endpoints, color: CHART_SEMANTIC.critical }))}
          total={c.assessedEndpoints}
        />
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: summary, isLoading, isError, error, refetch, dataUpdatedAt } = useDashboardSummary();
  const now = useNow(30000);
  // Links into Endpoints are dropped (not redirected) when that page is hidden.
  const endpointsHidden = useIsItemHidden("/endpoints");
  const endpointsLink = (query = "") => (endpointsHidden ? undefined : `/endpoints${query}`);
  const vulnerabilitiesHidden = useIsItemHidden("/vulnerabilities");
  const zeroTrustHidden = useIsItemHidden("/zero-trust");
  const patchesHidden = useIsItemHidden("/patches");
  const securityConfigHidden = useIsItemHidden("/security-config");
  // Coverage, unmanaged devices and the scan action are all built from Network Scan results.
  const networkScanHidden = useIsItemHidden("/network-scan");

  const goTo = (to: string | undefined) => (to ? () => navigate(to) : undefined);
  const openNetworkScan = () => navigate("/network-scan");

  if (isLoading) return <LoadingDashboard />;
  if (isError || !summary) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Alert tone="critical" title="Couldn't load the dashboard" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
          {(error as Error | null)?.message ?? "The server didn't return a fleet summary."}
        </Alert>
      </>
    );
  }

  const total = summary.totalAgents;
  const { trusted, notTrusted, notAssigned } = summary.trustSummary;
  const { agentsInstalled, discoveredByNetworkScan, notInstalled } = summary.agentCoverage;

  const deviceTypeData: ChartDatum[] = [
    { label: "Laptop", value: summary.deviceTypeCounts.LAPTOP, color: CHART_SERIES[0], onSelect: goTo(endpointsLink("?deviceType=LAPTOP")) },
    { label: "Desktop", value: summary.deviceTypeCounts.DESKTOP, color: CHART_SERIES[1], onSelect: goTo(endpointsLink("?deviceType=DESKTOP")) },
    { label: "Server", value: summary.deviceTypeCounts.SERVER, color: CHART_SERIES[2], onSelect: goTo(endpointsLink("?deviceType=SERVER")) },
  ];

  const osLink = (label: string) => endpointsLink(`?os=${encodeURIComponent(label)}`);
  const knownOs = summary.osCounts.filter((o) => o.label !== UNKNOWN_OS_LABEL);
  const unknownOsCount = summary.osCounts.find((o) => o.label === UNKNOWN_OS_LABEL)?.count ?? 0;
  // Ranked bars carry their own labels, so colour follows rank here (series 1 for the top
  // OS); the unclassified tail is always neutral and always last.
  const osData: ChartDatum[] = [...knownOs]
    .sort((a, b) => b.count - a.count)
    .map((o, i) => ({ label: o.label, value: o.count, color: CHART_SERIES[i % CHART_SERIES.length], onSelect: goTo(osLink(o.label)) }));
  const osTail: ChartDatum | undefined =
    unknownOsCount > 0
      ? { label: "Unclassified", value: unknownOsCount, color: CHART_SEMANTIC.neutral, onSelect: goTo(osLink(UNKNOWN_OS_LABEL)) }
      : undefined;

  const connectivityData: ChartDatum[] = [
    { label: "Online", value: summary.onlineCount, color: CHART_SEMANTIC.ok, onSelect: goTo(endpointsLink("?status=ONLINE")) },
    { label: "Offline", value: summary.offlineCount, color: CHART_SEMANTIC.neutral, onSelect: goTo(endpointsLink("?status=OFFLINE")) },
  ];

  const showPosture = !vulnerabilitiesHidden || !zeroTrustHidden;
  const coverageCard = !networkScanHidden && <CoverageCard summary={summary} onOpenNetworkScan={openNetworkScan} />;
  const postureCard = showPosture && (
    <PostureCard
      summary={summary}
      showVulnerabilities={!vulnerabilitiesHidden}
      showZeroTrust={!zeroTrustHidden}
      goTo={goTo}
      endpointsLink={endpointsLink}
    />
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          <>
            <span className="ep-live">Live</span>· <span className="ep-num">{total}</span> managed endpoints ·{" "}
            {dataUpdatedAt ? `Updated ${relativeTime(dataUpdatedAt, now)}` : null}
          </>
        }
        actions={
          !networkScanHidden && (
            <Link className="ep-btn ep-btn-primary" to="/network-scan">
              <Radar size={15} strokeWidth={1.7} className="ep-ic" aria-hidden />
              Run network scan
            </Link>
          )
        }
      />

      <KpiStrip>
        <Kpi
          icon={Monitor}
          label="Total endpoints"
          value={total}
          suffix="managed"
          footer={`${summary.offlineCount} offline`}
          to={endpointsLink()}
        />
        <Kpi
          icon={Wifi}
          label="Online now"
          value={summary.onlineCount}
          suffix={`${percentOf(summary.onlineCount, total)}%`}
          bar={[
            { value: summary.onlineCount, color: CHART_SEMANTIC.ok },
            { value: summary.offlineCount, color: CHART_SEMANTIC.neutral },
          ]}
          to={endpointsLink("?status=ONLINE")}
        />
        {!vulnerabilitiesHidden && (
          <Kpi
            icon={TriangleAlert}
            label="With vulnerabilities"
            value={summary.vulnerabilitySummary.withVulnerabilities}
            valueTone={summary.vulnerabilitySummary.withVulnerabilities > 0 ? "critical" : undefined}
            suffix={`${percentOf(summary.vulnerabilitySummary.withVulnerabilities, total)}%`}
            footer={`${summary.vulnerabilitySummary.clean} clean`}
            to={endpointsLink("?vuln=open")}
          />
        )}
        {!zeroTrustHidden && (
          <Kpi
            icon={ShieldCheck}
            label="Zero Trust assessed"
            value={trusted + notTrusted}
            suffix={`of ${total}`}
            footer={
              notAssigned > 0 ? (
                <span className="ep-delta ep-warn">{notAssigned} not assessed</span>
              ) : (
                `${trusted} trusted · ${notTrusted} not trusted`
              )
            }
            to="/zero-trust"
          />
        )}
        {!networkScanHidden && (
          <Kpi
            icon={Network}
            label="Unmanaged devices"
            value={notInstalled}
            valueTone={notInstalled > 0 ? "warning" : undefined}
            suffix={`of ${discoveredByNetworkScan} seen`}
            footer={`${agentsInstalled} with agent installed`}
            to="/network-scan"
          />
        )}
      </KpiStrip>

      {coverageCard && postureCard ? (
        // Stacks earlier than the default breakpoint: the coverage bars need the full width.
        <Row layout="21" className="app-dash-top">
          {coverageCard}
          {postureCard}
        </Row>
      ) : (
        coverageCard || postureCard
      )}

      {(!patchesHidden || !securityConfigHidden) && (
        <Row layout={!patchesHidden && !securityConfigHidden ? "3" : "12"}>
          {!patchesHidden && <MissingPatchesCard summary={summary} onOpen={() => navigate("/patches")} />}
          {!securityConfigHidden && <ConfigurationComplianceCard summary={summary} />}
          {!securityConfigHidden && <FailingRulesCard summary={summary} />}
        </Row>
      )}

      <Row layout="3">
        <Card title="Connectivity">
          {total === 0 ? <span className="ep-nodata">No endpoints enrolled yet</span> : <Donut centerLabel="endpoints" data={connectivityData} />}
        </Card>
        <Card title="Device type">
          {total === 0 ? <span className="ep-nodata">No endpoints enrolled yet</span> : <RankedBars data={deviceTypeData} total={total} />}
        </Card>
        <Card title="Operating system" actions={unknownOsCount > 0 && <Badge tone="med">{unknownOsCount} unclassified</Badge>}>
          {total === 0 ? <span className="ep-nodata">No endpoints enrolled yet</span> : <RankedBars data={osData} tail={osTail} total={total} />}
        </Card>
      </Row>

      {!networkScanHidden && <UnmanagedDevicesCard summary={summary} onOpenNetworkScan={openNetworkScan} />}
    </>
  );
}
