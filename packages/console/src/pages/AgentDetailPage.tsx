import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AppWindow,
  ArrowLeft,
  ArrowRightLeft,
  Database,
  FileSearch,
  HardDrive,
  Monitor,
  Package,
  ShieldAlert,
  ShieldCheck,
  StickyNote,
  Terminal,
  Usb,
  Users,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  FormFooter,
  FormGrid,
  FormSection,
  KeyValueList,
  PageHeader,
  Pagination,
  Pill,
  Row,
  SearchInput,
  Skeleton,
  Tabs,
  Tag,
  Toolbar,
  useConfirm,
  usePagedList,
  usePrompt,
  useToast,
  type BadgeTone,
  type TabItem,
} from "../components/ui";
import { formatBytes, formatDate, formatDateTime, formatRelative } from "../format";
import type { AgentDetail, InstalledSoftwareEntry, LifecycleStatus, NormalizedSeverity } from "../api/types";
import {
  useAddAgentNote,
  useAgent,
  useAgentAppControlEvents,
  useAgentCommandBlockEvents,
  useAgentDataDiscoveryFindings,
  useAgentDataMovementEvents,
  useAgentDlpEvents,
  useAgentLatestBuild,
  useAgentNotes,
  useAgentSecurityFindings,
  useAgentUsbControlEvents,
  useAgentUserSessions,
  useAgentZeroTrustFindings,
  useAssetGroups,
  useCustomFieldDefinitions,
  useDisableRemoteAccess,
  useDispatchAgentUpdate,
  useEnableRemoteAccess,
  useIsItemHidden,
  usePauseAgent,
  useRemediateAllForAgent,
  useRemediateSecurityRule,
  useResumeAgent,
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

// Smallest page size offered by <Pagination>; lists at or under it don't need a pager.
const MIN_PAGE_SIZE = 25;

// Backend enum values ("IN_REPAIR", "BLOCKED") shown as sentence-case words.
function humanize(value: string): string {
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function severityTone(severity: NormalizedSeverity): BadgeTone {
  if (severity === "CRITICAL") return "crit";
  if (severity === "HIGH") return "high";
  if (severity === "MEDIUM") return "med";
  if (severity === "LOW") return "low";
  return "neu";
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

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

const IN_PROGRESS_UPDATE_STATUSES = new Set(["PENDING", "DISPATCHED", "DOWNLOADING", "APPLYING"]);

// Pager under a long in-memory table; hidden while everything fits on the smallest page.
function ListPager({ paged, noun }: { paged: ReturnType<typeof usePagedList<unknown>>; noun: string }) {
  if (paged.total <= MIN_PAGE_SIZE) return null;
  return (
    <Pagination
      page={paged.page}
      pageSize={paged.pageSize}
      total={paged.total}
      noun={noun}
      onPageChange={paged.setPage}
      onPageSizeChange={paged.setPageSize}
    />
  );
}

// Loading / error / empty states shared by the per-endpoint event and finding cards.
function SectionState({
  title,
  isLoading,
  error,
  empty,
}: {
  title: string;
  isLoading: boolean;
  error: unknown;
  empty: ReactNode;
}) {
  return (
    <Card title={title}>
      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <Alert tone="critical" title={`Couldn't load ${title.toLowerCase()}`}>
          {(error as Error).message}
        </Alert>
      ) : (
        empty
      )}
    </Card>
  );
}

const muted = <span className="app-muted">—</span>;

/* ------------------------------------------------------------------------------------------
 * Overview: read-only facts
 * ---------------------------------------------------------------------------------------- */

function DeviceCard({ agent }: { agent: AgentDetail }) {
  const inv = agent.inventory;
  return (
    <Card title="Device">
      <KeyValueList
        items={[
          {
            label: "Device type",
            value: agent.deviceTypeOverride
              ? DEVICE_TYPE_LABEL[agent.deviceTypeOverride]
              : `${DEVICE_TYPE_LABEL[agent.deviceType]} (auto-detected)`,
          },
          { label: "Logged-in user", value: inv?.lastLoggedOnUser ?? "—" },
          {
            label: "Processor",
            value: (
              <>
                {inv?.cpuModel ?? "—"}
                {inv?.cpuSpeedGhz ? ` @ ${inv.cpuSpeedGhz} GHz` : ""}
                {" — "}
                <span className="ep-num">{inv?.cpuPhysicalCores ?? "?"}</span> physical /{" "}
                <span className="ep-num">{inv?.cpuCores ?? "?"}</span> logical cores
              </>
            ),
          },
          {
            label: "Memory",
            value: (
              <span className="ep-num">
                {formatBytes(inv?.totalMemBytes ?? null)}
                {inv && inv.memLayout.length > 0 && (
                  <span className="app-muted">
                    {" "}
                    ({inv.memLayout.map((m) => `${formatBytes(m.sizeBytes)} ${m.type ?? ""}`.trim()).join(" + ")})
                  </span>
                )}
              </span>
            ),
          },
        ]}
      />
    </Card>
  );
}

function OperatingSystemCard({ agent }: { agent: AgentDetail }) {
  const patchesHidden = useIsItemHidden("/patches");
  const items: { label: ReactNode; value: ReactNode; mono?: boolean }[] = [
    {
      label: "OS",
      value: (
        <>
          {agent.osPlatform} <span className="ep-mono">{agent.osVersion}</span> ({agent.osArch})
        </>
      ),
    },
    { label: "Edition", value: agent.osEditionLabel ?? "—" },
    {
      label: "OS end of support",
      value: agent.osEol ? (
        <span className="app-badge-row">
          <span>
            {agent.osEol.versionName} — {formatDate(agent.osEol.eolDate)}
          </span>
          <Badge tone={agent.osEol.isEol ? "crit" : "ok"}>{agent.osEol.isEol ? "End of life" : "Supported"}</Badge>
        </span>
      ) : (
        "—"
      ),
    },
  ];
  if (!patchesHidden) {
    items.push(
      { label: "Last patch installed", value: formatDateTime(agent.lastPatchInstalledAt, "Never") },
      {
        label: "Latest available patch",
        value: agent.latestAvailablePatch ? (
          <div className="app-stack-sm">
            <span className="app-badge-row">
              <span>{agent.latestAvailablePatch.title}</span>
              {agent.latestAvailablePatch.severity && (
                <Badge tone={severityTone(agent.latestAvailablePatch.normalizedSeverity)}>
                  {agent.latestAvailablePatch.severity}
                </Badge>
              )}
            </span>
            <span className="app-muted">
              <span className="ep-mono">{agent.latestAvailablePatch.kbArticleIds.join(", ") || "No KB"}</span> — detected{" "}
              {formatDate(agent.latestAvailablePatch.firstSeenAt)}
            </span>
          </div>
        ) : (
          "None missing"
        ),
      },
    );
  }
  return (
    <Card title="Operating system">
      <KeyValueList items={items} />
    </Card>
  );
}

function AgentVersionValue({ agent }: { agent: AgentDetail }) {
  const { data: latestBuild } = useAgentLatestBuild();
  const dispatchUpdate = useDispatchAgentUpdate();
  const task = agent.latestUpdateTask;

  // An update is currently in flight for this agent (dispatched from here or
  // from Agent Updates' own "Push update" button - same underlying task either
  // way) - show live progress instead of an "update available" prompt, polled
  // automatically every 5s by useAgent. Resolves on its own once the task
  // reaches SUCCESS (agentVersion above updates too, so this block just stops
  // matching a newer build) or FAILED (falls through below, still offering a
  // retry with the failure reason attached).
  let extra: ReactNode = null;
  if (task && IN_PROGRESS_UPDATE_STATUSES.has(task.status)) {
    extra = (
      <Badge tone="med">
        Updating to <span className="ep-mono">v{task.targetVersion}</span>… ({task.status.toLowerCase()})
      </Badge>
    );
  } else {
    const latestForThisAgent =
      agent.osPlatform === "linux" ? latestBuild?.linux : agent.osPlatform === "darwin" ? latestBuild?.macos : latestBuild?.windows;
    if (latestForThisAgent && latestForThisAgent.version !== agent.agentVersion) {
      const lastAttemptFailed = task?.status === "FAILED" && task.targetVersion === latestForThisAgent.version;
      extra = (
        <>
          <Button
            size="sm"
            onClick={() => dispatchUpdate.mutate({ agentIds: [agent.id], groupIds: [] })}
            disabled={dispatchUpdate.isPending}
          >
            {dispatchUpdate.isPending ? "Starting…" : `Update to v${latestForThisAgent.version}`}
          </Button>
          {lastAttemptFailed && <span className="ep-error">Previous attempt failed: {task.message ?? "unknown error"}</span>}
          {dispatchUpdate.isError && <span className="ep-error">{(dispatchUpdate.error as Error).message}</span>}
        </>
      );
    }
  }

  return (
    <span className="app-badge-row">
      <span className="ep-mono">{agent.agentVersion}</span>
      {extra}
    </span>
  );
}

function AgentCard({ agent }: { agent: AgentDetail }) {
  return (
    <Card title="Agent">
      <KeyValueList
        items={[
          { label: "Endpoint version", value: <AgentVersionValue agent={agent} /> },
          { label: "Last check-in", value: formatDateTime(agent.lastCheckinAt, "Never") },
          {
            label: "Groups",
            value:
              agent.groups.length > 0 ? (
                <span className="app-badge-row">
                  {agent.groups.map((g) => (
                    <Tag key={g.id}>{g.name}</Tag>
                  ))}
                </span>
              ) : (
                muted
              ),
          },
        ]}
      />
    </Card>
  );
}

function NetworkCard({ agent }: { agent: AgentDetail }) {
  return (
    <Card title="Network">
      <KeyValueList
        items={[
          { label: "IP address", value: agent.ipAddress ?? "—", mono: !!agent.ipAddress },
          { label: "MAC address", value: agent.macAddress ?? "—", mono: !!agent.macAddress },
        ]}
      />
    </Card>
  );
}

function AssetFactsCard({ agent }: { agent: AgentDetail }) {
  return (
    <Card title="Asset" hint="edit on the Manage tab">
      <KeyValueList
        items={[
          { label: "Lifecycle status", value: humanize(agent.lifecycleStatus) },
          { label: "Serial number", value: agent.serialNumber ?? "—", mono: !!agent.serialNumber },
          { label: "Vendor", value: agent.vendor ?? "—" },
          { label: "Location", value: agent.location ?? "—" },
          { label: "Purchase date", value: formatDate(agent.purchaseDate) },
          { label: "Warranty expiry", value: formatDate(agent.warrantyExpiryDate) },
        ]}
      />
    </Card>
  );
}

function batteryStatusTone(status: "GOOD" | "DEGRADED" | "REPLACE" | "UNKNOWN"): BadgeTone {
  if (status === "GOOD") return "ok";
  if (status === "REPLACE") return "crit";
  return "med"; // DEGRADED and UNKNOWN both render as a caution color, not a hard failure
}

function PostureCard({ agent }: { agent: AgentDetail }) {
  const inv = agent.inventory;
  const vulnerabilitiesHidden = useIsItemHidden("/vulnerabilities");
  const zeroTrustHidden = useIsItemHidden("/zero-trust");
  const isWarrantyExpired = agent.warrantyExpiryDate ? new Date(agent.warrantyExpiryDate) < new Date() : false;

  const items: { label: ReactNode; value: ReactNode }[] = [];
  if (!vulnerabilitiesHidden) {
    items.push({
      label: "Vulnerabilities",
      value:
        agent.openVulnerabilityCount > 0 ? (
          <Badge tone="high">
            <span className="ep-num">{agent.openVulnerabilityCount}</span> open
          </Badge>
        ) : (
          <Badge tone="ok">Clean</Badge>
        ),
    });
  }
  if (!zeroTrustHidden) {
    items.push({
      label: "Zero Trust",
      value:
        agent.zeroTrustNonCompliantCount > 0 ? (
          <Badge tone="crit">
            <span className="ep-num">{agent.zeroTrustNonCompliantCount}</span> failing
          </Badge>
        ) : (
          <Badge tone="ok">Compliant</Badge>
        ),
    });
  }
  if (inv?.battery?.present) {
    items.push(
      {
        label: "Battery health",
        value: (
          <Badge tone={batteryStatusTone(inv.battery.healthStatus)}>
            {humanize(inv.battery.healthStatus)}
            {inv.battery.healthPercent !== null ? ` (${inv.battery.healthPercent}%)` : ""}
          </Badge>
        ),
      },
      {
        label: "Battery capacity",
        value: (
          <span className="ep-num">
            {inv.battery.fullChargeCapacityMwh ? `${(inv.battery.fullChargeCapacityMwh / 1000).toFixed(1)} Wh` : "—"}
            {inv.battery.designCapacityMwh ? ` of ${(inv.battery.designCapacityMwh / 1000).toFixed(1)} Wh design` : ""}
          </span>
        ),
      },
      {
        label: "Battery cycles",
        value: inv.battery.cycleCount !== null ? <span className="ep-num">{inv.battery.cycleCount}</span> : "Not reported by this device",
      },
    );
  } else {
    items.push({ label: "Battery", value: inv ? "Not present (desktop or VM)" : "—" });
  }
  items.push({
    label: "OS license",
    value: (
      <>
        {inv?.osLicenseStatus ?? "—"}
        {inv?.osLicenseChannel ? ` (${inv.osLicenseChannel})` : ""}
        {inv?.osPartialProductKey ? (
          <>
            {" — "}
            <span className="ep-mono">...{inv.osPartialProductKey}</span>
          </>
        ) : (
          ""
        )}
      </>
    ),
  });
  if (agent.warrantyExpiryDate) {
    items.push({
      label: "Warranty",
      value: <Badge tone={isWarrantyExpired ? "crit" : "ok"}>{isWarrantyExpired ? "Expired" : "Active"}</Badge>,
    });
  }

  return (
    <Card title="Posture">
      <KeyValueList items={items} />
    </Card>
  );
}

function StorageCard({ agent }: { agent: AgentDetail }) {
  const inv = agent.inventory;
  const volumes = inv?.diskVolumes ?? [];

  return (
    <Card
      flush
      title="Storage"
      hint={
        <>
          Total physical storage:{" "}
          <span className="ep-num">
            {inv?.totalDiskBytes
              ? `${formatBytes(inv.totalDiskBytes)}${inv.diskTypes.length > 0 ? ` (${inv.diskTypes.join(" + ")})` : ""}`
              : "—"}
          </span>
        </>
      }
    >
      {volumes.length === 0 ? (
        <EmptyState icon={HardDrive} title="No volume data reported yet">
          Volumes appear after the agent's next inventory report.
        </EmptyState>
      ) : (
        <div className="app-table-scroll">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Volume</th>
                <th scope="col">Filesystem</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Size
                </th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Used
                </th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Free
                </th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Use %
                </th>
              </tr>
            </thead>
            <tbody>
              {volumes.map((v) => (
                <tr key={v.mount}>
                  <td className="ep-mono">{v.mount}</td>
                  <td>{v.fsType ?? "—"}</td>
                  <td className="ep-num" style={{ textAlign: "right" }}>
                    {formatBytes(v.sizeBytes)}
                  </td>
                  <td className="ep-num" style={{ textAlign: "right" }}>
                    {formatBytes(v.usedBytes)}
                  </td>
                  <td className="ep-num" style={{ textAlign: "right" }}>
                    {formatBytes(v.availableBytes)}
                  </td>
                  <td className="ep-num" style={{ textAlign: "right" }}>
                    {v.usePercent !== null ? `${v.usePercent}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function NotesFeed({ agentId }: { agentId: string }) {
  const { data: notes, isLoading, error } = useAgentNotes(agentId);
  const addNote = useAddAgentNote();
  const [body, setBody] = useState("");

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    addNote.mutate({ agentId, body }, { onSuccess: () => setBody("") });
  }

  return (
    <Card title="Notes" hint={notes && notes.length > 0 ? `${notes.length} ${plural(notes.length, "note")}` : undefined}>
      <div className="app-stack">
        {isLoading ? (
          <Skeleton lines={3} />
        ) : error ? (
          <Alert tone="critical" title="Couldn't load notes">
            {(error as Error).message}
          </Alert>
        ) : notes && notes.length > 0 ? (
          <div className="app-stack">
            {notes.map((n) => (
              <div key={n.id} className="app-stack-sm">
                <div className="app-text" style={{ whiteSpace: "pre-wrap" }}>
                  {n.body}
                </div>
                <span className="ep-help">
                  {n.createdByAdminEmail} — {formatDateTime(n.createdAt)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={StickyNote} title="No notes yet">
            Add a note below to record repairs, hand-overs or anything the next admin should know.
          </EmptyState>
        )}

        <form onSubmit={handleAdd} className="app-stack-sm">
          <Field label="Add note" htmlFor="agent-note-body">
            <textarea id="agent-note-body" className="ep-textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {addNote.isError && <Alert tone="critical">{(addNote.error as Error).message}</Alert>}
          <div className="app-actions-row app-end">
            <Button type="submit" disabled={addNote.isPending || !body.trim()}>
              {addNote.isPending ? "Adding…" : "Add note"}
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------
 * Manage: editable asset details, custom fields, groups, remote access, pause, uninstall
 * ---------------------------------------------------------------------------------------- */

function AssetDetailsForm({ agent }: { agent: AgentDetail }) {
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
    <Card title="Asset details">
      <form onSubmit={handleSave} className="app-settings-form">
        <FormSection title="Classification" description="These save as soon as you change them.">
          <FormGrid>
            <Field label="Lifecycle status" htmlFor="asset-lifecycle">
              <select
                id="asset-lifecycle"
                className="ep-select"
                value={agent.lifecycleStatus}
                onChange={(e) => setLifecycle.mutate({ agentId: agent.id, lifecycleStatus: e.target.value })}
              >
                {LIFECYCLE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Device type" htmlFor="asset-device-type">
              <select
                id="asset-device-type"
                className="ep-select"
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
            </Field>
          </FormGrid>
        </FormSection>

        <FormSection title="Ownership and warranty">
          <FormGrid>
            <Field
              label="Location"
              htmlFor="asset-location"
              span2
              help={geoHintLabel && !agent.location ? `Detected: ${geoHintLabel} via IP` : undefined}
            >
              <input
                id="asset-location"
                className="ep-input"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Mumbai HQ - 3rd Floor"
              />
            </Field>
            <Field label="Serial number" htmlFor="asset-serial">
              <input
                id="asset-serial"
                className="ep-input ep-mono"
                type="text"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
              />
            </Field>
            <Field label="Vendor" htmlFor="asset-vendor">
              <input id="asset-vendor" className="ep-input" type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </Field>
            <Field label="Purchase date" htmlFor="asset-purchase-date">
              <input
                id="asset-purchase-date"
                className="ep-input"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </Field>
            <Field
              label="Warranty expiry"
              htmlFor="asset-warranty-expiry"
              help={
                agent.warrantyExpiryDate ? (
                  <span className="app-badge-row">
                    Warranty status
                    <Badge tone={isWarrantyExpired ? "crit" : "ok"}>{isWarrantyExpired ? "Expired" : "Active"}</Badge>
                  </span>
                ) : undefined
              }
            >
              <input
                id="asset-warranty-expiry"
                className="ep-input"
                type="date"
                value={warrantyExpiryDate}
                onChange={(e) => setWarrantyExpiryDate(e.target.value)}
              />
            </Field>
          </FormGrid>
        </FormSection>
        <FormFooter>
          <Button type="submit" variant="primary" disabled={setDetails.isPending}>
            {setDetails.isPending ? "Saving…" : "Save asset details"}
          </Button>
        </FormFooter>
      </form>
    </Card>
  );
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
    <Card title="Custom fields">
      <form onSubmit={handleSave} className="app-settings-form">
        <FormGrid>
          {definitions.map((def) => (
            <Field key={def.id} label={def.name} htmlFor={`custom-field-${def.id}`}>
              {def.fieldType === "SELECT" ? (
                <select
                  id={`custom-field-${def.id}`}
                  className="ep-select"
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
                  id={`custom-field-${def.id}`}
                  className="ep-input"
                  type={def.fieldType === "NUMBER" ? "number" : def.fieldType === "DATE" ? "date" : "text"}
                  value={draft[def.id] ?? ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [def.id]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </FormGrid>
        <FormFooter>
          <Button type="submit" disabled={setValues.isPending}>
            {setValues.isPending ? "Saving…" : "Save custom fields"}
          </Button>
        </FormFooter>
      </form>
    </Card>
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
    <Card title="Group membership" hint={`${selected.length} selected`}>
      <div className="app-stack">
        <div className="app-check-grid">
          {groups.map((g) => (
            <Check key={g.id} checked={selected.includes(g.id)} onChange={() => toggle(g.id)} label={g.name} />
          ))}
        </div>
        <div className="app-actions-row app-end">
          <Button onClick={() => setGroups.mutate({ agentId, groupIds: selected })} disabled={setGroups.isPending}>
            {setGroups.isPending ? "Saving…" : "Save groups"}
          </Button>
        </div>
      </div>
    </Card>
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
  const confirm = useConfirm();

  async function handleEnable() {
    const confirmed = await confirm({
      title: `Enable Remote Desktop on ${agent.hostname}?`,
      body:
        "This opens port 3389 to your current IP address only, and remains open until you disable it. " +
        "The endpoint must be online to pick up the command.",
      confirmLabel: "Enable remote access",
    });
    if (!confirmed) return;
    enable.mutate(agent.id);
  }

  async function handleDisable() {
    const confirmed = await confirm({
      title: `Disable Remote Desktop on ${agent.hostname}?`,
      confirmLabel: "Disable remote access",
    });
    if (!confirmed) return;
    disable.mutate(agent.id);
  }

  const statusItems: { label: ReactNode; value: ReactNode; mono?: boolean }[] = [
    {
      label: "Status",
      value: <Pill tone={agent.remoteAccessEnabled ? "ok" : "neutral"}>{agent.remoteAccessEnabled ? "Enabled" : "Disabled"}</Pill>,
    },
  ];
  if (agent.remoteAccessEnabled) {
    statusItems.push(
      { label: "Enabled since", value: formatDateTime(agent.remoteAccessEnabledAt) },
      { label: "Allowed IP", value: agent.remoteAccessAllowedIp ?? "—", mono: !!agent.remoteAccessAllowedIp },
    );
  }

  return (
    <Card title="Remote access">
      <div className="app-stack">
        <p className="app-text">
          Enable Remote Desktop on this endpoint, scoped to a firewall exception for your current IP address only.
          Requires the endpoint to be online to pick up the command, and your machine to be able to reach it directly
          (same LAN or VPN) — this does not work through NAT with no inbound path.
        </p>
        <KeyValueList items={statusItems} />
        <div className="app-actions-row">
          {agent.remoteAccessEnabled ? (
            <>
              <Button onClick={() => agent.ipAddress && downloadRdpFile(agent.hostname, agent.ipAddress)} disabled={!agent.ipAddress}>
                Download Remote Desktop file
              </Button>
              <Button onClick={handleDisable} disabled={disable.isPending}>
                {disable.isPending ? "Disabling…" : "Disable remote access"}
              </Button>
            </>
          ) : (
            <Button onClick={handleEnable} disabled={enable.isPending}>
              {enable.isPending ? "Enabling…" : "Enable remote access"}
            </Button>
          )}
        </div>
        {(enable.isError || disable.isError) && (
          <Alert tone="critical">{((enable.error ?? disable.error) as Error).message}</Alert>
        )}
      </div>
    </Card>
  );
}

function PausePanel({ agent }: { agent: AgentDetail }) {
  const pause = usePauseAgent();
  const resume = useResumeAgent();
  const confirm = useConfirm();

  async function handlePause() {
    const confirmed = await confirm({
      title: `Pause ${agent.hostname}?`,
      body:
        "This releases active enforcement (quarantine, remote access, web/IP/app blocking) " +
        "and holds back new commands, deployments, and patches until resumed. It still counts against your license " +
        "seat — pausing doesn't relinquish that, only uninstalling does. It also doesn't stop the agent itself — if " +
        "the endpoint is online it keeps checking in and reporting, it just won't receive new work or have policies " +
        "enforced. Resuming restores exactly what was released (e.g. re-quarantines if it was quarantined before).",
      confirmLabel: "Pause endpoint",
    });
    if (!confirmed) return;
    pause.mutate(agent.id);
  }

  function handleResume() {
    resume.mutate(agent.id);
  }

  const statusItems: { label: ReactNode; value: ReactNode }[] = [
    { label: "Status", value: <Pill tone={agent.paused ? "neutral" : "ok"}>{agent.paused ? "Paused" : "Active"}</Pill> },
  ];
  if (agent.paused) statusItems.push({ label: "Paused since", value: formatDateTime(agent.pausedAt) });

  return (
    <Card title="Pause">
      <div className="app-stack">
        <p className="app-text">
          Pausing releases this endpoint's active policy enforcement (quarantine, remote access, web/IP/app-control
          blocking) and holds back new commands, deployments, and patches until you resume it — useful for a machine
          that's in storage or between users without fully uninstalling it. Resuming restores whatever was released.
          This does <strong>not</strong> free the license seat (only uninstalling does), and the agent itself isn't
          stopped — a paused-but-online endpoint keeps checking in as normal. USB Control is a partial exception: a
          device already disabled can't be re-enabled by software and needs to be physically unplugged and reinserted.
        </p>
        <KeyValueList items={statusItems} />
        <div className="app-actions-row">
          {agent.paused ? (
            <Button onClick={handleResume} disabled={resume.isPending}>
              {resume.isPending ? "Resuming…" : "Resume"}
            </Button>
          ) : (
            <Button onClick={handlePause} disabled={pause.isPending}>
              {pause.isPending ? "Pausing…" : "Pause"}
            </Button>
          )}
        </div>
        {(pause.isError || resume.isError) && <Alert tone="critical">{((pause.error ?? resume.error) as Error).message}</Alert>}
      </div>
    </Card>
  );
}

function UninstallAgentPanel({ agent }: { agent: AgentDetail }) {
  const uninstall = useUninstallAgent();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const toast = useToast();

  async function handleUninstall() {
    const confirmed = await confirm({
      title: `Uninstall the Endpoint IQ agent from ${agent.hostname}?`,
      body:
        "This removes management of this endpoint entirely - it will stop checking in and disappear from monitoring. " +
        "This cannot be undone from here; re-enrolling requires running the installer on the endpoint again. " +
        "The endpoint must be online to pick up the command.",
      confirmLabel: "Continue",
      tone: "danger",
    });
    if (!confirmed) return;

    const password = await prompt({
      title: "Enter the uninstall password",
      label: "Uninstall password",
      type: "password",
      help: "Leave blank if none is configured for this deployment.",
      confirmLabel: "Uninstall agent",
    });
    if (password === null) return; // cancelled

    uninstall.mutate(
      { agentId: agent.id, password },
      {
        onSuccess: () => toast("Uninstall scheduled - the agent will be removed within about 30 seconds."),
      },
    );
  }

  return (
    <Card title="Uninstall agent">
      <div className="app-stack">
        <p className="app-text">
          Remotely removes the Endpoint IQ agent (and its watchdog task) from this endpoint. Requires the endpoint to
          be online to pick up the command, and the deployment's uninstall password if one is configured (Asset
          settings → Tamper protection).
        </p>
        <div className="app-actions-row">
          <Button variant="danger" onClick={handleUninstall} disabled={uninstall.isPending}>
            {uninstall.isPending ? "Dispatching…" : "Uninstall agent"}
          </Button>
        </div>
        {uninstall.isError && <Alert tone="critical">{(uninstall.error as Error).message}</Alert>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------
 * Software
 * ---------------------------------------------------------------------------------------- */

type LicenseFilter = "ALL" | "LICENSED" | "UNLICENSED";

function InstalledSoftwareSection({ agentId, software }: { agentId: string; software: InstalledSoftwareEntry[] }) {
  const uninstall = useUninstallSoftware();
  const confirm = useConfirm();
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
  const paged = usePagedList(filtered);
  const filtersActive = Boolean(nameFilter || publisherFilter || licenseFilter !== "ALL");

  function clearFilters() {
    setNameFilter("");
    setPublisherFilter("");
    setLicenseFilter("ALL");
  }

  async function handleUninstall(name: string) {
    const confirmed = await confirm({
      title: `Uninstall "${name}" from this endpoint?`,
      body:
        "This runs the software's own uninstaller unattended. MSI-based installs run fully silently; " +
        "other installers run whatever uninstall command is registered, which may not support a silent flag " +
        "and could hang waiting for input nobody is there to give. Check the Commands page to confirm it completed.",
      confirmLabel: "Uninstall software",
      tone: "danger",
    });
    if (!confirmed) return;
    setPendingName(name);
    uninstall.mutate({ agentId, softwareName: name }, { onSettled: () => setPendingName(null) });
  }

  return (
    <Card flush title="Installed software" hint={`${software.length} ${plural(software.length, "application")}`}>
      <Toolbar
        right={
          filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )
        }
      >
        <SearchInput value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} placeholder="Filter by name…" />
        <select
          className="ep-select"
          aria-label="Publisher"
          style={{ width: "auto" }}
          value={publisherFilter}
          onChange={(e) => setPublisherFilter(e.target.value)}
        >
          <option value="">All publishers</option>
          {publishers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className="ep-select"
          aria-label="License status"
          style={{ width: "auto" }}
          value={licenseFilter}
          onChange={(e) => setLicenseFilter(e.target.value as LicenseFilter)}
        >
          <option value="ALL">All license statuses</option>
          <option value="LICENSED">Licensed</option>
          <option value="UNLICENSED">Not licensed</option>
        </select>
      </Toolbar>
      <div className="ep-cb">
        <p className="app-text">
          "Licensed" is a heuristic name-match against records on the Software Licenses page, not a verified
          entitlement check — a match confirms a license record exists for something with a similar name, nothing more.
        </p>
      </div>

      {filtered.length === 0 ? (
        software.length === 0 ? (
          <EmptyState icon={Package} title="No inventory reported yet">
            Installed software appears after the agent's next inventory report.
          </EmptyState>
        ) : (
          <EmptyState
            icon={Package}
            title="No software matches these filters"
            action={
              <Button size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          >
            Try a different name, publisher or license status.
          </EmptyState>
        )
      ) : (
        <>
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Version</th>
                  <th scope="col">Publisher</th>
                  <th scope="col">License</th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((s, i) => (
                  <tr key={`${(paged.page - 1) * paged.pageSize + i}`}>
                    <td>{s.name}</td>
                    <td>{s.version ? <span className="ep-mono">{s.version}</span> : "—"}</td>
                    <td>{s.publisher ?? "—"}</td>
                    <td>{s.licensed ? <Badge tone="ok">Licensed</Badge> : <Badge tone="med">Not licensed</Badge>}</td>
                    <td>
                      <div className="app-cell-actions">
                        <Button variant="danger" size="sm" onClick={() => handleUninstall(s.name)} disabled={pendingName === s.name}>
                          {pendingName === s.name ? "Dispatching…" : "Uninstall"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPager paged={paged} noun="applications" />
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------
 * Security
 * ---------------------------------------------------------------------------------------- */

function securityStatusTone(status: "PASS" | "FAIL" | "ERROR"): BadgeTone {
  if (status === "PASS") return "ok";
  if (status === "ERROR") return "med";
  return "crit";
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
  const { data: findings, isLoading, error } = useAgentSecurityFindings(agentId);
  const remediate = useRemediateSecurityRule();
  const remediateAll = useRemediateAllForAgent();
  const confirmFix = useConfirm();
  const [remediatingRuleId, setRemediatingRuleId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ ruleId: string; jobId?: string; error?: string } | null>(null);
  const paged = usePagedList(findings ?? []);

  async function handleRemediate(ruleId: string) {
    const warning = findings?.find((f) => f.ruleId === ruleId)?.remediationWarning;
    if (warning) {
      const ok = await confirmFix({
        title: "This fix changes how Windows starts or signs in",
        body: `${warning} The change takes effect after the next restart.`,
        confirmLabel: "Apply on this device",
        tone: "danger",
      });
      if (!ok) return;
    }
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

  if (!findings || findings.length === 0) {
    return (
      <SectionState
        title="Security configuration"
        isLoading={isLoading}
        error={error}
        empty={
          <EmptyState
            icon={ShieldCheck}
            title="No security configuration results yet"
            action={
              <Link className="ep-link" to="/security-config">
                Open security configuration
              </Link>
            }
          >
            Results appear after a benchmark policy is assigned and the agent runs its next security scan.
          </EmptyState>
        }
      />
    );
  }

  const remediableFailCount = findings.filter((f) => f.status === "FAIL" && f.hasRemediation).length;
  const passCount = findings.filter((f) => f.status === "PASS").length;
  const failCount = findings.filter((f) => f.status === "FAIL").length;
  const errorCount = findings.filter((f) => f.status === "ERROR").length;

  return (
    <Card
      flush
      title="Security configuration"
      hint={`${passCount} pass / ${failCount} fail / ${errorCount} error`}
      actions={
        remediableFailCount > 0 && (
          <Button size="sm" onClick={() => remediateAll.mutate(agentId)} disabled={remediateAll.isPending}>
            {remediateAll.isPending ? "Remediating…" : `Remediate all (${remediableFailCount})`}
          </Button>
        )
      }
    >
      {remediableFailCount > 0 && (remediateAll.isSuccess || remediateAll.isError) && (
        <div className="ep-cb">
          {remediateAll.isSuccess && (
            <Alert tone="success">
              Dispatched {remediateAll.data.remediatedCount} remediation job(s)
              {remediateAll.data.skippedCount > 0 ? ` — ${remediateAll.data.skippedCount} failing rule(s) were not fixed automatically` : ""}.
              {remediateAll.data.needsReview && remediateAll.data.needsReview.length > 0 && (
                <> Fix these one at a time, after checking the device: {remediateAll.data.needsReview.join(", ")}.</>
              )}
            </Alert>
          )}
          {remediateAll.isError && <Alert tone="critical">{(remediateAll.error as Error).message}</Alert>}
        </div>
      )}
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Benchmark</th>
              <th scope="col">Rule</th>
              <th scope="col">Status</th>
              <th scope="col">Expected</th>
              <th scope="col">Actual</th>
              <th scope="col">
                <span className="app-vh">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((f) => (
              <tr key={f.id}>
                <td>{f.benchmarkName}</td>
                <td>{f.title}</td>
                <td>
                  <Badge tone={securityStatusTone(f.status)}>{humanize(f.status)}</Badge>
                </td>
                <td className="ep-mono">{f.expectedValue}</td>
                <td className="ep-mono">{f.actualValue ?? "—"}</td>
                <td>
                  {f.status === "FAIL" && f.hasRemediation && (
                    <div className="app-stack-sm">
                      <div className="app-cell-actions">
                        <Button
                          size="sm"
                          onClick={() => handleRemediate(f.ruleId)}
                          disabled={remediate.isPending && remediatingRuleId === f.ruleId}
                        >
                          {remediate.isPending && remediatingRuleId === f.ruleId ? "Remediating…" : "Remediate"}
                        </Button>
                      </div>
                      {lastResult?.ruleId === f.ruleId && lastResult.jobId && (
                        <span className="app-cell-note app-muted">
                          Queued (job <span className="ep-mono">{lastResult.jobId.slice(0, 8)}</span>) — runs on the agent's next
                          check-in, status appears on the{" "}
                          <Link className="ep-link" to="/commands">
                            Commands
                          </Link>{" "}
                          page; this rule re-grades on the next security scan.
                        </span>
                      )}
                      {lastResult?.ruleId === f.ruleId && lastResult.error && <span className="ep-error">{lastResult.error}</span>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager paged={paged} noun="rules" />
    </Card>
  );
}

function ZeroTrustFindingsSection({ agentId }: { agentId: string }) {
  const { data: findings, isLoading, error } = useAgentZeroTrustFindings(agentId);
  const paged = usePagedList(findings ?? []);

  if (!findings || findings.length === 0) {
    return (
      <SectionState
        title="Zero Trust"
        isLoading={isLoading}
        error={error}
        empty={
          <EmptyState
            icon={ShieldCheck}
            title="No Zero Trust results yet"
            action={
              <Link className="ep-link" to="/zero-trust">
                Open Zero Trust
              </Link>
            }
          >
            Results appear after a Zero Trust policy applies to this endpoint and it reports its next check.
          </EmptyState>
        }
      />
    );
  }

  const passCount = findings.filter((f) => f.status === "PASS").length;
  const failCount = findings.filter((f) => f.status === "FAIL").length;
  const errorCount = findings.filter((f) => f.status === "ERROR").length;
  const policyNames = [...new Set(findings.map((f) => f.policyName))];
  const trusted = failCount === 0 && errorCount === 0;

  return (
    <Card flush title="Zero Trust" hint={`${passCount} compliant / ${failCount} non-compliant / ${errorCount} error`}>
      <div className="ep-cb">
        <KeyValueList
          items={policyNames.map((policyName) => ({
            label: policyName,
            value: <Pill tone={trusted ? "ok" : "critical"}>{trusted ? "Trusted" : "Not trusted"}</Pill>,
          }))}
        />
      </div>
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Policy</th>
              <th scope="col">Condition</th>
              <th scope="col">Status</th>
              <th scope="col">Expected</th>
              <th scope="col">Actual</th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((f) => (
              <tr key={f.id}>
                <td>{f.policyName}</td>
                <td>{f.title}</td>
                <td>
                  <Badge tone={securityStatusTone(f.status)}>{zeroTrustStatusLabel(f.status)}</Badge>
                </td>
                <td className="ep-mono">{f.expectedValue}</td>
                <td className="ep-mono">{f.actualValue ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager paged={paged} noun="conditions" />
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------
 * Data protection
 * ---------------------------------------------------------------------------------------- */

function DataDiscoveryFindingsSection({ agentId }: { agentId: string }) {
  const { data: findings, isLoading, error } = useAgentDataDiscoveryFindings(agentId);
  const paged = usePagedList(findings ?? []);

  if (!findings || findings.length === 0) {
    return (
      <SectionState
        title="Data discovery"
        isLoading={isLoading}
        error={error}
        empty={
          <EmptyState
            icon={FileSearch}
            title="No files with personal data found"
            action={
              <Link className="ep-link" to="/data-discovery">
                Open data discovery
              </Link>
            }
          >
            Files appear here when a data discovery scan on this endpoint matches a policy.
          </EmptyState>
        }
      />
    );
  }

  return (
    <Card flush title="Data discovery" hint={`${findings.length} ${plural(findings.length, "file")} with personal data`}>
      <div className="ep-cb">
        <p className="app-text">Samples below are masked previews (e.g. "••••••••6789") — the unmasked value never leaves the endpoint.</p>
      </div>
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Policy</th>
              <th scope="col">File</th>
              <th scope="col">Matched patterns</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((f) => (
              <tr key={f.id}>
                <td>{f.policyName}</td>
                <td className="ep-mono">{f.filePath}</td>
                <td>
                  <div className="app-stack-sm">
                    {f.matches.map((m) => (
                      <div key={m.label}>
                        <Badge tone="crit">
                          {m.label} (<span className="ep-num">{m.count}</span>)
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
      <ListPager paged={paged} noun="files" />
    </Card>
  );
}

function DlpEventsSection({ agentId }: { agentId: string }) {
  const { data: events, isLoading, error } = useAgentDlpEvents(agentId);
  const paged = usePagedList(events ?? []);

  if (!events || events.length === 0) {
    return (
      <SectionState
        title="DLP"
        isLoading={isLoading}
        error={error}
        empty={
          <EmptyState
            icon={ShieldAlert}
            title="No DLP events"
            action={
              <Link className="ep-link" to="/dlp">
                Open DLP policies
              </Link>
            }
          >
            Events appear here when a DLP policy matches a file copied or saved on this endpoint.
          </EmptyState>
        }
      />
    );
  }

  const blockedCount = events.filter((e) => e.action === "BLOCKED").length;

  return (
    <Card flush title="DLP" hint={`${events.length} ${plural(events.length, "event")}, ${blockedCount} blocked`}>
      <div className="ep-cb">
        <p className="app-text">Samples below are masked previews — the unmasked value never leaves the endpoint.</p>
      </div>
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Policy</th>
              <th scope="col">File</th>
              <th scope="col">Process</th>
              <th scope="col">Removable media</th>
              <th scope="col">Action</th>
              <th scope="col">Matched rules</th>
              <th scope="col">Occurred</th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((e) => (
              <tr key={e.id}>
                <td>{e.policyName}</td>
                <td className="ep-mono">{e.filePath}</td>
                <td>{e.processName ? <span className="ep-mono">{e.processName}</span> : "—"}</td>
                <td>{e.destinationIsRemovable ? "Yes" : "No"}</td>
                <td>
                  <Badge tone={e.action === "BLOCKED" ? "crit" : "med"}>{humanize(e.action)}</Badge>
                </td>
                <td>
                  <div className="app-stack-sm">
                    {e.matches.map((m, i) => (
                      <div key={`${m.label}-${i}`}>
                        <Badge tone="crit">{m.label}</Badge>
                        {m.samples.length > 0 && <span className="app-cell-note app-muted ep-mono">{m.samples.join(", ")}</span>}
                      </div>
                    ))}
                  </div>
                </td>
                <td className="app-muted">{formatDateTime(e.occurredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager paged={paged} noun="events" />
    </Card>
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
  const { data: events, isLoading, error } = useAgentDataMovementEvents(agentId);
  const paged = usePagedList(events ?? []);

  if (!events || events.length === 0) {
    return (
      <SectionState
        title="Data movement"
        isLoading={isLoading}
        error={error}
        empty={
          <EmptyState
            icon={ArrowRightLeft}
            title="No data movement events"
            action={
              <Link className="ep-link" to="/data-movement">
                Open data movement
              </Link>
            }
          >
            Events appear here when a monitored file moves to USB, cloud sync or a network share.
          </EmptyState>
        }
      />
    );
  }

  return (
    <Card flush title="Data movement" hint={`${events.length} ${plural(events.length, "event")}`}>
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Policy</th>
              <th scope="col">File</th>
              <th scope="col">Channel</th>
              <th scope="col">Destination</th>
              <th scope="col">File modified</th>
              <th scope="col">Detected</th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((e) => (
              <tr key={e.id}>
                <td>{e.policyName}</td>
                <td className="ep-mono">{e.filePath}</td>
                <td>
                  <Badge tone="med">{DATA_MOVEMENT_CHANNEL_LABEL[e.channel] ?? e.channel}</Badge>
                </td>
                <td className="ep-mono">{formatChannelDetail(e.channel, e.channelDetail)}</td>
                <td className="app-muted">{formatDateTime(e.fileModifiedAt)}</td>
                <td className="app-muted">{formatDateTime(e.detectedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager paged={paged} noun="events" />
    </Card>
  );
}

function AppControlEventsSection({ agentId }: { agentId: string }) {
  const { data: events, isLoading, error } = useAgentAppControlEvents(agentId);
  const paged = usePagedList(events ?? []);

  if (!events || events.length === 0) {
    return (
      <SectionState
        title="Application control"
        isLoading={isLoading}
        error={error}
        empty={
          <EmptyState
            icon={AppWindow}
            title="No application control events"
            action={
              <Link className="ep-link" to="/epm">
                Open EPM rules
              </Link>
            }
          >
            Events appear here when an application control rule blocks a program on this endpoint.
          </EmptyState>
        }
      />
    );
  }

  return (
    <Card flush title="Application control" hint={`${events.length} ${plural(events.length, "event")}`}>
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Path</th>
              <th scope="col">Process</th>
              <th scope="col">Occurred</th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((e) => (
              <tr key={e.id}>
                <td>{e.ruleLabel ?? "—"}</td>
                <td>{e.matchedPath ? <span className="ep-mono">{e.matchedPath}</span> : "—"}</td>
                <td>{e.processName ? <span className="ep-mono">{e.processName}</span> : "—"}</td>
                <td className="app-muted">{formatDateTime(e.occurredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager paged={paged} noun="events" />
    </Card>
  );
}

function CommandBlockEventsSection({ agentId }: { agentId: string }) {
  const { data: events, isLoading, error } = useAgentCommandBlockEvents(agentId);
  const paged = usePagedList(events ?? []);

  if (!events || events.length === 0) {
    return (
      <SectionState
        title="Command blocking"
        isLoading={isLoading}
        error={error}
        empty={
          <EmptyState
            icon={Terminal}
            title="No command blocking events"
            action={
              <Link className="ep-link" to="/epm">
                Open EPM rules
              </Link>
            }
          >
            Events appear here when a command blocking rule blocks or alerts on a command line.
          </EmptyState>
        }
      />
    );
  }

  return (
    <Card flush title="Command blocking" hint={`${events.length} ${plural(events.length, "event")}`}>
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Command line</th>
              <th scope="col">Process</th>
              <th scope="col">Action</th>
              <th scope="col">Occurred</th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((e) => (
              <tr key={e.id}>
                <td>{e.ruleLabel ?? "—"}</td>
                <td className="ep-mono">{e.matchedCommandLine}</td>
                <td>{e.processName ? <span className="ep-mono">{e.processName}</span> : "—"}</td>
                <td>{e.action === "BLOCKED" ? <Badge tone="crit">Blocked</Badge> : <Badge tone="ok">Alerted</Badge>}</td>
                <td className="app-muted">{formatDateTime(e.occurredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager paged={paged} noun="events" />
    </Card>
  );
}

function UsbControlEventsSection({ agentId }: { agentId: string }) {
  const { data: events, isLoading, error } = useAgentUsbControlEvents(agentId);
  const paged = usePagedList(events ?? []);

  if (!events || events.length === 0) {
    return (
      <SectionState
        title="USB device control"
        isLoading={isLoading}
        error={error}
        empty={
          <EmptyState
            icon={Usb}
            title="No USB device control events"
            action={
              <Link className="ep-link" to="/epm">
                Open EPM rules
              </Link>
            }
          >
            Events appear here when a USB device is allowed or blocked on this endpoint.
          </EmptyState>
        }
      />
    );
  }

  return (
    <Card flush title="USB device control" hint={`${events.length} ${plural(events.length, "event")}`}>
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Serial number</th>
              <th scope="col">Device</th>
              <th scope="col">Action</th>
              <th scope="col">Occurred</th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((e) => (
              <tr key={e.id}>
                <td className="ep-mono">{e.serialNumber}</td>
                <td>{e.deviceDescription ?? "—"}</td>
                <td>{humanize(e.action)}</td>
                <td className="app-muted">{formatDateTime(e.occurredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager paged={paged} noun="events" />
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------
 * Activity
 * ---------------------------------------------------------------------------------------- */

function UserSessionsSection({ agentId }: { agentId: string }) {
  const { data: sessions, isLoading, error } = useAgentUserSessions(agentId);
  const paged = usePagedList(sessions ?? []);

  if (!sessions || sessions.length === 0) {
    return (
      <SectionState
        title="User productivity"
        isLoading={isLoading}
        error={error}
        empty={
          <EmptyState
            icon={Users}
            title="No user sessions recorded"
            action={
              <Link className="ep-link" to="/user-productivity">
                Open user productivity
              </Link>
            }
          >
            Sessions appear here after a user signs in to this endpoint.
          </EmptyState>
        }
      />
    );
  }

  return (
    <Card flush title="User productivity" hint={`${sessions.length} ${plural(sessions.length, "session")}`}>
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Login</th>
              <th scope="col">Logout</th>
              <th scope="col" style={{ textAlign: "right" }}>
                Active
              </th>
              <th scope="col" style={{ textAlign: "right" }}>
                Idle
              </th>
              <th scope="col" style={{ textAlign: "right" }}>
                Total on endpoint
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((s) => (
              <tr key={s.id}>
                <td>{s.username}</td>
                <td className="app-muted">{formatDateTime(s.loginAt)}</td>
                <td className="app-muted">{formatDateTime(s.logoutAt)}</td>
                <td className="ep-num" style={{ textAlign: "right" }}>
                  {formatDuration(s.activeSecondsTotal)}
                </td>
                <td className="ep-num" style={{ textAlign: "right" }}>
                  {formatDuration(s.idleSecondsTotal)}
                </td>
                <td className="ep-num" style={{ textAlign: "right" }}>
                  {formatDuration(s.activeSecondsTotal + s.idleSecondsTotal)}
                </td>
                <td>{s.isActive ? <Badge tone="ok">Active</Badge> : <Badge tone="med">Logged out</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager paged={paged} noun="sessions" />
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------------------------------- */

type TabKey = "overview" | "software" | "security" | "data" | "activity" | "manage";

const backLink = (
  <Link to="/endpoints" className="ep-btn">
    <ArrowLeft size={15} strokeWidth={1.7} className="ep-ic" aria-hidden />
    Back to endpoints
  </Link>
);

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, error, refetch } = useAgent(id);
  const securityConfigHidden = useIsItemHidden("/security-config");
  const zeroTrustHidden = useIsItemHidden("/zero-trust");
  const dataDiscoveryHidden = useIsItemHidden("/data-discovery");
  const dlpHidden = useIsItemHidden("/dlp");
  const dataMovementHidden = useIsItemHidden("/data-movement");
  // App Control, Command Blocking and USB Control are all tabs under the EPM nav item.
  const epmHidden = useIsItemHidden("/epm");
  const userProductivityHidden = useIsItemHidden("/user-productivity");
  const [tab, setTab] = useState<TabKey>("overview");

  if (isLoading) {
    return (
      <>
        <PageHeader title="Endpoint" description="Loading endpoint…" actions={backLink} />
        <Card>
          <Skeleton />
        </Card>
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Endpoint" actions={backLink} />
        <Alert
          tone="critical"
          title="Couldn't load this endpoint"
          action={
            <Button size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          {(error as Error).message}
        </Alert>
      </>
    );
  }
  if (!agent) {
    return (
      <>
        <PageHeader title="Endpoint" actions={backLink} />
        <Card>
          <EmptyState icon={Monitor} title="Endpoint not found" action={<Link className="ep-link" to="/endpoints">Back to endpoints</Link>}>
            It may have been uninstalled or removed. Pick another endpoint from the list.
          </EmptyState>
        </Card>
      </>
    );
  }

  const inv = agent.inventory;

  // A tab whose sections are all hidden by module visibility isn't offered at all.
  const securityTabVisible = !securityConfigHidden || !zeroTrustHidden;
  const dataTabVisible = !dataDiscoveryHidden || !dlpHidden || !dataMovementHidden || !epmHidden;
  const activityTabVisible = !userProductivityHidden;
  const tabs: TabItem[] = [
    { value: "overview", label: "Overview" },
    { value: "software", label: "Software" },
    ...(securityTabVisible ? [{ value: "security", label: "Security" }] : []),
    ...(dataTabVisible ? [{ value: "data", label: "Data protection" }] : []),
    ...(activityTabVisible ? [{ value: "activity", label: "Activity" }] : []),
    { value: "manage", label: "Manage" },
  ];
  // If module visibility hides the open tab (it loads after first paint), fall back to Overview.
  const activeTab: TabKey = tabs.some((t) => t.value === tab) ? tab : "overview";

  return (
    <>
      <PageHeader
        title={<span className="ep-mono">{agent.hostname}</span>}
        description={
          <span className="app-badge-row">
            <Pill tone={agent.status === "ONLINE" ? "ok" : "neutral"}>{agent.status === "ONLINE" ? "Online" : "Offline"}</Pill>
            {agent.quarantined && <Badge tone="crit">Quarantined</Badge>}
            {agent.paused && <Badge tone="med">Paused</Badge>}
            <span>· {agent.osEditionLabel ?? agent.osPlatform}</span>
            {agent.ipAddress && (
              <span>
                · <span className="ep-mono">{agent.ipAddress}</span>
              </span>
            )}
            <span title={formatDateTime(agent.lastCheckinAt, "Never")}>· Last check-in {formatRelative(agent.lastCheckinAt)}</span>
          </span>
        }
        actions={backLink}
      />

      <Tabs items={tabs} value={activeTab} onChange={(v) => setTab(v as TabKey)} />

      {activeTab === "overview" && (
        <Row layout="21">
          <div className="app-stack">
            <DeviceCard agent={agent} />
            <OperatingSystemCard agent={agent} />
            <AgentCard agent={agent} />
            <NetworkCard agent={agent} />
            <AssetFactsCard agent={agent} />
            <StorageCard agent={agent} />
          </div>
          <div className="app-stack">
            <PostureCard agent={agent} />
            <NotesFeed agentId={agent.id} />
          </div>
        </Row>
      )}

      {activeTab === "software" && <InstalledSoftwareSection agentId={agent.id} software={inv?.installedSoftware ?? []} />}

      {activeTab === "security" && (
        <div className="app-stack">
          {!securityConfigHidden && <SecurityFindingsSection agentId={agent.id} />}
          {!zeroTrustHidden && <ZeroTrustFindingsSection agentId={agent.id} />}
        </div>
      )}

      {activeTab === "data" && (
        <div className="app-stack">
          {!dataDiscoveryHidden && <DataDiscoveryFindingsSection agentId={agent.id} />}
          {!dlpHidden && <DlpEventsSection agentId={agent.id} />}
          {!dataMovementHidden && <DataMovementEventsSection agentId={agent.id} />}
          {!epmHidden && (
            <>
              <AppControlEventsSection agentId={agent.id} />
              <CommandBlockEventsSection agentId={agent.id} />
              <UsbControlEventsSection agentId={agent.id} />
            </>
          )}
        </div>
      )}

      {activeTab === "activity" && !userProductivityHidden && <UserSessionsSection agentId={agent.id} />}

      {activeTab === "manage" && (
        <div className="app-stack">
          <AssetDetailsForm agent={agent} />
          <CustomFieldsForm agentId={agent.id} values={agent.customFieldValues} />
          <GroupMembershipEditor agentId={agent.id} currentGroupIds={agent.groups.map((g) => g.id)} />
          <RemoteAccessPanel agent={agent} />
          <PausePanel agent={agent} />
          <UninstallAgentPanel agent={agent} />
        </div>
      )}
    </>
  );
}
