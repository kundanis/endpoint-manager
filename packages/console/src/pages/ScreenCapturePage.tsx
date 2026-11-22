import { Fragment, useEffect, useState } from "react";
import { AppWindow, Camera, ChevronDown, ChevronRight, Download, Image as ImageIcon, Pencil, Plus, SearchX, Trash2, TriangleAlert, Users } from "lucide-react";
import {
  downloadScreenCaptureImages,
  screenCaptureImageUrl,
  useAgents,
  useAssignScreenCapturePolicy,
  useDeleteScreenCaptureImages,
  useMe,
  useCreateScreenCapturePolicy,
  useDeleteScreenCapturePolicy,
  useScreenCaptureAssignments,
  useScreenCapturePolicies,
  useScreenCapturePolicy,
  useScreenCaptureReport,
  useScreenCaptures,
  useUnassignScreenCapturePolicy,
  useUpdateScreenCapturePolicy,
} from "../api/hooks";
import type { ScreenCaptureItem, ScreenCapturePolicyDetail, ScreenCaptureReportRow, ScreenCaptureSourceKey } from "../api/types";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import { SOURCE_LABEL, ScreenCaptureDailyTable, ScreenCaptureList } from "../components/ScreenCaptureReportView";
import { AssignmentEditor, NewPolicyDialog, PolicyDetail, PolicySettingsForm, SectionHeader } from "../components/policy";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  FormGrid,
  IconButton,
  Kpi,
  KpiStrip,
  Modal,
  Pagination,
  RowMenu,
  Skeleton,
  Switch,
  Tag,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatBytes, formatDateTime } from "../format";
import { useLinkedPolicySelection } from "../usePolicyLink";

// DLP -> Screen capture: policy list -> selected policy's Report / Assignment / Settings tabs.
// The agent records screenshots as they are saved (so deleting one doesn't hide it), deletions,
// and the programs that opened each one; this page turns that into a per-user, per-day report.

interface SettingsValues {
  dailyThreshold: number;
  quickDeleteMinutes: number;
  monitorWindows: boolean;
  monitorSnippingTool: boolean;
  monitorGameBar: boolean;
  monitorThirdParty: boolean;
  extraPathsText: string;
  trackOpenedBy: boolean;
}

const DEFAULT_SETTINGS: SettingsValues = {
  dailyThreshold: 10,
  quickDeleteMinutes: 10,
  monitorWindows: true,
  monitorSnippingTool: true,
  monitorGameBar: true,
  monitorThirdParty: true,
  extraPathsText: "",
  trackOpenedBy: true,
};

function textToPaths(text: string): string[] {
  return text
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
}

function toSettings(p: ScreenCapturePolicyDetail): SettingsValues {
  return {
    dailyThreshold: p.dailyThreshold,
    quickDeleteMinutes: p.quickDeleteMinutes,
    monitorWindows: p.monitorWindows,
    monitorSnippingTool: p.monitorSnippingTool,
    monitorGameBar: p.monitorGameBar,
    monitorThirdParty: p.monitorThirdParty,
    extraPathsText: p.extraPaths.join("\n"),
    trackOpenedBy: p.trackOpenedBy,
  };
}

function toBody(v: SettingsValues) {
  const { extraPathsText, ...rest } = v;
  return { ...rest, extraPaths: textToPaths(extraPathsText) };
}

function settingsValid(v: SettingsValues): boolean {
  const anySource = v.monitorWindows || v.monitorSnippingTool || v.monitorGameBar || v.monitorThirdParty || textToPaths(v.extraPathsText).length > 0;
  return anySource && v.dailyThreshold >= 1 && v.quickDeleteMinutes >= 1;
}

function sourceList(p: ScreenCapturePolicyDetail): string[] {
  return [
    p.monitorWindows && SOURCE_LABEL.WINDOWS,
    p.monitorSnippingTool && SOURCE_LABEL.SNIPPING_TOOL,
    p.monitorGameBar && SOURCE_LABEL.GAME_BAR,
    p.monitorThirdParty && SOURCE_LABEL.THIRD_PARTY,
    p.extraPaths.length > 0 && SOURCE_LABEL.CUSTOM,
  ].filter((s): s is string => !!s);
}

function SettingsFields({ idPrefix, value, onChange }: { idPrefix: string; value: SettingsValues; onChange: (next: SettingsValues) => void }) {
  const set = (patch: Partial<SettingsValues>) => onChange({ ...value, ...patch });
  return (
    <>
      <FormGrid>
        <Field label="Daily threshold" htmlFor={`${idPrefix}-threshold`} required help="Flag a user who takes more than this many screenshots in a day.">
          <input
            id={`${idPrefix}-threshold`}
            type="number"
            min={1}
            max={10000}
            className="ep-input"
            value={value.dailyThreshold}
            onChange={(e) => set({ dailyThreshold: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            required
          />
        </Field>
        <Field label="Quick delete (minutes)" htmlFor={`${idPrefix}-quick`} required help="Flag a screenshot deleted within this many minutes of being taken.">
          <input
            id={`${idPrefix}-quick`}
            type="number"
            min={1}
            max={1440}
            className="ep-input"
            value={value.quickDeleteMinutes}
            onChange={(e) => set({ quickDeleteMinutes: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            required
          />
        </Field>
      </FormGrid>
      <div className="app-stack-sm" role="group" aria-label="Screenshot sources">
        <span className="app-subhead">Screenshot Sources</span>
        <Check checked={value.monitorWindows} onChange={(c) => set({ monitorWindows: c })} label="Windows screenshots" hint="Win + PrtScn, and screenshots saved to OneDrive" />
        <Check checked={value.monitorSnippingTool} onChange={(c) => set({ monitorSnippingTool: c })} label="Snipping Tool" hint="Win + Shift + S and PrtScn on Windows 11, including captures that were never saved" />
        <Check checked={value.monitorGameBar} onChange={(c) => set({ monitorGameBar: c })} label="Xbox Game Bar" hint="Win + Alt + PrtScn screenshots and recordings" />
        <Check checked={value.monitorThirdParty} onChange={(c) => set({ monitorThirdParty: c })} label="ShareX" hint="Its default screenshot folder" />
      </div>
      <Field
        label="Other screenshot folders"
        htmlFor={`${idPrefix}-paths`}
        help="Optional, one per line, for other tools such as Greenshot. %USERPROFILE% and similar are expanded for every user."
      >
        <textarea
          id={`${idPrefix}-paths`}
          className="ep-textarea ep-mono"
          rows={3}
          value={value.extraPathsText}
          placeholder={"%USERPROFILE%\\Pictures\\Greenshot"}
          onChange={(e) => set({ extraPathsText: e.target.value })}
        />
      </Field>
      <Check
        checked={value.trackOpenedBy}
        onChange={(c) => set({ trackOpenedBy: c })}
        label="Record which programs open each screenshot"
        hint="Turns on Windows file-access auditing for these folders, so a browser, WhatsApp, Outlook or OneDrive opening a screenshot is reported"
      />
      {!settingsValid(value) && <Alert tone="warn">Choose at least one source, and use thresholds of 1 or more.</Alert>}
    </>
  );
}

function PolicySettingsPanel({ policy }: { policy: ScreenCapturePolicyDetail }) {
  const updatePolicy = useUpdateScreenCapturePolicy();
  const [settings, setSettings] = useState(toSettings(policy));

  useEffect(() => {
    setSettings(toSettings(policy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.id, policy.dailyThreshold, policy.quickDeleteMinutes, policy.monitorWindows, policy.monitorSnippingTool, policy.monitorGameBar, policy.monitorThirdParty, policy.extraPaths, policy.trackOpenedBy]);

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
      <SettingsFields idPrefix={`sc-${policy.id}`} value={settings} onChange={setSettings} />
    </PolicySettingsForm>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = useScreenCaptureAssignments(policyId);
  const assign = useAssignScreenCapturePolicy();
  const unassign = useUnassignScreenCapturePolicy();
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

// Super admins only: whether this policy keeps the screenshot images, from which endpoints and
// for how long. Saved separately from the other settings.
function ImagesPanel({ policy }: { policy: ScreenCapturePolicyDetail }) {
  const updatePolicy = useUpdateScreenCapturePolicy();
  const { data: agents } = useAgents();
  const [saveImages, setSaveImages] = useState(policy.saveImages);
  const [allEndpoints, setAllEndpoints] = useState(policy.saveImagesAllEndpoints);
  const [agentIds, setAgentIds] = useState<string[]>(policy.saveImagesAgentIds);
  const [retention, setRetention] = useState(policy.imageRetentionDays);

  useEffect(() => {
    setSaveImages(policy.saveImages);
    setAllEndpoints(policy.saveImagesAllEndpoints);
    setAgentIds(policy.saveImagesAgentIds);
    setRetention(policy.imageRetentionDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.id, policy.saveImages, policy.saveImagesAllEndpoints, policy.saveImagesAgentIds.join(","), policy.imageRetentionDays]);

  const retentionValid = retention >= 7 && retention <= 365;
  const selectionValid = !saveImages || allEndpoints || agentIds.length > 0;
  const toggle = (id: string) => setAgentIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <form
      className="app-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!retentionValid || !selectionValid) return;
        updatePolicy.mutate({ id: policy.id, saveImages, saveImagesAllEndpoints: allEndpoints, saveImagesAgentIds: agentIds, imageRetentionDays: retention });
      }}
    >
      <Alert tone="warn" title="Screenshots can contain passwords, chats and personal data">
        Only super admins can see, download or delete the images; other admins see the list and counts only. Every view of a user&apos;s
        screenshots, download and deletion is recorded in Admin logs. Tell users that screenshots on these PCs are kept.
      </Alert>
      <Switch checked={saveImages} onChange={setSaveImages} label={saveImages ? "Keep screenshot images" : "Don't keep images (details only)"} />
      {saveImages && (
        <>
          <FormGrid>
            <Field label="Keep images from" htmlFor={`sc-img-scope-${policy.id}`}>
              <select
                id={`sc-img-scope-${policy.id}`}
                className="ep-select"
                value={allEndpoints ? "all" : "selected"}
                onChange={(e) => setAllEndpoints(e.target.value === "all")}
              >
                <option value="all">Every endpoint this policy is assigned to</option>
                <option value="selected">Only the endpoints selected below</option>
              </select>
            </Field>
            <Field label="Keep images for (days)" htmlFor={`sc-img-days-${policy.id}`} required help="7 to 365. Deleted automatically after this, or earlier by a super admin.">
              <input
                id={`sc-img-days-${policy.id}`}
                type="number"
                min={7}
                max={365}
                className="ep-input"
                value={retention}
                onChange={(e) => setRetention(Math.floor(Number(e.target.value) || 0))}
                required
              />
            </Field>
          </FormGrid>
          {!allEndpoints && <EndpointCheckboxList agents={agents} selectedAgentIds={agentIds} onToggle={toggle} legend="Keep images from these endpoints" />}
          <span className="app-muted">
            Images are kept only from endpoints the policy is assigned to, with Windows agent 0.2.25 or later. Screen recordings (videos) and
            images over 15 MB are never kept; they still appear in the report.
          </span>
        </>
      )}
      {!retentionValid && <Alert tone="warn">Keep images for 7 to 365 days.</Alert>}
      {!selectionValid && <Alert tone="warn">Select at least one endpoint, or keep images from every endpoint.</Alert>}
      {updatePolicy.error && <Alert tone="critical">{(updatePolicy.error as Error).message}</Alert>}
      <div className="app-actions-row">
        <Button type="submit" variant="primary" disabled={updatePolicy.isPending || !retentionValid || !selectionValid}>
          Save
        </Button>
        {updatePolicy.isSuccess && <span className="app-muted">Saved. Endpoints pick it up within a minute.</span>}
      </div>
    </form>
  );
}

function CaptureList({ policyId, row }: { policyId: string; row: ScreenCaptureReportRow }) {
  const { data: captures, isLoading } = useScreenCaptures(policyId, row);
  return <ScreenCaptureList captures={captures} isLoading={isLoading} />;
}

type ReportFilter = "all" | "flagged" | "quick" | "opened";

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
];

function ReportPanel({ policy }: { policy: ScreenCapturePolicyDetail }) {
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState<ReportFilter>("all");
  const [agentId, setAgentId] = useState("");
  const { data: report, isLoading, error } = useScreenCaptureReport(policy.id, days, agentId || undefined);
  const endpoints = report?.endpoints ?? [];

  const rows = (report?.rows ?? []).filter((r) => {
    if (filter === "flagged") return r.overThreshold;
    if (filter === "quick") return r.quickDeleted > 0;
    if (filter === "opened") return r.openedBy.length > 0;
    return true;
  });
  const totals = report?.totals;

  return (
    <div className="app-stack">
      <div className="app-cell-actions" style={{ justifyContent: "space-between" }}>
        <span className="app-muted">
          A user is flagged after more than <b>{policy.dailyThreshold}</b> screenshots in a day. Deleted within{" "}
          {policy.quickDeleteMinutes} min counts as a quick delete.
        </span>
        <div className="app-cell-actions">
          <select className="ep-select" aria-label="Endpoint" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">All endpoints</option>
            {agentId && !endpoints.some((ep) => ep.agentId === agentId) && <option value={agentId}>Selected endpoint</option>}
            {endpoints.map((ep) => (
              <option key={ep.agentId} value={ep.agentId}>
                {ep.hostname ?? ep.agentId}
              </option>
            ))}
          </select>
          <select className="ep-select" aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <KpiStrip>
        <Kpi icon={Camera} label="Screenshots" value={totals?.captures ?? "—"} active={filter === "all"} onClick={() => setFilter("all")} />
        <Kpi
          icon={Users}
          label="Over threshold"
          value={totals?.flaggedUserDays ?? "—"}
          suffix="user-days"
          valueTone={totals && totals.flaggedUserDays > 0 ? "critical" : undefined}
          active={filter === "flagged"}
          onClick={() => setFilter("flagged")}
        />
        <Kpi
          icon={TriangleAlert}
          label="Deleted quickly"
          value={totals?.quickDeleted ?? "—"}
          valueTone={totals && totals.quickDeleted > 0 ? "warning" : undefined}
          active={filter === "quick"}
          onClick={() => setFilter("quick")}
        />
        <Kpi
          icon={AppWindow}
          label="Opened by other apps"
          value={totals?.openedByOtherApps ?? "—"}
          valueTone={totals && totals.openedByOtherApps > 0 ? "warning" : undefined}
          active={filter === "opened"}
          onClick={() => setFilter("opened")}
        />
      </KpiStrip>

      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <Alert tone="critical" title="Couldn't load the report">
          {(error as Error).message}
        </Alert>
      ) : policy.assignedAgentCount === 0 ? (
        <EmptyState icon={Camera} title="Not assigned to any endpoint yet">
          Assign the policy in the Assignment tab to start recording screenshots.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={(report?.rows.length ?? 0) > 0 ? "Nothing matches this filter" : agentId ? "No screenshots from this endpoint in this period" : "No screenshots in this period"}
          action={
            filter !== "all" || agentId ? (
              <Button
                size="sm"
                onClick={() => {
                  setFilter("all");
                  setAgentId("");
                }}
              >
                Show everything
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ScreenCaptureDailyTable rows={rows} renderCaptures={(r: ScreenCaptureReportRow) => <CaptureList policyId={policy.id} row={r} />} />
      )}
    </div>
  );
}

export default function ScreenCapturePage() {
  const { data: policies, isLoading, error, refetch } = useScreenCapturePolicies();
  const { data: me } = useMe();
  const isSuperAdmin = me?.role === "SUPER_ADMIN";
  const createPolicy = useCreateScreenCapturePolicy();
  const updatePolicy = useUpdateScreenCapturePolicy();
  const deletePolicy = useDeleteScreenCapturePolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useLinkedPolicySelection();
  const [creating, setCreating] = useState(false);
  const [newSettings, setNewSettings] = useState(DEFAULT_SETTINGS);

  const { data: policy } = useScreenCapturePolicy(selectedId);

  function handleCreate(values: { name: string; description: string | null }) {
    return createPolicy.mutateAsync({ name: values.name, description: values.description, ...toBody(newSettings) }).then((result) => {
      setSelectedId(result.id);
      setNewSettings(DEFAULT_SETTINGS);
    });
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm({
      title: `Delete Policy "${name}"?`,
      body: "Assigned endpoints stop recording screenshots for it. Screenshots already recorded stay in the reports of other policies that cover them. This cannot be undone.",
      confirmLabel: "Delete policy",
      tone: "danger",
    });
    if (!confirmed) return;
    deletePolicy.mutate(id, { onSuccess: () => selectedId === id && setSelectedId(undefined) });
  }

  return (
    <>
      <SectionHeader
        title="Screen Capture"
        description="Reports users who take many screenshots in a day, delete them soon after, or open them in other programs such as a browser, WhatsApp or Outlook. Only details about each screenshot are collected, unless a super admin sets a policy to keep the images."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        }
      />

      <Alert tone="info" title="Windows endpoints, agent 0.2.12 or later">
        Screenshots are recorded the moment they are saved, so deleting one afterwards doesn't hide it. A plain PrtScn that only copies to the
        clipboard and is pasted without being saved isn't seen. "Opened by" uses Windows file-access auditing; a domain audit policy that turns
        file-system auditing off overrides it.
      </Alert>

      <Card flush title="Policies" hint={policies ? `${policies.length} total · paused policies don't record anything` : undefined}>
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
            title="No screen capture policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, set the daily threshold, then assign it to groups or endpoints.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Policy</th>
                  <th scope="col">Status</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Daily threshold
                  </th>
                  <th scope="col">Sources</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Assigned endpoints
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Users flagged (7 days)
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
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.dailyThreshold}
                    </td>
                    <td>
                      <div className="app-badge-row">
                        {sourceList(p).map((s) => (
                          <Tag key={s}>{s}</Tag>
                        ))}
                      </div>
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.assignedAgentCount}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.flaggedUsers7d > 0 ? <Badge tone="crit">{p.flaggedUsers7d}</Badge> : <span className="app-muted">0</span>}
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
          meta={`Threshold ${policy.dailyThreshold}/day · ${policy.assignedAgentCount} ${policy.assignedAgentCount === 1 ? "endpoint" : "endpoints"}${policy.saveImages ? ` · images kept ${policy.imageRetentionDays} days` : ""}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "report", label: "Report", content: <ReportPanel policy={policy} /> },
            { value: "assignment", label: "Assignment", content: <AssignmentPanel policyId={policy.id} /> },
            { value: "settings", label: "Settings", content: <PolicySettingsPanel policy={policy} /> },
            ...(isSuperAdmin ? [{ value: "images", label: "Screenshot images", content: <ImagesPanel policy={policy} /> }] : []),
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
          <SettingsFields idPrefix="sc-new" value={newSettings} onChange={setNewSettings} />
        </NewPolicyDialog>
      )}
    </>
  );
}
