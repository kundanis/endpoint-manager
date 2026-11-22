import { SectionHeader } from "../components/policy";
import { Fragment, useEffect, useState } from "react";
import { ArrowRightLeft, ChevronDown, ChevronRight, Cloud, Monitor, Network, Pencil, Plus, SearchX, Trash2, Usb } from "lucide-react";
import {
  useAgentDataMovementEvents,
  useAssignDataMovementPolicy,
  useCreateDataMovementPolicy,
  useDataMovementAgentBreakdown,
  useDataMovementAssignments,
  useDataMovementPolicies,
  useDataMovementPolicy,
  useDeleteDataMovementPolicy,
  useUnassignDataMovementPolicy,
  useUpdateDataMovementPolicy,
} from "../api/hooks";
import type { DataMovementPolicyDetail } from "../api/types";
import DataMovementEventTable from "../components/DataMovementEventTable";
import EndpointLabel from "../components/EndpointLabel";
import { AssignmentEditor, NewPolicyDialog, PolicyDetail, PolicySettingsForm } from "../components/policy";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  IconButton,
  Kpi,
  KpiStrip,
  Pagination,
  RowMenu,
  Skeleton,
  Switch,
  Tag,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatDateTime } from "../format";
import { useLinkedPolicySelection } from "../usePolicyLink";

function pathsToText(paths: string[]): string {
  return paths.join("\n");
}

function textToPaths(text: string): string[] {
  return text
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
}

function ChannelToggles({
  monitorUsb,
  monitorCloudSync,
  monitorNetworkShare,
  onChange,
}: {
  monitorUsb: boolean;
  monitorCloudSync: boolean;
  monitorNetworkShare: boolean;
  onChange: (next: { monitorUsb: boolean; monitorCloudSync: boolean; monitorNetworkShare: boolean }) => void;
}) {
  return (
    <div className="app-stack-sm" role="group" aria-label="Channels to monitor">
      <span className="app-subhead">Channels to Monitor</span>
      <Check
        checked={monitorUsb}
        onChange={(checked) => onChange({ monitorUsb: checked, monitorCloudSync, monitorNetworkShare })}
        label="USB / removable media"
      />
      <Check
        checked={monitorCloudSync}
        onChange={(checked) => onChange({ monitorUsb, monitorCloudSync: checked, monitorNetworkShare })}
        label="Cloud sync folders (OneDrive, Dropbox, Google Drive)"
      />
      <Check
        checked={monitorNetworkShare}
        onChange={(checked) => onChange({ monitorUsb, monitorCloudSync, monitorNetworkShare: checked })}
        label="Mapped network drives"
      />
    </div>
  );
}

function ExtraPathsField({ id, value, onChange, help }: { id: string; value: string; onChange: (value: string) => void; help: string }) {
  return (
    <Field label="Extra cloud-sync paths" htmlFor={id} help={help}>
      <textarea id={id} className="ep-textarea ep-mono" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function PolicySettingsPanel({ policy }: { policy: DataMovementPolicyDetail }) {
  const updatePolicy = useUpdateDataMovementPolicy();
  const [monitorUsb, setMonitorUsb] = useState(policy.monitorUsb);
  const [monitorCloudSync, setMonitorCloudSync] = useState(policy.monitorCloudSync);
  const [monitorNetworkShare, setMonitorNetworkShare] = useState(policy.monitorNetworkShare);
  const [pathsText, setPathsText] = useState(pathsToText(policy.extraCloudSyncPaths));

  // Name/description are reset by PolicySettingsForm itself.
  useEffect(() => {
    setMonitorUsb(policy.monitorUsb);
    setMonitorCloudSync(policy.monitorCloudSync);
    setMonitorNetworkShare(policy.monitorNetworkShare);
    setPathsText(pathsToText(policy.extraCloudSyncPaths));
  }, [policy.id, policy.name, policy.description, policy.monitorUsb, policy.monitorCloudSync, policy.monitorNetworkShare, policy.extraCloudSyncPaths]);

  return (
    <PolicySettingsForm
      policyId={policy.id}
      name={policy.name}
      description={policy.description}
      onSave={(values) =>
        updatePolicy.mutate({
          id: policy.id,
          name: values.name,
          description: values.description,
          monitorUsb,
          monitorCloudSync,
          monitorNetworkShare,
          extraCloudSyncPaths: textToPaths(pathsText),
        })
      }
      pending={updatePolicy.isPending}
      error={updatePolicy.error}
      saved={updatePolicy.isSuccess}
    >
      <ChannelToggles
        monitorUsb={monitorUsb}
        monitorCloudSync={monitorCloudSync}
        monitorNetworkShare={monitorNetworkShare}
        onChange={(next) => {
          setMonitorUsb(next.monitorUsb);
          setMonitorCloudSync(next.monitorCloudSync);
          setMonitorNetworkShare(next.monitorNetworkShare);
        }}
      />
      <ExtraPathsField
        id={`dm-paths-${policy.id}`}
        value={pathsText}
        onChange={setPathsText}
        help="Optional, one per line. %ENV_VAR% is expanded on each endpoint; OneDrive, Dropbox and Google Drive are already covered automatically."
      />
    </PolicySettingsForm>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = useDataMovementAssignments(policyId);
  const assign = useAssignDataMovementPolicy();
  const unassign = useUnassignDataMovementPolicy();
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

type ActivityFilter = "all" | "usb" | "cloud" | "network";

function CountCell({ count }: { count: number }) {
  return (
    <td className="ep-num" style={{ textAlign: "right" }}>
      {count > 0 ? <Badge tone="med">{count}</Badge> : <span className="app-muted">—</span>}
    </td>
  );
}

// The files one endpoint moved under this policy: name, from where, to where, who.
function AgentMovementDetail({ agentId, policyId }: { agentId: string; policyId: string }) {
  const { data, isLoading, error } = useAgentDataMovementEvents(agentId);
  const events = (data ?? []).filter((e) => e.policyId === policyId);
  const paged = usePagedList(events, 25);
  if (isLoading) return <Skeleton />;
  if (error) return <Alert tone="critical">{(error as Error).message}</Alert>;
  if (events.length === 0) return <EmptyState icon={ArrowRightLeft} title="No files recorded for this endpoint yet" />;
  return (
    <div className="app-stack-sm">
      <DataMovementEventTable events={paged.pageItems} />
      {paged.total > paged.pageSize && (
        <Pagination
          page={paged.page}
          pageSize={paged.pageSize}
          total={paged.total}
          noun="files"
          onPageChange={paged.setPage}
          onPageSizeChange={paged.setPageSize}
        />
      )}
    </div>
  );
}

function ActivityPanel({ policyId }: { policyId: string }) {
  const { data: breakdown, isLoading } = useDataMovementAgentBreakdown(policyId);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  const agents = breakdown?.agents ?? [];
  const usbTotal = agents.reduce((sum, a) => sum + a.usbCount, 0);
  const cloudTotal = agents.reduce((sum, a) => sum + a.cloudSyncCount, 0);
  const networkTotal = agents.reduce((sum, a) => sum + a.networkShareCount, 0);
  const filtered = agents.filter((a) => {
    if (filter === "usb") return a.usbCount > 0;
    if (filter === "cloud") return a.cloudSyncCount > 0;
    if (filter === "network") return a.networkShareCount > 0;
    return true;
  });
  const paged = usePagedList(filtered, 25);

  return (
    <div className="app-stack">
      <KpiStrip>
        <Kpi icon={Monitor} label="Total devices" value={agents.length} suffix="assigned" active={filter === "all"} onClick={() => setFilter("all")} />
        <Kpi
          icon={Usb}
          label="USB copies"
          value={usbTotal}
          suffix="files"
          valueTone={usbTotal > 0 ? "critical" : undefined}
          active={filter === "usb"}
          onClick={() => setFilter("usb")}
        />
        <Kpi icon={Cloud} label="Cloud sync" value={cloudTotal} suffix="files" active={filter === "cloud"} onClick={() => setFilter("cloud")} />
        <Kpi icon={Network} label="Network share" value={networkTotal} suffix="files" active={filter === "network"} onClick={() => setFilter("network")} />
      </KpiStrip>

      {isLoading ? (
        <Skeleton />
      ) : agents.length === 0 ? (
        <EmptyState icon={Monitor} title="Not assigned to any endpoint yet">
          Assign the policy in the Assignment tab to start tracking data movement.
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
                <th scope="col" style={{ textAlign: "right" }}>
                  USB
                </th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Cloud sync
                </th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Network share
                </th>
                <th scope="col">Last event</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((a) => {
                const canExpand = a.eventCount > 0;
                const isExpanded = expandedAgentId === a.agentId;
                const toggle = () => setExpandedAgentId(isExpanded ? null : a.agentId);
                return (
                  <Fragment key={a.agentId}>
                    <tr
                      className={`${canExpand ? "app-clickable" : ""} ${isExpanded ? "ep-sel" : ""}`}
                      onClick={canExpand ? toggle : undefined}
                      title={canExpand ? "Click to show each file, where it came from and where it went" : undefined}
                    >
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {canExpand && (
                            <IconButton
                              icon={isExpanded ? ChevronDown : ChevronRight}
                              label={isExpanded ? `Hide files from ${a.hostname}` : `Show files from ${a.hostname}`}
                              aria-expanded={isExpanded}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle();
                              }}
                            />
                          )}
                          <span onClick={(e) => e.stopPropagation()}>
                            <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
                          </span>
                        </span>
                      </td>
                      <CountCell count={a.usbCount} />
                      <CountCell count={a.cloudSyncCount} />
                      <CountCell count={a.networkShareCount} />
                      <td className="app-muted">{formatDateTime(a.lastEventAt)}</td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} style={{ background: "var(--ep-surface-2)" }}>
                          <AgentMovementDetail agentId={a.agentId} policyId={policyId} />
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

export default function DataMovementPage() {
  const { data: policies, isLoading, error, refetch } = useDataMovementPolicies();
  const createPolicy = useCreateDataMovementPolicy();
  const updatePolicy = useUpdateDataMovementPolicy();
  const deletePolicy = useDeleteDataMovementPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useLinkedPolicySelection();
  const [creating, setCreating] = useState(false);
  const [monitorUsb, setMonitorUsb] = useState(true);
  const [monitorCloudSync, setMonitorCloudSync] = useState(true);
  const [monitorNetworkShare, setMonitorNetworkShare] = useState(true);
  const [pathsText, setPathsText] = useState("");

  const { data: policy } = useDataMovementPolicy(selectedId);

  function handleCreate(values: { name: string; description: string | null }) {
    return createPolicy
      .mutateAsync({
        name: values.name,
        description: values.description,
        monitorUsb,
        monitorCloudSync,
        monitorNetworkShare,
        extraCloudSyncPaths: textToPaths(pathsText),
      })
      .then((result) => {
        setSelectedId(result.id);
        setPathsText("");
      });
  }

  function toggleEnabled(id: string, enabled: boolean) {
    updatePolicy.mutate({ id, enabled });
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm({
      title: `Delete Policy "${name}"?`,
      body: "Assigned endpoints stop tracking data movement for it. This cannot be undone.",
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
      <SectionHeader
        title="File Movement"
        description="Files copied to USB or removable drives, cloud-sync folders and mapped network drives."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        }
      />

      <Alert tone="info" title="Periodic heuristic, not real-time interception">
        Files recently copied to a USB/removable drive, written into a cloud-sync folder (OneDrive, Dropbox, Google
        Drive), or copied onto a mapped network drive are detected by a lightweight, agent-side heuristic
        (recently-modified files in monitored locations on a periodic scan), not a real-time kernel-level interception
        — it can miss a very fast copy-then-move, or occasionally flag a file that was just edited in place rather than
        copied.
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
            icon={ArrowRightLeft}
            title="No data movement policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, choose the channels to monitor, then assign it to groups or endpoints.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Policy</th>
                  <th scope="col">Status</th>
                  <th scope="col">Channels</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Assigned endpoints
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Events
                  </th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => {
                  const channels = [p.monitorUsb && "USB", p.monitorCloudSync && "Cloud sync", p.monitorNetworkShare && "Network share"].filter(
                    (c): c is string => !!c,
                  );
                  return (
                    <tr key={p.id} className={`app-clickable ${p.id === selectedId ? "ep-sel" : ""}`} onClick={() => setSelectedId(p.id)}>
                      <td className="ep-host">
                        <b>{p.name}</b>
                        {p.description && <span className="app-row-sub">{p.description}</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Switch checked={p.enabled} onChange={(enabled) => toggleEnabled(p.id, enabled)} label={p.enabled ? "Enabled" : "Paused"} />
                      </td>
                      <td>
                        {channels.length > 0 ? (
                          <div className="app-badge-row">
                            {channels.map((c) => (
                              <Tag key={c}>{c}</Tag>
                            ))}
                          </div>
                        ) : (
                          <span className="app-muted">None</span>
                        )}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {p.assignedAgentCount}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {p.eventCount}
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
                  );
                })}
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
          meta={`${policy.eventCount} ${policy.eventCount === 1 ? "event" : "events"} · ${policy.assignedAgentCount} ${policy.assignedAgentCount === 1 ? "endpoint" : "endpoints"}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "activity", label: "Activity", content: <ActivityPanel policyId={policy.id} /> },
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
          onCreate={handleCreate}
        >
          <ChannelToggles
            monitorUsb={monitorUsb}
            monitorCloudSync={monitorCloudSync}
            monitorNetworkShare={monitorNetworkShare}
            onChange={(next) => {
              setMonitorUsb(next.monitorUsb);
              setMonitorCloudSync(next.monitorCloudSync);
              setMonitorNetworkShare(next.monitorNetworkShare);
            }}
          />
          <ExtraPathsField
            id="dm-new-paths"
            value={pathsText}
            onChange={setPathsText}
            help="Optional, one per line. %ENV_VAR% is expanded on each endpoint."
          />
        </NewPolicyDialog>
      )}
    </>
  );
}
