import { Fragment, useEffect, useState } from "react";
import { Camera, ChevronDown, ChevronRight, ClipboardX, Keyboard, Monitor, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import {
  useAssignScreenshotBlockPolicy,
  useCreateScreenshotBlockPolicy,
  useDeleteScreenshotBlockPolicy,
  useScreenshotBlockActivity,
  useScreenshotBlockAgentEvents,
  useScreenshotBlockAssignments,
  useScreenshotBlockPolicies,
  useScreenshotBlockPolicy,
  useUnassignScreenshotBlockPolicy,
  useUpdateScreenshotBlockPolicy,
} from "../api/hooks";
import type { ScreenshotBlockEventView, ScreenshotBlockPolicyView } from "../api/types";
import EndpointLabel from "../components/EndpointLabel";
import { AssignmentEditor, NewPolicyDialog, PolicyDetail, PolicySettingsForm, SectionHeader } from "../components/policy";
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

// EPM -> Screenshot blocking: policy list -> selected policy's Activity / Assignment / Settings.
// Endpoints swallow the screenshot keys, close screenshot tools and (optionally) clear pictures
// from the clipboard; each blocked attempt is listed under Activity.

interface SettingsValues {
  blockKeys: boolean;
  blockTools: boolean;
  blockClipboardImages: boolean;
  extraToolsText: string;
}

const DEFAULT_SETTINGS: SettingsValues = { blockKeys: true, blockTools: true, blockClipboardImages: false, extraToolsText: "" };

const EXE = /^[^\\/:*?"<>|]+\.exe$/i;

function textToTools(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function toSettings(p: ScreenshotBlockPolicyView): SettingsValues {
  return { blockKeys: p.blockKeys, blockTools: p.blockTools, blockClipboardImages: p.blockClipboardImages, extraToolsText: p.extraTools.join("\n") };
}

function toBody(v: SettingsValues) {
  return { blockKeys: v.blockKeys, blockTools: v.blockTools, blockClipboardImages: v.blockClipboardImages, extraTools: textToTools(v.extraToolsText) };
}

function badTools(v: SettingsValues): string[] {
  return textToTools(v.extraToolsText).filter((t) => !EXE.test(t));
}

function settingsValid(v: SettingsValues): boolean {
  const anything = v.blockKeys || v.blockTools || v.blockClipboardImages || textToTools(v.extraToolsText).length > 0;
  return anything && badTools(v).length === 0;
}

function whatList(p: ScreenshotBlockPolicyView): string[] {
  return [
    p.blockKeys && "Screenshot keys",
    p.blockTools && "Screenshot tools",
    p.blockClipboardImages && "Clipboard pictures",
    p.extraTools.length > 0 && `${p.extraTools.length} extra ${p.extraTools.length === 1 ? "program" : "programs"}`,
  ].filter((s): s is string => !!s);
}

function SettingsFields({ idPrefix, value, onChange }: { idPrefix: string; value: SettingsValues; onChange: (next: SettingsValues) => void }) {
  const set = (patch: Partial<SettingsValues>) => onChange({ ...value, ...patch });
  const bad = badTools(value);
  return (
    <>
      <div className="app-stack-sm" role="group" aria-label="What to block">
        <span className="app-subhead">What to block</span>
        <Check
          checked={value.blockKeys}
          onChange={(c) => set({ blockKeys: c })}
          label="Screenshot keys"
          hint="Print Screen (alone, with Alt or with Win), Win+Shift+S and Win+Shift+R do nothing"
        />
        <Check
          checked={value.blockTools}
          onChange={(c) => set({ blockTools: c })}
          label="Screenshot tools"
          hint="Snipping Tool, Snip & Sketch, ShareX, Greenshot, Lightshot, PicPick, Snagit, OBS and others are closed when they open; Windows' Snipping Tool, Game Bar capture and Edge's web capture are turned off"
        />
        <Check
          checked={value.blockClipboardImages}
          onChange={(c) => set({ blockClipboardImages: c })}
          label="Pictures copied to the clipboard"
          hint="Removes any picture placed on the clipboard, which also stops tools not in the list. Users can't copy and paste pictures at all, for example from a web page into Word."
        />
      </div>
      <Field
        label="Other screenshot programs"
        htmlFor={`${idPrefix}-tools`}
        help="Optional, one program file name per line (for example Capture.exe). Closed when they open, like the built-in tools."
      >
        <textarea
          id={`${idPrefix}-tools`}
          className="ep-textarea ep-mono"
          rows={3}
          value={value.extraToolsText}
          placeholder="Capture.exe"
          onChange={(e) => set({ extraToolsText: e.target.value })}
        />
      </Field>
      {bad.length > 0 && <Alert tone="warn">Use program file names ending in .exe: {bad.join(", ")}</Alert>}
      {!value.blockKeys && !value.blockTools && !value.blockClipboardImages && textToTools(value.extraToolsText).length === 0 && (
        <Alert tone="warn">Choose at least one thing to block.</Alert>
      )}
    </>
  );
}

function PolicySettingsPanel({ policy }: { policy: ScreenshotBlockPolicyView }) {
  const updatePolicy = useUpdateScreenshotBlockPolicy();
  const [settings, setSettings] = useState(toSettings(policy));

  useEffect(() => {
    setSettings(toSettings(policy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.id, policy.blockKeys, policy.blockTools, policy.blockClipboardImages, policy.extraTools.join(",")]);

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
      <SettingsFields idPrefix={`ssb-${policy.id}`} value={settings} onChange={setSettings} />
    </PolicySettingsForm>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = useScreenshotBlockAssignments(policyId);
  const assign = useAssignScreenshotBlockPolicy();
  const unassign = useUnassignScreenshotBlockPolicy();
  return (
    <AssignmentEditor
      assignments={assignments}
      onUnassign={(assignmentId) => unassign.mutate({ policyId, assignmentId })}
      unassignPending={unassign.isPending}
      onAssign={(agentIds, groupIds, done) => assign.mutate({ policyId, agentIds, groupIds }, { onSuccess: done })}
      assignPending={assign.isPending}
      assignError={assign.error}
      blocking
    />
  );
}

const KIND_LABEL: Record<ScreenshotBlockEventView["kind"], string> = {
  KEY: "Screenshot key",
  TOOL: "Tool closed",
  CLIPBOARD: "Clipboard picture removed",
};

function AgentEvents({ agentId, days }: { agentId: string; days: number }) {
  const { data: events, isLoading, error } = useScreenshotBlockAgentEvents(agentId, days);
  const paged = usePagedList(events ?? [], 25);
  if (isLoading) return <Skeleton lines={3} />;
  if (error) return <Alert tone="critical">{(error as Error).message}</Alert>;
  if (!events || events.length === 0) return <span className="app-muted">No blocked attempts in this period.</span>;
  return (
    <div className="app-stack-sm">
      <table className="ep-tbl">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">User</th>
            <th scope="col">Blocked</th>
            <th scope="col">What</th>
          </tr>
        </thead>
        <tbody>
          {paged.pageItems.map((e) => (
            <tr key={e.id}>
              <td className="ep-num">{formatDateTime(e.occurredAt)}</td>
              <td>{e.username || <span className="app-muted">—</span>}</td>
              <td>
                <Badge tone="med">{KIND_LABEL[e.kind] ?? e.kind}</Badge>
              </td>
              <td className={e.kind === "TOOL" ? "ep-mono" : undefined}>{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {paged.total > paged.pageSize && (
        <Pagination
          page={paged.page}
          pageSize={paged.pageSize}
          total={paged.total}
          noun="attempts"
          onPageChange={paged.setPage}
          onPageSizeChange={paged.setPageSize}
        />
      )}
    </div>
  );
}

const RANGES = [
  { days: 1, label: "Last 24 hours" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
];

function syncBadge(status: string | null, error: string | null) {
  if (!status) return <span className="app-muted">Waiting for first sync</span>;
  return status === "SUCCESS" ? <Badge tone="ok">Applied</Badge> : <span title={error ?? undefined}><Badge tone="crit">Failed</Badge></span>;
}

function ActivityPanel({ policy }: { policy: ScreenshotBlockPolicyView }) {
  const [days, setDays] = useState(7);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading, error } = useScreenshotBlockActivity(policy.id, days);
  const agents = data?.agents ?? [];
  const paged = usePagedList(agents, 25);
  const keyTotal = agents.reduce((n, a) => n + a.keyCount, 0);
  const toolTotal = agents.reduce((n, a) => n + a.toolCount, 0);
  const clipTotal = agents.reduce((n, a) => n + a.clipboardCount, 0);

  return (
    <div className="app-stack">
      <div className="app-cell-actions" style={{ justifyContent: "space-between" }}>
        <span className="app-muted">Every blocked screenshot attempt on this policy&apos;s endpoints. Select an endpoint to see who tried and how.</span>
        <select className="ep-select" aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <KpiStrip>
        <Kpi icon={Monitor} label="Endpoints" value={agents.length} suffix="assigned" />
        <Kpi icon={Keyboard} label="Screenshot keys" value={keyTotal} suffix="blocked" />
        <Kpi icon={XCircle} label="Tools closed" value={toolTotal} />
        <Kpi icon={ClipboardX} label="Clipboard pictures" value={clipTotal} suffix="removed" />
      </KpiStrip>
      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <Alert tone="critical" title="Couldn't load activity">
          {(error as Error).message}
        </Alert>
      ) : agents.length === 0 ? (
        <EmptyState icon={Camera} title="Not assigned to any endpoint yet">
          Assign the policy in the Assignment tab to start blocking screenshots.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">Status</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Keys
                </th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Tools
                </th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Clipboard
                </th>
                <th scope="col">Last blocked</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((a) => {
                const total = a.keyCount + a.toolCount + a.clipboardCount;
                const isOpen = expanded === a.agentId;
                const toggle = () => setExpanded(isOpen ? null : a.agentId);
                const count = (n: number) => (n > 0 ? <Badge tone="med">{n}</Badge> : <span className="app-muted">—</span>);
                return (
                  <Fragment key={a.agentId}>
                    <tr className={`${total > 0 ? "app-clickable" : ""} ${isOpen ? "ep-sel" : ""}`} onClick={total > 0 ? toggle : undefined}>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {total > 0 && (
                            <IconButton
                              icon={isOpen ? ChevronDown : ChevronRight}
                              label={isOpen ? `Hide attempts on ${a.hostname}` : `Show attempts on ${a.hostname}`}
                              aria-expanded={isOpen}
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
                      <td>
                        {syncBadge(a.lastSyncStatus, a.lastSyncError)}
                        {a.lastSyncedAt && <span className="app-row-sub">{formatDateTime(a.lastSyncedAt)}</span>}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {count(a.keyCount)}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {count(a.toolCount)}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {count(a.clipboardCount)}
                      </td>
                      <td className="app-muted">{formatDateTime(a.lastBlockedAt)}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ background: "var(--ep-surface-2)" }}>
                          <AgentEvents agentId={a.agentId} days={days} />
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
            noun="endpoints"
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
        </div>
      )}
    </div>
  );
}

export default function ScreenshotBlockPage() {
  const { data: policies, isLoading, error, refetch } = useScreenshotBlockPolicies();
  const createPolicy = useCreateScreenshotBlockPolicy();
  const updatePolicy = useUpdateScreenshotBlockPolicy();
  const deletePolicy = useDeleteScreenshotBlockPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [newSettings, setNewSettings] = useState(DEFAULT_SETTINGS);
  const { data: policy } = useScreenshotBlockPolicy(selectedId);

  function handleCreate(values: { name: string; description: string | null }) {
    return createPolicy.mutateAsync({ name: values.name, description: values.description, ...toBody(newSettings) }).then((result) => {
      setSelectedId(result.id);
      setNewSettings(DEFAULT_SETTINGS);
    });
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Delete policy "${name}"?`,
      body: "Its endpoints can take screenshots again within a minute, unless another policy still blocks them. The blocked attempts already recorded stay. This cannot be undone.",
      confirmLabel: "Delete policy",
      tone: "danger",
    });
    if (ok) deletePolicy.mutate(id, { onSuccess: () => selectedId === id && setSelectedId(undefined) });
  }

  return (
    <>
      <SectionHeader
        title="Screenshot blocking"
        description="Stop users taking screenshots on assigned endpoints: the Print Screen and Win+Shift+S keys do nothing, screenshot tools are closed when they open and, optionally, pictures copied to the clipboard are removed. Users are told each time, and every attempt is listed under Activity."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        }
      />

      <Alert tone="info" title="Windows endpoints, agent 0.2.25 or later">
        What can&apos;t be stopped: a photo of the screen taken with a phone, and screenshots taken on another computer of a remote-access session to
        this one. To see who tries anyway, use Screen capture monitoring and User risk.
      </Alert>

      <Card flush title="Policies" hint={policies ? `${policies.length} total · paused policies don't block anything` : undefined}>
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
            icon={Camera}
            title="No screenshot blocking policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, choose what to block, then assign it to groups or endpoints.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Policy</th>
                  <th scope="col">Status</th>
                  <th scope="col">Blocks</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Assigned endpoints
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Blocked (7 days)
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
                        {whatList(p).map((s) => (
                          <Tag key={s}>{s}</Tag>
                        ))}
                      </div>
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.assignedAgentCount}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.blocked7d > 0 ? <Badge tone="med">{p.blocked7d}</Badge> : <span className="app-muted">0</span>}
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
          meta={`${whatList(policy).join(" · ")} · ${policy.assignedAgentCount} ${policy.assignedAgentCount === 1 ? "endpoint" : "endpoints"}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "activity", label: "Activity", content: <ActivityPanel policy={policy} /> },
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
          extraValid={settingsValid(newSettings)}
          onCreate={handleCreate}
        >
          <SettingsFields idPrefix="ssb-new" value={newSettings} onChange={setNewSettings} />
        </NewPolicyDialog>
      )}
    </>
  );
}
