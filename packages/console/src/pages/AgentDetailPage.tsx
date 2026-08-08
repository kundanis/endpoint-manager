import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import Collapsible from "../components/Collapsible";
import StatusBadge from "../components/StatusBadge";
import type { AgentDetail, InstalledSoftwareEntry, LifecycleStatus } from "../api/types";
import {
  useAddAgentNote,
  useAgent,
  useAgentAppControlEvents,
  useAgentCommandBlockEvents,
  useAgentDataDiscoveryFindings,
  useAgentDataMovementEvents,
  useAgentDlpEvents,
  useAgentNotes,
  useAgentSecurityFindings,
  useAgentUsbControlEvents,
  useAgentUserSessions,
  useAgentZeroTrustFindings,
  useAssetGroups,
  useCustomFieldDefinitions,
  useDisableRemoteAccess,
  useEnableRemoteAccess,
  useRemediateAllForAgent,
  useRemediateSecurityRule,
  useSetAgentCustomFields,
  useSetAgentGroups,
  useSetAgentLifecycle,
  useSetAssetDetails,
  useUninstallAgent,
  useUninstallSoftware,
} from "../api/hooks";

const LIFECYCLE_OPTIONS: LifecycleStatus[] = ["ACTIVE", "IN_REPAIR", "RETIRED", "IN_STORAGE"];
const DEVICE_TYPE_LABEL: Record<"LAPTOP" | "DESKTOP" | "SERVER", string> = {
  LAPTOP: "Laptop",
  DESKTOP: "Desktop",
  SERVER: "Server",
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function AssetDetailsForm({ agent }: { agent: AgentDetail }) {
  const inv = agent.inventory;
  const setLifecycle = useSetAgentLifecycle();
  const setDetails = useSetAssetDetails();
  const [serialNumber, setSerialNumber] = useState(agent.serialNumber ?? "");
  const [vendor, setVendor] = useState(agent.vendor ?? "");
  const [purchaseDate, setPurchaseDate] = useState(toDateInputValue(agent.purchaseDate));
  const [warrantyExpiryDate, setWarrantyExpiryDate] = useState(toDateInputValue(agent.warrantyExpiryDate));
  const [location, setLocation] = useState(agent.location ?? "");

  useEffect(() => {
    setSerialNumber(agent.serialNumber ?? "");
    setVendor(agent.vendor ?? "");
    setPurchaseDate(toDateInputValue(agent.purchaseDate));
    setWarrantyExpiryDate(toDateInputValue(agent.warrantyExpiryDate));
    setLocation(agent.location ?? "");
  }, [agent.serialNumber, agent.vendor, agent.purchaseDate, agent.warrantyExpiryDate, agent.location]);

  const isWarrantyExpired = agent.warrantyExpiryDate ? new Date(agent.warrantyExpiryDate) < new Date() : false;
  const geoHint = agent.ipGeoHint;
  const geoHintLabel = geoHint ? [geoHint.city, geoHint.region, geoHint.country].filter(Boolean).join(", ") : null;

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setDetails.mutate({
      agentId: agent.id,
      serialNumber: serialNumber.trim() || null,
      vendor: vendor.trim() || null,
      purchaseDate: purchaseDate || null,
      warrantyExpiryDate: warrantyExpiryDate || null,
      location: location.trim() || null,
    });
  }

  return (
    <Collapsible title="Asset details">
      <div className="detail-grid">
        <div>
          <strong>OS</strong>
          <div>
            {agent.osPlatform} {agent.osVersion} ({agent.osArch})
          </div>
        </div>
        <div>
          <strong>Endpoint version</strong>
          <div>{agent.agentVersion}</div>
        </div>
        <div>
          <strong>Logged-in user</strong>
          <div>{inv?.lastLoggedOnUser ?? "—"}</div>
        </div>
        <div>
          <strong>IP address</strong>
          <div>{agent.ipAddress ?? "—"}</div>
        </div>
        <div>
          <strong>MAC address</strong>
          <div className="mono-cell">{agent.macAddress ?? "—"}</div>
        </div>
        <div>
          <strong>Last check-in</strong>
          <div>{agent.lastCheckinAt ? new Date(agent.lastCheckinAt).toLocaleString() : "never"}</div>
        </div>
        <div>
          <strong>Last patch installed</strong>
          <div>{agent.lastPatchInstalledAt ? new Date(agent.lastPatchInstalledAt).toLocaleString() : "never"}</div>
        </div>
        <div>
          <strong>Processor</strong>
          <div>
            {inv?.cpuModel ?? "—"}
            {inv?.cpuSpeedGhz ? ` @ ${inv.cpuSpeedGhz} GHz` : ""}
            {" — "}
            {inv?.cpuPhysicalCores ?? "?"} physical / {inv?.cpuCores ?? "?"} logical cores
          </div>
        </div>
        <div>
          <strong>Memory</strong>
          <div>
            {formatBytes(inv?.totalMemBytes ? Number(inv.totalMemBytes) : null)}
            {inv && inv.memLayout.length > 0 && (
              <span>
                {" "}
                (
                {inv.memLayout
                  .map((m) => `${formatBytes(m.sizeBytes ? Number(m.sizeBytes) : null)} ${m.type ?? ""}`.trim())
                  .join(" + ")}
                )
              </span>
            )}
          </div>
        </div>
        {inv?.battery?.present ? (
          <>
            <div>
              <strong>Battery health</strong>
              <div>
                <StatusBadge
                  kind={batteryStatusBadgeKind(inv.battery.healthStatus)}
                  label={`${inv.battery.healthStatus}${inv.battery.healthPercent !== null ? ` (${inv.battery.healthPercent}%)` : ""}`}
                />
              </div>
            </div>
            <div>
              <strong>Battery capacity</strong>
              <div>
                {inv.battery.fullChargeCapacityMwh ? `${(inv.battery.fullChargeCapacityMwh / 1000).toFixed(1)} Wh` : "—"}
                {inv.battery.designCapacityMwh ? ` of ${(inv.battery.designCapacityMwh / 1000).toFixed(1)} Wh design` : ""}
              </div>
            </div>
            <div>
              <strong>Battery cycles</strong>
              <div>{inv.battery.cycleCount ?? "Not reported by this device"}</div>
            </div>
          </>
        ) : (
          <div>
            <strong>Battery</strong>
            <div>{inv ? "Not present (desktop or VM)" : "—"}</div>
          </div>
        )}
        <div>
          <strong>OS license</strong>
          <div>
            {inv?.osLicenseStatus ?? "—"}
            {inv?.osLicenseChannel ? ` (${inv.osLicenseChannel})` : ""}
            {inv?.osPartialProductKey ? ` — ...${inv.osPartialProductKey}` : ""}
          </div>
        </div>
        <div>
          <strong>OS end of support</strong>
          <div>
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
          </div>
        </div>
        <div>
          <strong>Lifecycle status</strong>
          <div>
            <select
              value={agent.lifecycleStatus}
              onChange={(e) => setLifecycle.mutate({ agentId: agent.id, lifecycleStatus: e.target.value })}
            >
              {LIFECYCLE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <strong>Device type</strong>
          <div>
            <select
              value={agent.deviceTypeOverride ?? "AUTO"}
              onChange={(e) =>
                setDetails.mutate({
                  agentId: agent.id,
                  deviceTypeOverride: e.target.value === "AUTO" ? null : (e.target.value as "LAPTOP" | "DESKTOP" | "SERVER"),
                })
              }
            >
              <option value="AUTO">Auto-detected ({DEVICE_TYPE_LABEL[agent.deviceType]})</option>
              <option value="LAPTOP">Laptop</option>
              <option value="DESKTOP">Desktop</option>
              <option value="SERVER">Server</option>
            </select>
          </div>
        </div>
      </div>

      <h3>Ownership &amp; warranty</h3>
      <form onSubmit={handleSave}>
        <div className="detail-grid">
          <label>
            Location
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Mumbai HQ - 3rd Floor"
            />
            {geoHintLabel && !agent.location && (
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>(detected: {geoHintLabel} via IP)</span>
            )}
          </label>
          <label>
            Serial number
            <input type="text" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
          </label>
          <label>
            Vendor
            <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </label>
          <label>
            Purchase date
            <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </label>
          <label>
            Warranty expiry
            <input type="date" value={warrantyExpiryDate} onChange={(e) => setWarrantyExpiryDate(e.target.value)} />
          </label>
          {agent.warrantyExpiryDate && (
            <div>
              <strong>Warranty status</strong>
              <div>
                <span className={`status-badge ${isWarrantyExpired ? "danger" : "online"}`}>
                  {isWarrantyExpired ? "Expired" : "Active"}
                </span>
              </div>
            </div>
          )}
        </div>
        <button type="submit" disabled={setDetails.isPending}>
          {setDetails.isPending ? "Saving…" : "Save asset details"}
        </button>
      </form>
    </Collapsible>
  );
}

function StoragePanel({ agent }: { agent: AgentDetail }) {
  const inv = agent.inventory;

  return (
    <Collapsible title="Storage">
      <p>
        Total physical storage:{" "}
        {inv?.totalDiskBytes
          ? `${formatBytes(Number(inv.totalDiskBytes))}${inv.diskTypes.length > 0 ? ` (${inv.diskTypes.join(" + ")})` : ""}`
          : "—"}
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Volume</th>
            <th>Filesystem</th>
            <th>Size</th>
            <th>Used</th>
            <th>Free</th>
            <th>Use %</th>
          </tr>
        </thead>
        <tbody>
          {inv?.diskVolumes.map((v) => (
            <tr key={v.mount}>
              <td>{v.mount}</td>
              <td>{v.fsType ?? "—"}</td>
              <td>{formatBytes(v.sizeBytes ? Number(v.sizeBytes) : null)}</td>
              <td>{formatBytes(v.usedBytes ? Number(v.usedBytes) : null)}</td>
              <td>{formatBytes(v.availableBytes ? Number(v.availableBytes) : null)}</td>
              <td>{v.usePercent !== null ? `${v.usePercent}%` : "—"}</td>
            </tr>
          ))}
          {(!inv || inv.diskVolumes.length === 0) && (
            <tr>
              <td colSpan={6}>No volume data reported yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </Collapsible>
  );
}

function batteryStatusBadgeKind(status: "GOOD" | "DEGRADED" | "REPLACE" | "UNKNOWN"): "pass" | "warn" | "fail" {
  if (status === "GOOD") return "pass";
  if (status === "REPLACE") return "fail";
  return "warn"; // DEGRADED and UNKNOWN both render as a caution color, not a hard failure
}

function CustomFieldsForm({ agentId, values }: { agentId: string; values: { fieldDefinitionId: string; value: string }[] }) {
  const { data: definitions } = useCustomFieldDefinitions();
  const setValues = useSetAgentCustomFields();
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const v of values) initial[v.fieldDefinitionId] = v.value;
    setDraft(initial);
  }, [values]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setValues.mutate({
      agentId,
      values: Object.entries(draft).map(([fieldDefinitionId, value]) => ({ fieldDefinitionId, value })),
    });
  }

  if (!definitions || definitions.length === 0) return null;

  return (
    <Collapsible title="Custom fields">
      <form onSubmit={handleSave}>
        {definitions.map((def) => (
          <label key={def.id}>
            {def.name}
            {def.fieldType === "SELECT" ? (
              <select
                value={draft[def.id] ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [def.id]: e.target.value }))}
              >
                <option value="">—</option>
                {def.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={def.fieldType === "NUMBER" ? "number" : def.fieldType === "DATE" ? "date" : "text"}
                value={draft[def.id] ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [def.id]: e.target.value }))}
              />
            )}
          </label>
        ))}
        <button type="submit" disabled={setValues.isPending}>
          {setValues.isPending ? "Saving…" : "Save custom fields"}
        </button>
      </form>
    </Collapsible>
  );
}

function GroupMembershipEditor({ agentId, currentGroupIds }: { agentId: string; currentGroupIds: string[] }) {
  const { data: groups } = useAssetGroups();
  const setGroups = useSetAgentGroups();
  const [selected, setSelected] = useState<string[]>(currentGroupIds);

  useEffect(() => setSelected(currentGroupIds), [currentGroupIds]);

  function toggle(groupId: string) {
    setSelected((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  if (!groups || groups.length === 0) return null;

  return (
    <div className="panel">
      <h2>Group membership</h2>
      <fieldset>
        {groups.map((g) => (
          <label key={g.id} className="checkbox-row">
            <input type="checkbox" checked={selected.includes(g.id)} onChange={() => toggle(g.id)} />
            {g.name}
          </label>
        ))}
      </fieldset>
      <button type="button" onClick={() => setGroups.mutate({ agentId, groupIds: selected })} disabled={setGroups.isPending}>
        {setGroups.isPending ? "Saving…" : "Save groups"}
      </button>
    </div>
  );
}

type LicenseFilter = "ALL" | "LICENSED" | "UNLICENSED";

function InstalledSoftwareSection({ agentId, software }: { agentId: string; software: InstalledSoftwareEntry[] }) {
  const uninstall = useUninstallSoftware();
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [publisherFilter, setPublisherFilter] = useState("");
  const [licenseFilter, setLicenseFilter] = useState<LicenseFilter>("ALL");

  const publishers = [...new Set(software.map((s) => s.publisher).filter((p): p is string => Boolean(p)))].sort();

  const filtered = software.filter((s) => {
    if (nameFilter && !s.name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
    if (publisherFilter && s.publisher !== publisherFilter) return false;
    if (licenseFilter === "LICENSED" && !s.licensed) return false;
    if (licenseFilter === "UNLICENSED" && s.licensed) return false;
    return true;
  });

  function handleUninstall(name: string) {
    const confirmed = window.confirm(
      `Uninstall "${name}" from this endpoint?\n\n` +
        "This runs the software's own uninstaller unattended. MSI-based installs run fully silently; " +
        "other installers run whatever uninstall command is registered, which may not support a silent flag " +
        "and could hang waiting for input nobody is there to give. Check the Commands page to confirm it completed.",
    );
    if (!confirmed) return;
    setPendingName(name);
    uninstall.mutate({ agentId, softwareName: name }, { onSettled: () => setPendingName(null) });
  }

  return (
    <Collapsible title={`Installed software (${software.length})`}>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", marginBottom: "1rem", flexWrap: "wrap" }}>
        <label>
          Name
          <input
            type="text"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="Filter by name…"
          />
        </label>
        <label>
          Publisher
          <select value={publisherFilter} onChange={(e) => setPublisherFilter(e.target.value)}>
            <option value="">All publishers</option>
            {publishers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          License status
          <select value={licenseFilter} onChange={(e) => setLicenseFilter(e.target.value as LicenseFilter)}>
            <option value="ALL">All</option>
            <option value="LICENSED">Licensed</option>
            <option value="UNLICENSED">Not licensed</option>
          </select>
        </label>
        {(nameFilter || publisherFilter || licenseFilter !== "ALL") && (
          <button
            type="button"
            onClick={() => {
              setNameFilter("");
              setPublisherFilter("");
              setLicenseFilter("ALL");
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      <p className="hint">
        "Licensed" is a heuristic name-match against records on the Software Licenses page, not a verified
        entitlement check — a match confirms a license record exists for something with a similar name, nothing more.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Version</th>
            <th>Publisher</th>
            <th>License</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s, i) => (
            <tr key={i}>
              <td>{s.name}</td>
              <td>{s.version ?? "—"}</td>
              <td>{s.publisher ?? "—"}</td>
              <td>
                {s.licensed ? (
                  <StatusBadge kind="pass" label="Licensed" />
                ) : (
                  <StatusBadge kind="warn" label="Not licensed" />
                )}
              </td>
              <td>
                <button type="button" onClick={() => handleUninstall(s.name)} disabled={pendingName === s.name}>
                  {pendingName === s.name ? "Dispatching…" : "Uninstall"}
                </button>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={5}>{software.length === 0 ? "No inventory reported yet." : "No software matches these filters."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </Collapsible>
  );
}

function NotesFeed({ agentId }: { agentId: string }) {
  const { data: notes } = useAgentNotes(agentId);
  const addNote = useAddAgentNote();
  const [body, setBody] = useState("");

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    addNote.mutate({ agentId, body }, { onSuccess: () => setBody("") });
  }

  return (
    <div className="panel">
      <h2>Notes</h2>
      {notes?.map((n) => (
        <div key={n.id} style={{ marginBottom: "0.75rem" }}>
          <div className="mono-cell">{n.body}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {n.createdByAdminEmail} — {new Date(n.createdAt).toLocaleString()}
          </div>
        </div>
      ))}
      {notes?.length === 0 && <p>No notes yet.</p>}

      <form onSubmit={handleAdd}>
        <label>
          Add note
          <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <button type="submit" disabled={addNote.isPending || !body.trim()}>
          {addNote.isPending ? "Adding…" : "Add note"}
        </button>
      </form>
    </div>
  );
}

function securityStatusBadgeClass(status: "PASS" | "FAIL" | "ERROR"): string {
  if (status === "PASS") return "online";
  if (status === "ERROR") return "warn";
  return "danger";
}

// Zero Trust findings are displayed as "Compliant"/"Non-compliant" rather than
// "Pass"/"Fail" — the same underlying PASS/FAIL/ERROR status is shared with
// Security Configuration, this is a Zero-Trust-specific display label only.
function zeroTrustStatusLabel(status: "PASS" | "FAIL" | "ERROR"): string {
  if (status === "PASS") return "Compliant";
  if (status === "ERROR") return "Error";
  return "Non-compliant";
}

function SecurityFindingsSection({ agentId }: { agentId: string }) {
  const { data: findings } = useAgentSecurityFindings(agentId);
  const remediate = useRemediateSecurityRule();
  const remediateAll = useRemediateAllForAgent();
  const [remediatingRuleId, setRemediatingRuleId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ ruleId: string; jobId?: string; error?: string } | null>(null);

  function handleRemediate(ruleId: string) {
    setRemediatingRuleId(ruleId);
    setLastResult(null);
    remediate.mutate(
      { ruleId, agentId },
      {
        onSuccess: (result) => setLastResult({ ruleId, jobId: result.jobId }),
        onError: (err) => setLastResult({ ruleId, error: (err as Error).message }),
        onSettled: () => setRemediatingRuleId(null),
      },
    );
  }

  if (!findings || findings.length === 0) return null;

  const remediableFailCount = findings.filter((f) => f.status === "FAIL" && f.hasRemediation).length;
  const passCount = findings.filter((f) => f.status === "PASS").length;
  const failCount = findings.filter((f) => f.status === "FAIL").length;
  const errorCount = findings.filter((f) => f.status === "ERROR").length;

  return (
    <Collapsible title={`Security configuration (${passCount} pass / ${failCount} fail / ${errorCount} error)`}>
      {remediableFailCount > 0 && (
        <p>
          <button type="button" onClick={() => remediateAll.mutate(agentId)} disabled={remediateAll.isPending}>
            {remediateAll.isPending ? "Remediating…" : `Remediate all (${remediableFailCount})`}
          </button>
          {remediateAll.isSuccess && (
            <span style={{ marginLeft: "0.5rem" }}>
              Dispatched {remediateAll.data.remediatedCount} remediation job(s)
              {remediateAll.data.skippedCount > 0 ? ` — ${remediateAll.data.skippedCount} failing rule(s) had no remediation script` : ""}.
            </span>
          )}
          {remediateAll.isError && <span className="error-text"> {(remediateAll.error as Error).message}</span>}
        </p>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>Benchmark</th>
            <th>Rule</th>
            <th>Status</th>
            <th>Expected</th>
            <th>Actual</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr key={f.id}>
              <td>{f.benchmarkName}</td>
              <td>{f.title}</td>
              <td>
                <span className={`status-badge ${securityStatusBadgeClass(f.status)}`}>{f.status}</span>
              </td>
              <td className="mono-cell">{f.expectedValue}</td>
              <td className="mono-cell">{f.actualValue ?? "—"}</td>
              <td>
                {f.status === "FAIL" && f.hasRemediation && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleRemediate(f.ruleId)}
                      disabled={remediate.isPending && remediatingRuleId === f.ruleId}
                    >
                      {remediate.isPending && remediatingRuleId === f.ruleId ? "Remediating…" : "Remediate"}
                    </button>
                    {lastResult?.ruleId === f.ruleId && lastResult.jobId && (
                      <div style={{ fontSize: "0.8rem" }}>
                        Queued (job {lastResult.jobId.slice(0, 8)}) — runs on the agent's next check-in, status appears
                        on the <Link to="/commands">Commands</Link> page; this rule re-grades on the next security scan.
                      </div>
                    )}
                    {lastResult?.ruleId === f.ruleId && lastResult.error && (
                      <div className="error-text" style={{ fontSize: "0.8rem" }}>
                        {lastResult.error}
                      </div>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Collapsible>
  );
}

function ZeroTrustFindingsSection({ agentId }: { agentId: string }) {
  const { data: findings } = useAgentZeroTrustFindings(agentId);

  if (!findings || findings.length === 0) return null;

  const passCount = findings.filter((f) => f.status === "PASS").length;
  const failCount = findings.filter((f) => f.status === "FAIL").length;
  const errorCount = findings.filter((f) => f.status === "ERROR").length;
  const policyNames = [...new Set(findings.map((f) => f.policyName))];
  const trusted = failCount === 0 && errorCount === 0;

  return (
    <Collapsible title={`Zero Trust (${passCount} compliant / ${failCount} non-compliant / ${errorCount} error)`}>
      {policyNames.map((policyName) => (
        <p key={policyName}>
          {policyName}: <span className={`status-badge ${trusted ? "online" : "danger"}`}>{trusted ? "Trusted" : "Not trusted"}</span>
        </p>
      ))}
      <table className="data-table">
        <thead>
          <tr>
            <th>Policy</th>
            <th>Condition</th>
            <th>Status</th>
            <th>Expected</th>
            <th>Actual</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr key={f.id}>
              <td>{f.policyName}</td>
              <td>{f.title}</td>
              <td>
                <span className={`status-badge ${securityStatusBadgeClass(f.status)}`}>{zeroTrustStatusLabel(f.status)}</span>
              </td>
              <td className="mono-cell">{f.expectedValue}</td>
              <td className="mono-cell">{f.actualValue ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Collapsible>
  );
}

function DataDiscoveryFindingsSection({ agentId }: { agentId: string }) {
  const { data: findings } = useAgentDataDiscoveryFindings(agentId);

  if (!findings || findings.length === 0) return null;

  return (
    <Collapsible title={`Data Discovery (${findings.length} file${findings.length === 1 ? "" : "s"} with personal data)`}>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
        Samples below are masked previews (e.g. "••••••••6789") — the unmasked value never leaves the endpoint.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Policy</th>
            <th>File</th>
            <th>Matched patterns</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr key={f.id}>
              <td>{f.policyName}</td>
              <td className="mono-cell">{f.filePath}</td>
              <td>
                {f.matches.map((m) => (
                  <div key={m.label} style={{ marginBottom: "0.5rem" }}>
                    <span className="status-badge danger">
                      {m.label} ({m.count})
                    </span>
                    {m.samples.length > 0 && (
                      <div className="mono-cell" style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                        {m.samples.join(", ")}
                        {m.count > m.samples.length ? ` (+${m.count - m.samples.length} more)` : ""}
                      </div>
                    )}
                  </div>
                ))}
              </td>
              <td>{new Date(f.lastSeenAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Collapsible>
  );
}

function DlpEventsSection({ agentId }: { agentId: string }) {
  const { data: events } = useAgentDlpEvents(agentId);

  if (!events || events.length === 0) return null;

  const blockedCount = events.filter((e) => e.action === "BLOCKED").length;

  return (
    <Collapsible title={`DLP (${events.length} event${events.length === 1 ? "" : "s"}, ${blockedCount} blocked)`}>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
        Samples below are masked previews — the unmasked value never leaves the endpoint.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Policy</th>
            <th>File</th>
            <th>Process</th>
            <th>Removable media</th>
            <th>Action</th>
            <th>Matched rules</th>
            <th>Occurred</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.policyName}</td>
              <td className="mono-cell">{e.filePath}</td>
              <td>{e.processName ?? "—"}</td>
              <td>{e.destinationIsRemovable ? "Yes" : "No"}</td>
              <td>
                <span className={`status-badge ${e.action === "BLOCKED" ? "danger" : "warn"}`}>{e.action}</span>
              </td>
              <td>
                {e.matches.map((m, i) => (
                  <div key={`${m.label}-${i}`} style={{ marginBottom: "0.3rem" }}>
                    <span className="status-badge danger">{m.label}</span>
                    {m.samples.length > 0 && (
                      <div className="mono-cell" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        {m.samples.join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </td>
              <td>{new Date(e.occurredAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Collapsible>
  );
}

const DATA_MOVEMENT_CHANNEL_LABEL: Record<string, string> = {
  USB: "USB / removable media",
  CLOUD_SYNC: "Cloud sync",
  NETWORK_SHARE: "Network share",
};

function formatChannelDetail(channel: string, detail: Record<string, string | null>): string {
  if (channel === "USB") {
    const parts = [detail.driveLetter, detail.volumeLabel, detail.serialNumber ? `serial ${detail.serialNumber}` : null];
    return parts.filter(Boolean).join(" — ") || "—";
  }
  if (channel === "NETWORK_SHARE") return detail.uncPath || "—";
  return detail.provider || "—";
}

function DataMovementEventsSection({ agentId }: { agentId: string }) {
  const { data: events } = useAgentDataMovementEvents(agentId);

  if (!events || events.length === 0) return null;

  return (
    <Collapsible title={`Data Movement (${events.length} event${events.length === 1 ? "" : "s"})`}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Policy</th>
            <th>File</th>
            <th>Channel</th>
            <th>Destination</th>
            <th>File modified</th>
            <th>Detected</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.policyName}</td>
              <td className="mono-cell">{e.filePath}</td>
              <td>
                <span className="status-badge warn">{DATA_MOVEMENT_CHANNEL_LABEL[e.channel] ?? e.channel}</span>
              </td>
              <td className="mono-cell">{formatChannelDetail(e.channel, e.channelDetail)}</td>
              <td>{new Date(e.fileModifiedAt).toLocaleString()}</td>
              <td>{new Date(e.detectedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Collapsible>
  );
}

function UserSessionsSection({ agentId }: { agentId: string }) {
  const { data: sessions } = useAgentUserSessions(agentId);

  if (!sessions || sessions.length === 0) return null;

  return (
    <Collapsible title={`User Productivity (${sessions.length} session${sessions.length === 1 ? "" : "s"})`}>
      <table className="data-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Login</th>
            <th>Logout</th>
            <th>Active</th>
            <th>Idle</th>
            <th>Total on endpoint</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>{s.username}</td>
              <td>{new Date(s.loginAt).toLocaleString()}</td>
              <td>{s.logoutAt ? new Date(s.logoutAt).toLocaleString() : "—"}</td>
              <td>{formatDuration(s.activeSecondsTotal)}</td>
              <td>{formatDuration(s.idleSecondsTotal)}</td>
              <td>{formatDuration(s.activeSecondsTotal + s.idleSecondsTotal)}</td>
              <td>
                {s.isActive ? (
                  <StatusBadge kind="pass" label="Active" />
                ) : (
                  <StatusBadge kind="warn" label="Logged out" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Collapsible>
  );
}

function AppControlEventsSection({ agentId }: { agentId: string }) {
  const { data: events } = useAgentAppControlEvents(agentId);

  if (!events || events.length === 0) return null;

  return (
    <Collapsible title={`Application Control (${events.length} event${events.length === 1 ? "" : "s"})`}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Rule</th>
            <th>Path</th>
            <th>Process</th>
            <th>Occurred</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.ruleLabel ?? "—"}</td>
              <td className="mono-cell">{e.matchedPath ?? "—"}</td>
              <td>{e.processName ?? "—"}</td>
              <td>{new Date(e.occurredAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Collapsible>
  );
}

function CommandBlockEventsSection({ agentId }: { agentId: string }) {
  const { data: events } = useAgentCommandBlockEvents(agentId);

  if (!events || events.length === 0) return null;

  return (
    <Collapsible title={`Command Blocking (${events.length} event${events.length === 1 ? "" : "s"})`}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Rule</th>
            <th>Command line</th>
            <th>Process</th>
            <th>Action</th>
            <th>Occurred</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.ruleLabel ?? "—"}</td>
              <td className="mono-cell">{e.matchedCommandLine}</td>
              <td>{e.processName ?? "—"}</td>
              <td>
                {e.action === "BLOCKED" ? (
                  <StatusBadge kind="fail" label="Blocked" />
                ) : (
                  <StatusBadge kind="pass" label="Alerted" />
                )}
              </td>
              <td>{new Date(e.occurredAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Collapsible>
  );
}

function UsbControlEventsSection({ agentId }: { agentId: string }) {
  const { data: events } = useAgentUsbControlEvents(agentId);

  if (!events || events.length === 0) return null;

  return (
    <Collapsible title={`USB Device Control (${events.length} event${events.length === 1 ? "" : "s"})`}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Serial number</th>
            <th>Device</th>
            <th>Action</th>
            <th>Occurred</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="mono-cell">{e.serialNumber}</td>
              <td>{e.deviceDescription ?? "—"}</td>
              <td>{e.action}</td>
              <td>{new Date(e.occurredAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Collapsible>
  );
}

function downloadRdpFile(hostname: string, ipAddress: string) {
  const content = [`full address:s:${ipAddress}:3389`, `prompt for credentials:i:1`, ""].join("\r\n");
  const blob = new Blob([content], { type: "application/rtf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${hostname}.rdp`;
  a.click();
  URL.revokeObjectURL(url);
}

function RemoteAccessPanel({ agent }: { agent: AgentDetail }) {
  const enable = useEnableRemoteAccess();
  const disable = useDisableRemoteAccess();

  function handleEnable() {
    const confirmed = window.confirm(
      `Enable Remote Desktop on ${agent.hostname}?\n\nThis opens port 3389 to your current IP address only, and remains ` +
        `open until you disable it. The endpoint must be online to pick up the command.`,
    );
    if (!confirmed) return;
    enable.mutate(agent.id);
  }

  function handleDisable() {
    const confirmed = window.confirm(`Disable Remote Desktop on ${agent.hostname}?`);
    if (!confirmed) return;
    disable.mutate(agent.id);
  }

  return (
    <Collapsible title="Remote access">
      <p>
        Enable Remote Desktop on this endpoint, scoped to a firewall exception for your current IP address only.
        Requires the endpoint to be online to pick up the command, and your machine to be able to reach it directly
        (same LAN or VPN) — this does not work through NAT with no inbound path.
      </p>
      <div className="detail-grid">
        <div>
          <strong>Status</strong>
          <span className={`status-badge ${agent.remoteAccessEnabled ? "online" : "offline"}`}>
            {agent.remoteAccessEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        {agent.remoteAccessEnabled && (
          <>
            <div>
              <strong>Enabled since</strong>
              {agent.remoteAccessEnabledAt ? new Date(agent.remoteAccessEnabledAt).toLocaleString() : "—"}
            </div>
            <div>
              <strong>Allowed IP</strong>
              <span className="mono-cell">{agent.remoteAccessAllowedIp ?? "—"}</span>
            </div>
          </>
        )}
      </div>
      {agent.remoteAccessEnabled ? (
        <>
          <button
            type="button"
            onClick={() => agent.ipAddress && downloadRdpFile(agent.hostname, agent.ipAddress)}
            disabled={!agent.ipAddress}
            style={{ marginRight: "0.5rem" }}
          >
            Download Remote Desktop file
          </button>
          <button type="button" onClick={handleDisable} disabled={disable.isPending}>
            {disable.isPending ? "Disabling…" : "Disable remote access"}
          </button>
        </>
      ) : (
        <button type="button" onClick={handleEnable} disabled={enable.isPending}>
          {enable.isPending ? "Enabling…" : "Enable remote access"}
        </button>
      )}
      {(enable.isError || disable.isError) && (
        <p className="error-text">{((enable.error ?? disable.error) as Error).message}</p>
      )}
    </Collapsible>
  );
}

function UninstallAgentPanel({ agent }: { agent: AgentDetail }) {
  const uninstall = useUninstallAgent();

  function handleUninstall() {
    const confirmed = window.confirm(
      `Uninstall the Endpoint Pro agent from ${agent.hostname}?\n\nThis removes management of this endpoint entirely - ` +
        `it will stop checking in and disappear from monitoring. This cannot be undone from here; re-enrolling requires ` +
        `running the installer on the endpoint again. The endpoint must be online to pick up the command.`,
    );
    if (!confirmed) return;

    const password = window.prompt(
      "Enter the uninstall password for this deployment (leave blank if none is configured):",
    );
    if (password === null) return; // cancelled

    uninstall.mutate(
      { agentId: agent.id, password },
      {
        onSuccess: () => window.alert("Uninstall scheduled - the agent will be removed within about 30 seconds."),
      },
    );
  }

  return (
    <Collapsible title="Uninstall agent">
      <p>
        Remotely removes the Endpoint Pro agent (and its watchdog task) from this endpoint. Requires the endpoint to
        be online to pick up the command, and the deployment's uninstall password if one is configured (Asset
        Settings → Tamper Protection).
      </p>
      <button type="button" onClick={handleUninstall} disabled={uninstall.isPending}>
        {uninstall.isPending ? "Dispatching…" : "Uninstall agent"}
      </button>
      {uninstall.isError && <p className="error-text">{(uninstall.error as Error).message}</p>}
    </Collapsible>
  );
}

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, error } = useAgent(id);

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p className="error-text">{(error as Error).message}</p>;
  if (!agent) return <p>Endpoint not found.</p>;

  const inv = agent.inventory;

  return (
    <div>
      <p>
        <Link to="/endpoints">&larr; Back to endpoints</Link>
      </p>
      <h1>
        {agent.hostname} <span className={`status-badge ${agent.status.toLowerCase()}`}>{agent.status}</span>
      </h1>

      <AssetDetailsForm agent={agent} />
      <RemoteAccessPanel agent={agent} />
      <UninstallAgentPanel agent={agent} />
      <StoragePanel agent={agent} />
      <CustomFieldsForm agentId={agent.id} values={agent.customFieldValues} />
      <GroupMembershipEditor agentId={agent.id} currentGroupIds={agent.groups.map((g) => g.id)} />
      <SecurityFindingsSection agentId={agent.id} />
      <ZeroTrustFindingsSection agentId={agent.id} />
      <DataDiscoveryFindingsSection agentId={agent.id} />
      <DlpEventsSection agentId={agent.id} />
      <DataMovementEventsSection agentId={agent.id} />
      <UserSessionsSection agentId={agent.id} />
      <AppControlEventsSection agentId={agent.id} />
      <CommandBlockEventsSection agentId={agent.id} />
      <UsbControlEventsSection agentId={agent.id} />
      <NotesFeed agentId={agent.id} />

      <InstalledSoftwareSection agentId={agent.id} software={inv?.installedSoftware ?? []} />
    </div>
  );
}
