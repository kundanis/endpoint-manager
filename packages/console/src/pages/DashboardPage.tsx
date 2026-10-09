import { useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useDashboardSummary, useIsItemHidden } from "../api/hooks";

// Validated categorical theme (node scripts/validate_palette.js from the dataviz skill):
// this app's own 6 card-accent hues failed as a categorical palette in their original
// order (gold<->green collided under deuteranopia, green<->teal too close for normal
// vision) — green was dropped entirely since it collided with both neighbors regardless
// of ordering; these 5, in this fixed order, pass all checks (light mode, white surface).
const CATEGORICAL_HUES = ["#2a78d6", "#d6532a", "#0d9488", "#7c5fd6", "#b6862a"];
const OTHER_HUE = "var(--offline)";
const MAX_CATEGORICAL_SLICES = 5;

interface DonutDatum {
  name: string;
  value: number;
  color: string;
  // Where clicking this slice (or its legend entry) goes — the module page with the
  // matching filter applied, so the dashboard is a jumping-off point, not a dead end.
  to?: string;
}

function percentOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

// Keyboard activation for the non-button elements below that act as links.
function onActivateKey(go: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go();
    }
  };
}

function DonutChart({ title, data, totalLabel }: { title: string; data: DonutDatum[]; totalLabel: string }) {
  const navigate = useNavigate();
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="panel dashboard-chart-card">
      <h3>{title}</h3>
      {total === 0 ? (
        <p>No data yet.</p>
      ) : (
        <>
          <div className="dashboard-donut-wrap">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={82}
                  paddingAngle={2}
                  stroke="var(--panel-bg)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {data.map((d) => (
                    <Cell
                      key={d.name}
                      fill={d.color}
                      className={d.to ? "dashboard-link" : undefined}
                      onClick={d.to ? () => navigate(d.to!) : undefined}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [`${value} (${percentOf(Number(value), total)}%)`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="dashboard-donut-center">
              <div className="dashboard-donut-center-value">{total}</div>
              <div className="dashboard-donut-center-label">{totalLabel}</div>
            </div>
          </div>
          <ul className="dashboard-legend">
            {data.map((d) =>
              d.to ? (
                <li
                  key={d.name}
                  className="dashboard-link"
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(d.to!)}
                  onKeyDown={onActivateKey(() => navigate(d.to!))}
                >
                  <span className="dashboard-legend-swatch" style={{ background: d.color }} />
                  {d.name} — {d.value} ({percentOf(d.value, total)}%)
                </li>
              ) : (
                <li key={d.name}>
                  <span className="dashboard-legend-swatch" style={{ background: d.color }} />
                  {d.name} — {d.value} ({percentOf(d.value, total)}%)
                </li>
              ),
            )}
          </ul>
        </>
      )}
    </div>
  );
}

// A summary tile that opens `to` on click/Enter; without `to` it's a plain, static tile.
function LinkTile({ label, value, accent = "", to }: { label: string; value: number; accent?: string; to?: string }) {
  const navigate = useNavigate();
  if (!to) {
    return (
      <div className={`tile static ${accent}`}>
        <div className="tile-label">{label}</div>
        <div className="tile-value">{value}</div>
      </div>
    );
  }
  return (
    <div
      className={`tile ${accent}`}
      role="link"
      tabIndex={0}
      onClick={() => navigate(to)}
      onKeyDown={onActivateKey(() => navigate(to))}
    >
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: summary } = useDashboardSummary();
  const [showCoverageDetail, setShowCoverageDetail] = useState(false);
  // Links into Endpoints are dropped (not redirected) when that page is hidden.
  const endpointsHidden = useIsItemHidden("/endpoints");
  const endpointsLink = (query = "") => (endpointsHidden ? undefined : `/endpoints${query}`);
  const vulnerabilitiesHidden = useIsItemHidden("/vulnerabilities");
  const zeroTrustHidden = useIsItemHidden("/zero-trust");
  // Both coverage sections below are built from Network Scan results.
  const networkScanHidden = useIsItemHidden("/network-scan");

  if (!summary) return <p>Loading dashboard…</p>;

  const statusData: DonutDatum[] = [
    { name: "Online", value: summary.onlineCount, color: "var(--online)", to: endpointsLink("?status=ONLINE") },
    { name: "Offline", value: summary.offlineCount, color: "var(--offline)", to: endpointsLink("?status=OFFLINE") },
  ];

  const deviceTypeData: DonutDatum[] = [
    { name: "Laptop", value: summary.deviceTypeCounts.LAPTOP, color: CATEGORICAL_HUES[0], to: endpointsLink("?deviceType=LAPTOP") },
    { name: "Desktop", value: summary.deviceTypeCounts.DESKTOP, color: CATEGORICAL_HUES[1], to: endpointsLink("?deviceType=DESKTOP") },
    { name: "Server", value: summary.deviceTypeCounts.SERVER, color: CATEGORICAL_HUES[2], to: endpointsLink("?deviceType=SERVER") },
  ];
  const osLink = (label: string) => endpointsLink(`?os=${encodeURIComponent(label)}`);

  // Fixed alphabetical order (not by count) so an OS's color never shifts just because
  // its rank changed — "color follows the entity, never its rank." Beyond the validated
  // 5-slice categorical cap, the tail folds into "Other" rather than generating a 6th hue.
  const sortedOs = [...summary.osCounts].sort((a, b) => a.label.localeCompare(b.label));
  const osData: DonutDatum[] =
    sortedOs.length <= MAX_CATEGORICAL_SLICES
      ? sortedOs.map((o, i) => ({ name: o.label, value: o.count, color: CATEGORICAL_HUES[i], to: osLink(o.label) }))
      : [
          ...sortedOs
            .slice(0, MAX_CATEGORICAL_SLICES - 1)
            .map((o, i) => ({ name: o.label, value: o.count, color: CATEGORICAL_HUES[i], to: osLink(o.label) })),
          {
            // Several OSes folded together — no single filter matches, so the full list.
            name: "Other",
            value: sortedOs.slice(MAX_CATEGORICAL_SLICES - 1).reduce((sum, o) => sum + o.count, 0),
            color: OTHER_HUE,
            to: endpointsLink(),
          },
        ];

  // Trust is per policy on the Zero Trust page; "Not assessed" means no enabled policy
  // covers the endpoint, so it opens the page itself (where policies get assigned).
  const trustData: DonutDatum[] = [
    { name: "Trusted", value: summary.trustSummary.trusted, color: "var(--online)", to: "/zero-trust?trust=trusted" },
    { name: "Not trusted", value: summary.trustSummary.notTrusted, color: "var(--danger)", to: "/zero-trust?trust=not-trusted" },
    { name: "Not assessed", value: summary.trustSummary.notAssigned, color: "var(--offline)", to: "/zero-trust" },
  ];

  // "Has vulnerabilities" opens the CVE list (where remediation happens); "Clean" has no
  // CVEs to show, so it lists the clean endpoints instead.
  const vulnerabilityData: DonutDatum[] = [
    { name: "Clean", value: summary.vulnerabilitySummary.clean, color: "var(--online)", to: endpointsLink("?vuln=none") },
    {
      name: "Has vulnerabilities",
      value: summary.vulnerabilitySummary.withVulnerabilities,
      color: "var(--danger)",
      to: "/vulnerabilities",
    },
  ];

  const scannedVlans = summary.networkDeviceSummary.filter((v) => v.hasScan);

  return (
    <div>
      <h1>Dashboard</h1>

      <div className="tiles">
        <LinkTile label="Total endpoints" value={summary.totalAgents} to={endpointsLink()} />
        <LinkTile label="Online" value={summary.onlineCount} accent="accent-good" to={endpointsLink("?status=ONLINE")} />
        {!vulnerabilitiesHidden && (
          // The endpoints that have open findings, each with its own count.
          <LinkTile
            label="With vulnerabilities"
            value={summary.vulnerabilitySummary.withVulnerabilities}
            accent={summary.vulnerabilitySummary.withVulnerabilities > 0 ? "accent-critical" : "accent-good"}
            to={endpointsLink("?vuln=open")}
          />
        )}
        {!zeroTrustHidden && (
          <LinkTile
            label="Trusted"
            value={summary.trustSummary.trusted}
            accent="accent-good"
            to="/zero-trust?trust=trusted"
          />
        )}
      </div>

      <div className="dashboard-chart-grid">
        <DonutChart title="Online vs offline" data={statusData} totalLabel="Endpoints" />
        <DonutChart title="Device type" data={deviceTypeData} totalLabel="Endpoints" />
        <DonutChart title="Operating system" data={osData} totalLabel="Endpoints" />
        {!zeroTrustHidden && <DonutChart title="Zero Trust status" data={trustData} totalLabel="Endpoints" />}
        {!vulnerabilitiesHidden && (
          <DonutChart title="Vulnerability exposure" data={vulnerabilityData} totalLabel="Endpoints" />
        )}
      </div>

      {!networkScanHidden && (
        <>
          <h2>Agent coverage</h2>
          <p>
            Agents installed (enrolled endpoints) vs. endpoints seen by a Network Scan — the gap is unmanaged network
            devices (routers, printers, unenrolled PCs) or endpoints on an un-scanned VLAN. Click a tile for the
            breakdown.
          </p>
          <div className="tiles">
            <div
              className="tile static clickable-row"
              onClick={() => setShowCoverageDetail((v) => !v)}
            >
              <div className="tile-label">Agents installed</div>
              <div className="tile-value">{summary.agentCoverage.agentsInstalled}</div>
            </div>
            <div
              className="tile static clickable-row"
              onClick={() => setShowCoverageDetail((v) => !v)}
            >
              <div className="tile-label">Discovered by network scan</div>
              <div className="tile-value">{summary.agentCoverage.discoveredByNetworkScan}</div>
            </div>
            <div
              className={`tile static clickable-row ${summary.agentCoverage.notInstalled > 0 ? "accent-critical" : "accent-good"}`}
              onClick={() => setShowCoverageDetail((v) => !v)}
            >
              <div className="tile-label">Not installed (unmanaged)</div>
              <div className="tile-value">{summary.agentCoverage.notInstalled}</div>
            </div>
          </div>

          {showCoverageDetail && (
            <div className="panel">
              <h3>By VLAN</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>VLAN</th>
                    <th>Scanned</th>
                    <th>Total hosts</th>
                    <th>Managed (agent installed)</th>
                    <th>Unmanaged</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.networkDeviceSummary.map((v) => (
                    <tr key={v.vlanId}>
                      <td>{v.vlanName}</td>
                      <td>{v.hasScan ? "Yes" : "Not yet scanned"}</td>
                      <td>{v.total}</td>
                      <td>{v.managed}</td>
                      <td>{v.unmanaged}</td>
                    </tr>
                  ))}
                  {summary.networkDeviceSummary.length === 0 && (
                    <tr>
                      <td colSpan={5}>No VLANs defined yet — set one up on the Network Scan page.</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <h3>Installed agents by asset type</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Laptop</th>
                    <th>Desktop</th>
                    <th>Server</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{summary.deviceTypeCounts.LAPTOP}</td>
                    <td>{summary.deviceTypeCounts.DESKTOP}</td>
                    <td>{summary.deviceTypeCounts.SERVER}</td>
                  </tr>
                </tbody>
              </table>

              <h3>Not installed — device details</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>VLAN</th>
                    <th>IP address</th>
                    <th>MAC address</th>
                    <th>Hostname</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.unmanagedHosts.map((h) => (
                    <tr key={`${h.vlanName}-${h.ipAddress}`}>
                      <td>{h.vlanName}</td>
                      <td className="mono-cell">{h.ipAddress}</td>
                      <td className="mono-cell">{h.macAddress ?? "—"}</td>
                      <td>{h.hostname ?? "—"}</td>
                    </tr>
                  ))}
                  {summary.unmanagedHosts.length === 0 && (
                    <tr>
                      <td colSpan={4}>No unmanaged devices found on any scanned VLAN.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <h2>Network coverage by VLAN</h2>
          <p>Managed = hosts matched to an enrolled agent from that VLAN's latest scan. Unmanaged hosts are unenrolled network devices (routers, printers, etc.).</p>
          {scannedVlans.length === 0 ? (
            <p>No VLAN has been scanned yet — set one up on the Network Scan page.</p>
          ) : (
            <div className="dashboard-chart-grid">
              {scannedVlans.map((v) => (
                <DonutChart
                  key={v.vlanId}
                  title={v.vlanName}
                  totalLabel="Hosts"
                  data={[
                    { name: "Managed", value: v.managed, color: "var(--online)", to: "/network-scan" },
                    { name: "Unmanaged (network device)", value: v.unmanaged, color: "var(--warn)", to: "/network-scan" },
                  ]}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
