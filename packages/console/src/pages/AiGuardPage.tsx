import { useMemo, useState, type FormEvent } from "react";
import { Ban, Clock, Download, Mail, Monitor, Pencil, Plus, Puzzle, ShieldAlert, Sparkles, Trash2, Users } from "lucide-react";
import {
  useAiAlertSettings,
  useAiApps,
  useAiComponents,
  useAiPolicies,
  useAiPolicySyncStatus,
  useAiPromptDataTypes,
  useAiPromptEvents,
  useAiUsage,
  useAssetGroups,
  useCreateAiApp,
  useCreateAiPolicy,
  useDeleteAiApp,
  useDeleteAiPolicy,
  useSaveAiAlertSettings,
  useTestAiAlert,
  useSetAiPolicyAssignments,
  useSetAiEndpointBlock,
  useRequestAiScan,
  useUpdateAiApp,
  useUpdateAiPolicy,
  type AiCustomAppInput,
} from "../api/hooks";
import type { AiAction, AiAppRisk, AiAppView, AiComponentView, AiGuardPolicyView, AiPromptAction, AiPromptEventView, AiUsageAppRow } from "../api/types";
import { AssignmentEditor, NewPolicyDialog, PolicyDetail, PolicySettingsForm, SyncStatusTable } from "../components/policy";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  FormFooter,
  Kpi,
  KpiStrip,
  Modal,
  PageHeader,
  RowMenu,
  SearchInput,
  Segmented,
  Skeleton,
  Switch,
  Tag,
  Toolbar,
  useConfirm,
} from "../components/ui";
import { formatDate, formatDateTime, formatRelative } from "../format";
import { useLinkedPolicySelection } from "../usePolicyLink";
import { downloadCsv } from "../csv";
import { FeatureGate, LockIcon, useFeatureLicensed } from "../licenseFeatures";

// AI Guard (licence module AI_GUARD), phase 1: which generative-AI tools are used, by whom, and
// which are allowed or blocked. Usage comes from what the Windows tray app already reports (the
// program in front and the browser's active tab); blocking goes through the endpoint's website
// blocking and application control (see the server's aiGuard.service.ts).

const RISK_TONE: Record<AiAppRisk, "crit" | "med" | "low"> = { HIGH: "crit", MEDIUM: "med", LOW: "low" };
const RISK_LABEL: Record<AiAppRisk, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
const CATEGORIES = [
  "Chat assistant",
  "Coding assistant",
  "Writing",
  "Images & video",
  "Meeting notes",
  "Translation",
  "Search",
  "Local AI",
  "Model hub",
];

function RiskBadge({ risk }: { risk: AiAppRisk }) {
  return <Badge tone={RISK_TONE[risk]}>{RISK_LABEL[risk]}</Badge>;
}

// "2 h 05 min", "12 min", "under a minute".
function activeTime(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? "under a minute" : "—";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h} h ${String(minutes % 60).padStart(2, "0")} min`;
}

// ---- AI Usage -------------------------------------------------------------------------------

type Period = "7" | "30" | "90";

export function AiGuardUsagePage() {
  const [period, setPeriod] = useState<Period>("7");
  const [groupId, setGroupId] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const { data: groups } = useAssetGroups();
  const { data, isLoading, error, refetch } = useAiUsage(Number(period), groupId);
  const { data: promptEvents } = useAiPromptEvents(Number(period), groupId);
  const open = data?.apps.find((a) => a.key === openKey) ?? null;

  return (
    <>
      <PageHeader
        title="AI Usage"
        description="Which generative-AI tools people use, on which endpoints and for how long — including AI desktop apps installed but not used yet."
        actions={
          <>
            <Button icon={Download} onClick={() => data && exportUsage(data.apps, data.users, promptEvents ?? [], period)} disabled={!data}>
              Export CSV
            </Button>
            <Button icon={Mail} onClick={() => setAlertsOpen(true)}>
              Email alerts
            </Button>
          </>
        }
      />
      {alertsOpen && <AlertSettingsDialog onClose={() => setAlertsOpen(false)} />}

      <Card flush>
        <Toolbar
          right={
            <Segmented
              label="Period"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "7", label: "7 days" },
                { value: "30", label: "30 days" },
                { value: "90", label: "90 days" },
              ]}
            />
          }
        >
          {groups && groups.length > 0 && (
            <select className="ep-select" aria-label="Group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Group: All</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.path ?? g.name}
                </option>
              ))}
            </select>
          )}
        </Toolbar>
      </Card>

      {error ? (
        <Alert tone="critical" title="Couldn't load AI usage" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
          {(error as Error).message}
        </Alert>
      ) : isLoading || !data ? (
        <Card>
          <Skeleton lines={6} />
        </Card>
      ) : (
        <>
          <KpiStrip>
            <Kpi icon={Sparkles} label="AI tools in use" value={<span className="ep-num">{data.totals.tools}</span>} suffix={`in ${period} days`} />
            <Kpi icon={Users} label="People using AI" value={<span className="ep-num">{data.totals.users}</span>} suffix="signed-in users" />
            <Kpi icon={Monitor} label="Endpoints" value={<span className="ep-num">{data.totals.endpoints}</span>} suffix="with AI use" />
            <Kpi icon={Clock} label="Time with AI tools" value={activeTime(data.totals.activeSeconds)} suffix="in the foreground" />
            <Kpi
              icon={ShieldAlert}
              label="Sensitive data caught"
              value={<span className="ep-num">{promptEvents?.length ?? 0}</span>}
              valueTone={(promptEvents?.length ?? 0) > 0 ? "critical" : undefined}
              suffix="in AI prompts"
            />
            <Kpi
              icon={Ban}
              label="Blocked AI app launches"
              value={<span className="ep-num">{data.totals.blockedLaunches}</span>}
              valueTone={data.totals.blockedLaunches > 0 ? "warning" : undefined}
              suffix="desktop apps"
            />
          </KpiStrip>

          <Card flush title="AI Tools" hint="click a tool to see who uses it">
            {data.apps.length === 0 ? (
              <EmptyState icon={Sparkles} title="No AI use seen yet">
                AI use appears here once someone opens an AI website or desktop app on a Windows endpoint while signed in (the
                agent's tray app reports the program in front and the browser's active tab). Check the AI Tools page for what
                is recognised.
              </EmptyState>
            ) : (
              <div className="app-table-scroll">
                <table className="ep-tbl">
                  <thead>
                    <tr>
                      <th scope="col">AI tool</th>
                      <th scope="col">Category</th>
                      <th scope="col">Risk</th>
                      <th scope="col" style={{ textAlign: "right" }}>Users</th>
                      <th scope="col" style={{ textAlign: "right" }}>Endpoints</th>
                      <th scope="col" style={{ textAlign: "right" }}>Time</th>
                      <th scope="col" style={{ textAlign: "right" }}>Installed on</th>
                      <th scope="col">Policy</th>
                      <th scope="col">Last used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.apps.map((a) => (
                      <tr key={a.key} className={`app-clickable ${a.key === openKey ? "ep-sel" : ""}`} onClick={() => setOpenKey(a.key === openKey ? null : a.key)}>
                        <td className="ep-host">
                          <b>{a.name}</b>
                          <span className="app-row-sub">{a.vendor}</span>
                        </td>
                        <td>{a.category}</td>
                        <td title={a.riskNote || undefined}>
                          <RiskBadge risk={a.risk} />
                        </td>
                        <td className="ep-num" style={{ textAlign: "right" }}>{a.users}</td>
                        <td className="ep-num" style={{ textAlign: "right" }}>{a.endpoints}</td>
                        <td style={{ textAlign: "right" }}>{activeTime(a.activeSeconds)}</td>
                        <td className="ep-num" style={{ textAlign: "right" }}>{a.installedOn || "—"}</td>
                        <td>
                          {a.blockedOn > 0 ? (
                            <Badge tone="high">Blocked on {a.blockedOn}</Badge>
                          ) : (
                            <span className="app-muted">Not blocked</span>
                          )}
                          {a.blockedLaunches > 0 && <span className="app-row-sub">{a.blockedLaunches} blocked launches</span>}
                        </td>
                        <td className="app-muted">{a.lastUsed ? formatDate(a.lastUsed) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {open && <ToolUsersCard app={open} />}

          <PromptEventsCard events={promptEvents} />

          {data.users.length > 0 && (
            <Card flush title="People" hint="most AI time first">
              <div className="app-table-scroll">
                <table className="ep-tbl">
                  <thead>
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col">Endpoints</th>
                      <th scope="col" style={{ textAlign: "right" }}>Time</th>
                      <th scope="col">AI tools</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.username}>
                        <td>
                          <b>{u.username}</b>
                        </td>
                        <td className="ep-mono">{u.hostnames.join(", ")}</td>
                        <td style={{ textAlign: "right" }}>{activeTime(u.activeSeconds)}</td>
                        <td>
                          <div className="app-badge-row">
                            {u.apps.map((t) => (
                              <Tag key={t.key}>
                                {t.name} · {activeTime(t.activeSeconds)}
                              </Tag>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Alert tone="info">
            Time counts only while the AI tool is the program in front (or the browser's active tab) and the user isn't idle.
            Installed on counts endpoints whose software list includes the AI desktop app. Only Windows endpoints report AI use.
          </Alert>
        </>
      )}
    </>
  );
}

function ToolUsersCard({ app }: { app: AiUsageAppRow }) {
  return (
    <Card flush title={`Who Uses ${app.name}`} hint={app.riskNote || undefined}>
      {app.topUsers.length === 0 ? (
        <EmptyState icon={Users} title="No use in this period">
          {app.installedOn > 0 ? `Installed on ${app.installedOn} endpoint(s), but nobody used it in this period.` : "Nobody used it in this period."}
        </EmptyState>
      ) : (
        <div className="app-table-scroll">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Endpoint</th>
                <th scope="col" style={{ textAlign: "right" }}>Time</th>
                <th scope="col">Last used</th>
              </tr>
            </thead>
            <tbody>
              {app.topUsers.map((u) => (
                <tr key={`${u.username}|${u.hostname}`}>
                  <td>{u.username}</td>
                  <td className="ep-mono">{u.hostname}</td>
                  <td style={{ textAlign: "right" }}>{activeTime(u.activeSeconds)}</td>
                  <td className="app-muted">{formatRelative(u.lastUsed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---- Policies -------------------------------------------------------------------------------

// Every AI tool is Allowed unless the policy sets it to Block.
type Preset = "MONITOR" | "BLOCK_HIGH" | "BLOCK_ALL";
const PRESETS: { value: Preset; label: string; help: string }[] = [
  { value: "MONITOR", label: "Allow every AI tool", help: "Nothing is blocked. Block individual tools afterwards." },
  { value: "BLOCK_HIGH", label: "Block high-risk AI tools", help: "Every tool rated High risk is blocked; the rest stay allowed." },
  { value: "BLOCK_ALL", label: "Block every AI tool", help: "Every AI tool in the list is blocked; set the approved ones back to Allowed afterwards." },
];

function presetValues(preset: Preset, apps: AiAppView[]): { defaultAction: AiAction; appActions: Record<string, AiAction> } {
  const block = (list: AiAppView[]) => Object.fromEntries(list.map((a) => [a.key, "BLOCK" as const]));
  if (preset === "BLOCK_ALL") return { defaultAction: "ALLOW", appActions: block(apps) };
  if (preset === "BLOCK_HIGH") return { defaultAction: "ALLOW", appActions: block(apps.filter((a) => a.risk === "HIGH")) };
  return { defaultAction: "ALLOW", appActions: {} };
}

// What each tool is in this policy (a policy saved before the per-tool-only editor may still
// carry a "Blocked" default for tools it doesn't name).
function actionOf(policy: Pick<AiGuardPolicyView, "defaultAction" | "appActions">, key: string): AiAction {
  return policy.appActions[key] ?? policy.defaultAction;
}

function effectiveBlocked(policy: Pick<AiGuardPolicyView, "defaultAction" | "appActions">, apps: AiAppView[]): number {
  return apps.filter((a) => actionOf(policy, a.key) === "BLOCK").length;
}

export function AiGuardPoliciesPage() {
  const { licensed } = useFeatureLicensed();
  const { data: policies, isLoading } = useAiPolicies();
  const { data: apps } = useAiApps();
  const createPolicy = useCreateAiPolicy();
  const updatePolicy = useUpdateAiPolicy();
  const deletePolicy = useDeleteAiPolicy();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useLinkedPolicySelection();
  const [creating, setCreating] = useState(false);
  const [preset, setPreset] = useState<Preset>("BLOCK_HIGH");
  const policy = policies?.find((p) => p.id === selectedId);

  function save(p: AiGuardPolicyView, patch: Partial<AiGuardPolicyView>) {
    const next = { ...p, ...patch };
    updatePolicy.mutate({ id: p.id, name: next.name, description: next.description, enabled: next.enabled, defaultAction: next.defaultAction, appActions: next.appActions });
  }

  async function handleDelete(p: AiGuardPolicyView) {
    const ok = await confirm({
      title: `Delete Policy "${p.name}"?`,
      body: "AI tools it blocks are unblocked on its endpoints at their next sync. This cannot be undone.",
      confirmLabel: "Delete policy",
      tone: "danger",
    });
    if (!ok) return;
    deletePolicy.mutate(p.id, { onSuccess: () => selectedId === p.id && setSelectedId(undefined) });
  }

  return (
    <>
      <PageHeader
        title="AI Policies"
        description="Allow or block AI tools per group or endpoint. Blocked AI websites go into the endpoint's website blocking (hosts file and Chrome/Edge policy); blocked AI desktop apps into its application control."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        }
      />

      <Card flush title="Policies" hint={policies ? `${policies.length} total` : undefined}>
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : !policies || policies.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No AI policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, choose which AI tools it allows or blocks, then assign it to groups or endpoints.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Policy</th>
                  <th scope="col">Status</th>
                  <th scope="col" style={{ textAlign: "right" }}>Blocked tools</th>
                  <th scope="col" style={{ textAlign: "right" }}>Assigned to</th>
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
                      <Switch checked={p.enabled} onChange={(enabled) => save(p, { enabled })} label={p.enabled ? "Enabled" : "Paused"} />
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {apps ? effectiveBlocked(p, apps) : "—"}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.assignments.length}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="app-cell-actions">
                        <RowMenu
                          label={`Actions for ${p.name}`}
                          items={[
                            { label: "Open policy", icon: Pencil, onSelect: () => setSelectedId(p.id) },
                            { label: "Delete policy", icon: Trash2, danger: true, dividerBefore: true, disabled: deletePolicy.isPending, onSelect: () => handleDelete(p) },
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

      {policy && apps && (
        <PolicyDetail
          policyId={policy.id}
          name={policy.name}
          enabled={policy.enabled}
          meta={`${effectiveBlocked(policy, apps)} AI tools blocked · ${policy.assignments.length} assigned`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "tools", label: "AI Tools", content: <PolicyToolsPanel key={policy.id} policy={policy} apps={apps} /> },
            {
              value: "prompt",
              label: licensed("AI_PROMPT") ? "Prompt Protection" : <>Prompt Protection<LockIcon /></>,
              content: <FeatureGate feature="AI_PROMPT"><PolicyPromptPanel key={policy.id} policy={policy} /></FeatureGate>,
            },
            {
              value: "addons",
              label: licensed("AI_EXTENSIONS") ? "AI Extensions" : <>AI Extensions<LockIcon /></>,
              content: <FeatureGate feature="AI_EXTENSIONS"><PolicyAddonsPanel key={policy.id} policy={policy} /></FeatureGate>,
            },
            { value: "assignment", label: "Assignment", content: <PolicyAssignmentPanel policy={policy} /> },
            { value: "sync", label: "Sync Status", content: <PolicySyncPanel policyId={policy.id} /> },
            {
              value: "settings",
              label: "Settings",
              content: (
                <PolicySettingsForm
                  policyId={policy.id}
                  name={policy.name}
                  description={policy.description}
                  onSave={(v) => save(policy, v)}
                  pending={updatePolicy.isPending}
                  error={updatePolicy.error}
                  saved={updatePolicy.isSuccess}
                />
              ),
            },
          ]}
        />
      )}

      {creating && (
        <NewPolicyDialog
          title="New AI Policy"
          onClose={() => setCreating(false)}
          pending={createPolicy.isPending}
          error={createPolicy.error}
          extraValid={!!apps}
          onCreate={(v) =>
            createPolicy
              .mutateAsync({ ...v, enabled: true, ...presetValues(preset, apps ?? []) })
              .then((created) => setSelectedId(created.id))
          }
        >
          <Field label="Start from" htmlFor="ai-preset" help={PRESETS.find((p) => p.value === preset)?.help}>
            <select id="ai-preset" className="ep-select" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </NewPolicyDialog>
      )}
    </>
  );
}

function PolicyToolsPanel({ policy, apps }: { policy: AiGuardPolicyView; apps: AiAppView[] }) {
  const update = useUpdateAiPolicy();
  // Only blocked tools are stored; every other tool is Allowed.
  const initial = () => Object.fromEntries(apps.filter((a) => actionOf(policy, a.key) === "BLOCK").map((a) => [a.key, "BLOCK" as const]));
  const [blockedMap, setBlockedMap] = useState<Record<string, AiAction>>(initial);
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const shown = apps.filter((a) => !term || a.name.toLowerCase().includes(term) || a.category.toLowerCase().includes(term));
  const blocked = Object.keys(blockedMap).length;
  const saved = JSON.stringify(initial());
  const dirty = JSON.stringify(blockedMap) !== saved || policy.defaultAction !== "ALLOW";

  function setAction(key: string, value: AiAction) {
    setBlockedMap((prev) => {
      const next = { ...prev };
      if (value === "BLOCK") next[key] = "BLOCK";
      else delete next[key];
      return next;
    });
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    // Add-on actions (AI Extensions tab) are kept as they are.
    const addons = Object.fromEntries(Object.entries(policy.appActions).filter(([k]) => k.startsWith("addon:")));
    update.mutate({ id: policy.id, name: policy.name, description: policy.description, enabled: policy.enabled, defaultAction: "ALLOW", appActions: { ...addons, ...blockedMap } });
  }

  return (
    <form onSubmit={handleSave} className="app-stack">
      <p className="app-text app-muted">Every AI tool is Allowed unless you set it to Blocked. AI tools added to the list later start as Allowed.</p>
      <Toolbar right={<span className="app-muted">{blocked} of {apps.length} AI tools blocked</span>}>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search AI tools…" />
      </Toolbar>
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">AI tool</th>
              <th scope="col">Category</th>
              <th scope="col">Risk</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.key}>
                <td className="ep-host">
                  <b>{a.name}</b>
                  <span className="app-row-sub">{a.vendor}</span>
                </td>
                <td>{a.category}</td>
                <td title={a.riskNote || undefined}>
                  <RiskBadge risk={a.risk} />
                </td>
                <td>
                  <select
                    className="ep-select"
                    aria-label={`Action for ${a.name}`}
                    value={blockedMap[a.key] ?? "ALLOW"}
                    onChange={(e) => setAction(a.key, e.target.value as AiAction)}
                    // Green for Allowed, red for Blocked - the word says it too.
                    style={
                      blockedMap[a.key] === "BLOCK"
                        ? { color: "var(--ep-sev-critical)", borderColor: "var(--ep-sev-critical)", fontWeight: 600 }
                        : { color: "var(--ep-ok)", borderColor: "var(--ep-ok)", fontWeight: 600 }
                    }
                  >
                    <option value="ALLOW">Allowed</option>
                    <option value="BLOCK">Blocked</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!update.error && <Alert tone="critical">{(update.error as Error).message}</Alert>}
      <FormFooter>
        {update.isSuccess && !dirty && <span className="app-saved">Saved</span>}
        <Button variant="primary" type="submit" disabled={update.isPending || !dirty}>
          {update.isPending ? "Saving…" : "Save Action"}
        </Button>
      </FormFooter>
    </form>
  );
}

function PolicySyncPanel({ policyId }: { policyId: string }) {
  const { data, isLoading } = useAiPolicySyncStatus(policyId);
  if (isLoading || !data) return <Skeleton />;
  return (
    <SyncStatusTable
      rows={data}
      explanation="Whether each endpoint applied this policy. Blocked AI websites are applied with the endpoint's website blocking and reported at its next sync (within about a minute); blocked AI desktop apps with its application control."
    />
  );
}

function PolicyAssignmentPanel({ policy }: { policy: AiGuardPolicyView }) {
  const setAssignments = useSetAiPolicyAssignments();
  const agentIds = policy.assignments.map((a) => a.agentId).filter((x): x is string => !!x);
  const groupIds = policy.assignments.map((a) => a.groupId).filter((x): x is string => !!x);
  return (
    <AssignmentEditor
      blocking
      assignments={policy.assignments.map((a) => ({
        id: a.id,
        agentId: a.agentId,
        hostname: a.kind === "ENDPOINT" ? a.name : null,
        groupId: a.groupId,
        groupName: a.kind === "GROUP" ? a.name : null,
      }))}
      onUnassign={(id) => {
        const left = policy.assignments.filter((a) => a.id !== id);
        setAssignments.mutate({
          id: policy.id,
          agentIds: left.map((a) => a.agentId).filter((x): x is string => !!x),
          groupIds: left.map((a) => a.groupId).filter((x): x is string => !!x),
        });
      }}
      unassignPending={setAssignments.isPending}
      onAssign={(newAgents, newGroups, done) =>
        setAssignments.mutate(
          { id: policy.id, agentIds: [...new Set([...agentIds, ...newAgents])], groupIds: [...new Set([...groupIds, ...newGroups])] },
          { onSuccess: done },
        )
      }
      assignPending={setAssignments.isPending}
      assignError={setAssignments.error}
      renderAgentExtra={(agent) => (agent.osPlatform === "win32" ? null : <span className="app-muted"> · not Windows, no effect</span>)}
    />
  );
}

// ---- Prompt protection (phase 2) ---------------------------------------------------------------

const PROMPT_ACTION_LABEL: Record<AiPromptAction, string> = {
  WARN: "Warn (the user can continue)",
  BLOCK: "Block",
  REDACT: "Mask the sensitive part",
};

const CHANNEL_LABEL: Record<AiPromptEventView["channel"], string> = { PASTE: "Paste", SEND: "Prompt sent", UPLOAD: "File upload", CLIPBOARD: "Clipboard (desktop app)" };

function eventOutcome(action: AiPromptEventView["action"], channel?: AiPromptEventView["channel"]) {
  // A desktop app's warning can't tell whether the user pasted anyway.
  if (channel === "CLIPBOARD" && action === "WARNED_CONTINUED") return <Badge tone="high">Warned</Badge>;
  switch (action) {
    case "BLOCKED":
      return <Badge tone="crit">Blocked</Badge>;
    case "REDACTED":
      return <Badge tone="med">Masked</Badge>;
    case "WARNED_CONTINUED":
      return <Badge tone="high">Warned · continued</Badge>;
    default:
      return <Badge tone="ok">Warned · stopped</Badge>;
  }
}

function PromptEventsCard({ events }: { events: AiPromptEventView[] | undefined }) {
  return (
    <Card flush title="Sensitive Data in AI Prompts" hint="caught by the Browser Guard extension; the prompt itself is never stored">
      {!events ? (
        <div className="ep-cb">
          <Skeleton />
        </div>
      ) : events.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="Nothing caught in this period">
          Turn on Prompt Protection in an AI policy: the Browser Guard extension then checks what people paste into, send to or
          upload to AI websites on its endpoints.
        </EmptyState>
      ) : (
        <div className="app-table-scroll">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">User</th>
                <th scope="col">Endpoint</th>
                <th scope="col">AI tool</th>
                <th scope="col">How</th>
                <th scope="col">Data found</th>
                <th scope="col">Masked sample</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="app-muted">{formatDateTime(e.occurredAt)}</td>
                  <td>{e.username ?? <span className="app-muted">—</span>}</td>
                  <td className="ep-mono">{e.hostname}</td>
                  <td>{e.appName}</td>
                  <td>
                    {CHANNEL_LABEL[e.channel]}
                    {e.fileName && <span className="app-row-sub">{e.fileName}</span>}
                  </td>
                  <td>
                    <div className="app-badge-row">
                      {e.dataTypes.map((d) => (
                        <Tag key={d}>{d}</Tag>
                      ))}
                    </div>
                  </td>
                  <td className="ep-mono">{e.maskedSample ?? <span className="app-muted">—</span>}</td>
                  <td>{eventOutcome(e.action, e.channel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PolicyPromptPanel({ policy }: { policy: AiGuardPolicyView }) {
  const update = useUpdateAiPolicy();
  const { data: options, isLoading } = useAiPromptDataTypes();
  const [enabled, setEnabled] = useState(policy.promptProtection);
  const [action, setAction] = useState<AiPromptAction>(policy.promptAction);
  const [selected, setSelected] = useState<string[]>(policy.promptDataTypes);
  const dirty =
    enabled !== policy.promptProtection ||
    action !== policy.promptAction ||
    JSON.stringify([...selected].sort()) !== JSON.stringify([...policy.promptDataTypes].sort());
  const groups = [...new Set((options ?? []).map((o) => o.group))];

  function toggle(value: string) {
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    update.mutate({
      id: policy.id,
      name: policy.name,
      description: policy.description,
      enabled: policy.enabled,
      defaultAction: "ALLOW",
      appActions: policy.appActions,
      promptProtection: enabled,
      promptDataTypes: selected,
      promptAction: action,
    });
  }

  return (
    <form onSubmit={handleSave} className="app-stack">
      <p className="app-text app-muted">
        On AI websites, the Endpoint IQ Browser Guard extension checks text people paste, prompts they send and files they upload
        for the data types below, on the PC itself. File-type data types stop uploads of those files whatever they contain. Data
        types come from Data Governance → Data Types (built-in and your own). Only the kind of data found and a masked sample reach the server. Needs Windows
        agent 0.2.32 or later, Chrome or Edge, and Browser Guard 0.5.0 (installed automatically while this is on).
      </p>
      <Switch checked={enabled} onChange={setEnabled} label={enabled ? "Prompt protection on" : "Prompt protection off"} />
      <Field label="When sensitive data is found" htmlFor="ai-prompt-action" help="Mask replaces the sensitive part in pasted text and prompts. Files can't be masked, so they're blocked.">
        <select id="ai-prompt-action" className="ep-select" value={action} onChange={(e) => setAction(e.target.value as AiPromptAction)} style={{ maxWidth: 320 }} disabled={!enabled}>
          {(Object.keys(PROMPT_ACTION_LABEL) as AiPromptAction[]).map((a) => (
            <option key={a} value={a}>
              {PROMPT_ACTION_LABEL[a]}
            </option>
          ))}
        </select>
      </Field>
      {isLoading ? (
        <Skeleton />
      ) : (
        groups.map((g) => (
          <div key={g} className="app-stack-sm">
            <span className="app-subhead">{g}</span>
            <div className="app-check-grid">
              {(options ?? [])
                .filter((o) => o.group === g)
                .map((o) => (
                  <Check
                    key={o.value}
                    checked={selected.includes(o.value)}
                    onChange={() => toggle(o.value)}
                    label={
                      <>
                        {o.label}
                        {o.preview && (
                          <span className="app-muted">
                            {" "}
                            · {o.preview}
                            {o.count !== undefined && o.count > 4 ? ` +${o.count - 4} more` : ""}
                          </span>
                        )}
                      </>
                    }
                  />
                ))}
            </div>
          </div>
        ))
      )}
      {enabled && selected.length === 0 && <Alert tone="warn">Choose at least one data type to look for.</Alert>}
      {!!update.error && <Alert tone="critical">{(update.error as Error).message}</Alert>}
      <FormFooter>
        {update.isSuccess && !dirty && <span className="app-saved">Saved</span>}
        <Button variant="primary" type="submit" disabled={update.isPending || !dirty || (enabled && selected.length === 0)}>
          {update.isPending ? "Saving…" : "Save prompt protection"}
        </Button>
      </FormFooter>
    </form>
  );
}

// ---- CSV export and email alerts (phase 3) --------------------------------------------------------

const OUTCOME_TEXT: Record<AiPromptEventView["action"], string> = {
  BLOCKED: "Blocked",
  REDACTED: "Masked",
  WARNED_CANCELLED: "Warned, stopped",
  WARNED_CONTINUED: "Warned, continued",
};

function exportUsage(apps: AiUsageAppRow[], users: { username: string; hostnames: string[]; activeSeconds: number; apps: { name: string; activeSeconds: number }[] }[], events: AiPromptEventView[], period: string) {
  const day = new Date().toISOString().slice(0, 10);
  downloadCsv(
    `ai-usage-tools-${period}d-${day}.csv`,
    ["AI tool", "Vendor", "Category", "Risk", "Users", "Endpoints", "Minutes", "Installed on", "Blocked on", "Blocked launches", "Last used"],
    apps.map((a) => [a.name, a.vendor, a.category, a.risk, a.users, a.endpoints, Math.round(a.activeSeconds / 60), a.installedOn, a.blockedOn, a.blockedLaunches, a.lastUsed ?? ""]),
  );
  downloadCsv(
    `ai-usage-people-${period}d-${day}.csv`,
    ["User", "Endpoints", "Minutes", "AI tools"],
    users.map((u) => [u.username, u.hostnames.join("; "), Math.round(u.activeSeconds / 60), u.apps.map((t) => `${t.name} (${Math.round(t.activeSeconds / 60)} min)`).join("; ")]),
  );
  if (events.length > 0) {
    downloadCsv(
      `ai-prompt-events-${period}d-${day}.csv`,
      ["When", "User", "Endpoint", "AI tool", "How", "Data found", "Masked sample", "File", "Outcome", "Policy"],
      events.map((e) => [e.occurredAt, e.username ?? "", e.hostname, e.appName, CHANNEL_LABEL[e.channel], e.dataTypes.join("; "), e.maskedSample ?? "", e.fileName ?? "", OUTCOME_TEXT[e.action], e.policyName ?? ""]),
    );
  }
}

function AlertSettingsDialog({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useAiAlertSettings();
  return (
    <Modal
      title="AI Guard Email Alerts"
      description="Emails when sensitive data is caught in AI prompts or a blocked AI app is started - one digest at most every 15 minutes - and an optional weekly AI usage summary (Mondays, 09:00 server time)."
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {isLoading || !data ? <Skeleton /> : <AlertSettingsForm settings={data} />}
    </Modal>
  );
}

function AlertSettingsForm({ settings }: { settings: NonNullable<ReturnType<typeof useAiAlertSettings>["data"]> }) {
  const save = useSaveAiAlertSettings();
  const test = useTestAiAlert();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [recipients, setRecipients] = useState(settings.recipients.join("\n"));
  const [prompts, setPrompts] = useState(settings.alertOnPrompts);
  const [launches, setLaunches] = useState(settings.alertOnBlockedApps);
  const [weekly, setWeekly] = useState(settings.weeklySummary);
  const list = recipients
    .split(/[\n,;]/)
    .map((r) => r.trim())
    .filter(Boolean);

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ enabled, recipients: list, alertOnPrompts: prompts, alertOnBlockedApps: launches, weeklySummary: weekly });
  }

  return (
    <form onSubmit={submit} className="app-stack">
      {!settings.mailServerConfigured && (
        <Alert tone="warn" title="No mail server yet">
          AI Guard sends through the mail server set under Identity Governance → User Risk → Email. Set it up there first.
        </Alert>
      )}
      <Switch checked={enabled} onChange={setEnabled} label={enabled ? "Email alerts on" : "Email alerts off"} />
      <Field label="Recipients" htmlFor="ai-alert-to" help="One email address per line.">
        <textarea id="ai-alert-to" className="ep-textarea" rows={3} value={recipients} onChange={(e) => setRecipients(e.target.value)} />
      </Field>
      <Check checked={prompts} onChange={() => setPrompts(!prompts)} label="Sensitive data caught in AI prompts (browser and AI desktop apps)" />
      <Check checked={launches} onChange={() => setLaunches(!launches)} label="Blocked AI desktop app launches" />
      <Check checked={weekly} onChange={() => setWeekly(!weekly)} label="Weekly AI usage summary" />
      {settings.lastAlertSentAt && <span className="app-muted">Last alert sent {formatDateTime(settings.lastAlertSentAt)}</span>}
      {settings.lastError && <Alert tone="critical" title="Last email failed">{settings.lastError}</Alert>}
      {!!save.error && <Alert tone="critical">{(save.error as Error).message}</Alert>}
      {!!test.error && <Alert tone="critical">{(test.error as Error).message}</Alert>}
      {test.isSuccess && <Alert tone="success">Test email sent.</Alert>}
      <FormFooter>
        {save.isSuccess && <span className="app-saved">Saved</span>}
        <Button type="button" onClick={() => test.mutate()} disabled={test.isPending || list.length === 0}>
          {test.isPending ? "Sending…" : "Send test email"}
        </Button>
        <Button variant="primary" type="submit" disabled={save.isPending || (enabled && list.length === 0)}>
          {save.isPending ? "Saving…" : "Save alerts"}
        </Button>
      </FormFooter>
    </form>
  );
}

// ---- AI Extensions (phase 3) --------------------------------------------------------------------

const KIND_LABEL: Record<AiComponentView["kind"], string> = {
  BROWSER_EXTENSION: "Browser extension",
  IDE_EXTENSION: "Code editor extension",
  CLI_TOOL: "Command-line tool",
};
const HOST_LABEL: Record<string, string> = { chrome: "Chrome", edge: "Edge", vscode: "VS Code", cursor: "Cursor", windsurf: "Windsurf", vscodium: "VSCodium", npm: "npm" };

export function AiGuardExtensionsPage() {
  const [groupId, setGroupId] = useState("");
  const [kind, setKind] = useState<"" | AiComponentView["kind"]>("");
  const [agentId, setAgentId] = useState("");
  const { data: groups } = useAssetGroups();
  const { data, isLoading, error } = useAiComponents(groupId);
  const [managingKey, setManagingKey] = useState<string | null>(null);
  const managing = (data ?? []).find((c) => c.key === managingKey);

  // Every endpoint an AI add-on was found on (the Endpoint selector).
  const endpoints = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data ?? []) for (const e of c.endpoints) m.set(e.agentId, e.hostname);
    return [...m.entries()].map(([id, hostname]) => ({ id, hostname })).sort((a, b) => a.hostname.localeCompare(b.hostname));
  }, [data]);
  const endpoint = endpoints.find((e) => e.id === agentId);
  const reportedAt = endpoint
    ? (data ?? []).flatMap((c) => c.endpoints).filter((e) => e.agentId === endpoint.id).reduce((max, e) => (e.reportedAt > max ? e.reportedAt : max), "")
    : "";
  const scan = useRequestAiScan();
  const shown = (data ?? []).filter((c) => (!kind || c.kind === kind) && (!endpoint || c.endpoints.some((e) => e.agentId === endpoint.id)));

  // With an endpoint selected: its Allowed / Blocked choices, saved together.
  const setBlock = useSetAiEndpointBlock();
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const on = (c: AiComponentView) => c.endpoints.find((e) => e.agentId === agentId);
  const changed = endpoint ? shown.filter((c) => c.key in choices && choices[c.key] !== on(c)?.blocked) : [];

  function selectEndpoint(id: string) {
    setAgentId(id);
    scan.reset();
    setChoices({});
    setSaveError(null);
    setSaved(false);
  }

  async function saveEndpoint() {
    setSaving(true);
    setSaveError(null);
    try {
      for (const c of changed) await setBlock.mutateAsync({ agentId, key: c.key, blocked: choices[c.key] });
      setChoices({});
      setSaved(true);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="AI Extensions"
        description="AI add-ons found on Windows endpoints: browser extensions (Chrome, Edge), code editor extensions (VS Code, Cursor, Windsurf, VSCodium) and command-line AI tools. Select an endpoint to allow or block add-ons on it, or block one for everyone a policy covers on the policy's AI Extensions tab."
      />
      <Card flush>
        <Toolbar
          right={
            <>
              <span className="app-muted">
                {shown.length} found{reportedAt && ` · last reported ${formatRelative(reportedAt)}`}
              </span>
              <Button
                size="sm"
                disabled={scan.isPending}
                title="Endpoints look for AI add-ons again within 5 minutes (Windows agent 0.2.34 or later)"
                onClick={() => scan.mutate(endpoint ? { agentId: endpoint.id } : groupId ? { groupId } : {})}
              >
                {scan.isSuccess ? `Scan requested (${scan.data.requested})` : endpoint ? `Scan ${endpoint.hostname} now` : "Scan now"}
              </Button>
            </>
          }
        >
          <select className="ep-select" aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="">Type: All</option>
            {(Object.keys(KIND_LABEL) as AiComponentView["kind"][]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          {groups && groups.length > 0 && (
            <select
              className="ep-select"
              aria-label="Group"
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                selectEndpoint("");
              }}
            >
              <option value="">Group: All</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.path ?? g.name}
                </option>
              ))}
            </select>
          )}
          <select className="ep-select" aria-label="Endpoint" value={agentId} onChange={(e) => selectEndpoint(e.target.value)}>
            <option value="">Endpoint: All</option>
            {endpoints.map((e) => (
              <option key={e.id} value={e.id}>
                {e.hostname}
              </option>
            ))}
          </select>
        </Toolbar>
        {error ? (
          <div className="ep-cb">
            <Alert tone="critical">{(error as Error).message}</Alert>
          </div>
        ) : isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon={Puzzle} title="No AI extensions found">
            Endpoints with Windows agent 0.2.34 or later check for AI add-ons every 15 minutes (0.2.33: every 6 hours). Select Scan
            now to have them check within 5 minutes.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">App</th>
                  <th scope="col" style={{ textAlign: "right" }}>Endpoints</th>
                  <th scope="col">Users</th>
                  <th scope="col">Version</th>
                  <th scope="col">{endpoint ? `Action on ${endpoint.hostname}` : "Action"}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const here = on(c);
                  const blockedHere = c.key in choices ? choices[c.key] : !!here?.blocked;
                  return (
                    <tr key={c.key}>
                      <td className="ep-host">
                        <b>{c.name}</b>
                        <span className="app-row-sub ep-mono">{c.identifier}</span>
                      </td>
                      <td>{KIND_LABEL[c.kind]}</td>
                      <td>{HOST_LABEL[c.host] ?? c.host}</td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        <Button size="sm" variant="ghost" title={c.endpoints.map((e) => e.hostname).join(", ")} onClick={() => setManagingKey(c.key)}>
                          <Monitor size={14} aria-hidden /> {c.endpoints.length}
                        </Button>
                      </td>
                      <td>{c.users.join(", ") || <span className="app-muted">—</span>}</td>
                      <td className="ep-mono">{c.versions.join(", ") || "—"}</td>
                      <td>
                        {!c.enforceable ? (
                          <span className="app-muted">Report only</span>
                        ) : endpoint && here?.policyBlocked ? (
                          <span title="Blocked by this endpoint's AI Guard policy - change it on the policy's AI Extensions tab.">
                            <Badge tone="crit">Blocked by policy</Badge>
                          </span>
                        ) : endpoint ? (
                          <select
                            className="ep-select"
                            aria-label={`Action for ${c.name} on ${endpoint.hostname}`}
                            value={blockedHere ? "BLOCK" : "ALLOW"}
                            onChange={(e) => {
                              setSaved(false);
                              setChoices((prev) => ({ ...prev, [c.key]: e.target.value === "BLOCK" }));
                            }}
                            style={
                              blockedHere
                                ? { color: "var(--ep-sev-critical)", borderColor: "var(--ep-sev-critical)", fontWeight: 600 }
                                : { color: "var(--ep-ok)", borderColor: "var(--ep-ok)", fontWeight: 600 }
                            }
                          >
                            <option value="ALLOW">Allowed</option>
                            <option value="BLOCK">Blocked</option>
                          </select>
                        ) : c.blockedOn > 0 ? (
                          <Badge tone="crit">Blocked on {c.blockedOn}</Badge>
                        ) : (
                          <Badge tone="ok">Allowed</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {endpoint && shown.some((c) => c.enforceable) && (
          <div className="ep-cb app-stack">
            {saveError && <Alert tone="critical">{saveError}</Alert>}
            <FormFooter>
              {saved && changed.length === 0 && <span className="app-saved">Saved - {endpoint.hostname} applies it within 5 minutes</span>}
              <Button variant="primary" onClick={saveEndpoint} disabled={saving || changed.length === 0}>
                {saving ? "Saving…" : "Save Action"}
              </Button>
            </FormFooter>
          </div>
        )}
      </Card>
      <Alert tone="info">
        Blocking works for Chrome and Edge extensions (the browser disables them) and VS Code extensions (VS Code refuses them).
        Cursor, Windsurf, VSCodium and command-line tools are reported only.
      </Alert>
      {managing && <EndpointBlockDialog key={managing.key} component={managing} onClose={() => setManagingKey(null)} />}
    </>
  );
}

// One add-on on each endpoint it was found on: Allowed or Blocked for that endpoint only. A block
// from the endpoint's AI Guard policy is shown but changed on the policy.
function EndpointBlockDialog({ component: c, onClose }: { component: AiComponentView; onClose: () => void }) {
  const setBlock = useSetAiEndpointBlock();
  const saved = () => Object.fromEntries(c.endpoints.map((e) => [e.agentId, e.blocked]));
  const [blocked, setBlocked] = useState<Record<string, boolean>>(saved);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = c.endpoints.filter((e) => blocked[e.agentId] !== e.blocked);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      for (const e of changed) await setBlock.mutateAsync({ agentId: e.agentId, key: c.key, blocked: blocked[e.agentId] });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`${c.name} on Endpoints`}
      description={
        c.enforceable
          ? "Allow or block it on individual endpoints. The endpoint applies the change within 5 minutes."
          : `${HOST_LABEL[c.host] ?? c.host} add-ons are reported only - they can't be blocked.`
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {c.enforceable && (
            <Button variant="primary" onClick={handleSave} disabled={saving || changed.length === 0}>
              {saving ? "Saving…" : "Save Action"}
            </Button>
          )}
        </>
      }
    >
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Endpoint</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {c.endpoints.map((e) => (
              <tr key={e.agentId}>
                <td className="ep-host">
                  <b>{e.hostname}</b>
                </td>
                <td>
                  {!c.enforceable ? (
                    <span className="app-muted">Report only</span>
                  ) : e.policyBlocked ? (
                    <span title="Blocked by this endpoint's AI Guard policy - change it on the policy's AI Extensions tab.">
                      <Badge tone="crit">Blocked by policy</Badge>
                    </span>
                  ) : (
                    <select
                      className="ep-select"
                      aria-label={`Action on ${e.hostname}`}
                      value={blocked[e.agentId] ? "BLOCK" : "ALLOW"}
                      onChange={(ev) => setBlocked((prev) => ({ ...prev, [e.agentId]: ev.target.value === "BLOCK" }))}
                      style={
                        blocked[e.agentId]
                          ? { color: "var(--ep-sev-critical)", borderColor: "var(--ep-sev-critical)", fontWeight: 600 }
                          : { color: "var(--ep-ok)", borderColor: "var(--ep-ok)", fontWeight: 600 }
                      }
                    >
                      <option value="ALLOW">Allowed</option>
                      <option value="BLOCK">Blocked</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <Alert tone="critical">{error}</Alert>}
    </Modal>
  );
}

function PolicyAddonsPanel({ policy }: { policy: AiGuardPolicyView }) {
  const update = useUpdateAiPolicy();
  const { data, isLoading } = useAiComponents("");
  const enforceable = (data ?? []).filter((c) => c.enforceable);
  const savedBlocked = () => Object.fromEntries(Object.entries(policy.appActions).filter(([k, a]) => k.startsWith("addon:") && a === "BLOCK")) as Record<string, AiAction>;
  const [blocked, setBlocked] = useState<Record<string, AiAction>>(savedBlocked);
  const dirty = JSON.stringify(blocked) !== JSON.stringify(savedBlocked());

  function setAction(key: string, value: AiAction) {
    setBlocked((prev) => {
      const next = { ...prev };
      if (value === "BLOCK") next[key] = "BLOCK";
      else delete next[key];
      return next;
    });
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    const tools = Object.fromEntries(Object.entries(policy.appActions).filter(([k]) => !k.startsWith("addon:")));
    update.mutate({ id: policy.id, name: policy.name, description: policy.description, enabled: policy.enabled, defaultAction: "ALLOW", appActions: { ...tools, ...blocked } });
  }

  if (isLoading) return <Skeleton />;
  return (
    <form onSubmit={handleSave} className="app-stack">
      <p className="app-text app-muted">
        AI add-ons found on your endpoints that a policy can block: Chrome and Edge extensions, and VS Code extensions. Every one is
        Allowed unless set to Blocked. Needs Windows agent 0.2.33 or later.
      </p>
      {enforceable.length === 0 ? (
        <EmptyState icon={Puzzle} title="No AI extensions found yet">
          They appear here once endpoints with agent 0.2.33 or later have reported them (see AI Extensions).
        </EmptyState>
      ) : (
        <div className="app-table-scroll">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">App</th>
                <th scope="col" style={{ textAlign: "right" }}>Endpoints</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {enforceable.map((c) => (
                <tr key={c.key}>
                  <td className="ep-host">
                    <b>{c.name}</b>
                    <span className="app-row-sub ep-mono">{c.identifier}</span>
                  </td>
                  <td>{HOST_LABEL[c.host] ?? c.host}</td>
                  <td className="ep-num" style={{ textAlign: "right" }}>{c.endpoints.length}</td>
                  <td>
                    <select
                      className="ep-select"
                      aria-label={`Action for ${c.name}`}
                      value={blocked[c.key] ?? "ALLOW"}
                      onChange={(e) => setAction(c.key, e.target.value as AiAction)}
                      style={
                        blocked[c.key] === "BLOCK"
                          ? { color: "var(--ep-sev-critical)", borderColor: "var(--ep-sev-critical)", fontWeight: 600 }
                          : { color: "var(--ep-ok)", borderColor: "var(--ep-ok)", fontWeight: 600 }
                      }
                    >
                      <option value="ALLOW">Allowed</option>
                      <option value="BLOCK">Blocked</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!update.error && <Alert tone="critical">{(update.error as Error).message}</Alert>}
      <FormFooter>
        {update.isSuccess && !dirty && <span className="app-saved">Saved</span>}
        <Button variant="primary" type="submit" disabled={update.isPending || !dirty}>
          {update.isPending ? "Saving…" : "Save Action"}
        </Button>
      </FormFooter>
    </form>
  );
}

// ---- AI Tools (catalogue) -------------------------------------------------------------------

export function AiGuardAppsPage() {
  const { data: apps, isLoading } = useAiApps();
  const deleteApp = useDeleteAiApp();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<AiAppView | "new" | null>(null);
  const term = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (apps ?? []).filter(
        (a) =>
          (!category || a.category === category) &&
          (!term || a.name.toLowerCase().includes(term) || a.vendor.toLowerCase().includes(term) || a.domains.some((d) => d.includes(term))),
      ),
    [apps, category, term],
  );

  async function handleDelete(a: AiAppView) {
    const ok = await confirm({
      title: `Delete AI Tool "${a.name}"?`,
      body: "It's no longer recognised in AI usage, and policies stop blocking it at the endpoints' next sync.",
      confirmLabel: "Delete tool",
      tone: "danger",
    });
    if (ok) deleteApp.mutate(a.key.replace(/^custom:/, ""));
  }

  return (
    <>
      <PageHeader
        title="AI Tools"
        description="The AI tools AI Guard recognises, with their websites and desktop programs. Add tools your organisation uses that aren't listed."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>
            Add AI tool
          </Button>
        }
      />
      <Card flush>
        <Toolbar right={<span className="app-muted">{shown.length} tools</span>}>
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, vendor or website…" />
          <select className="ep-select" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Category: All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Toolbar>
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon={Sparkles} title="No AI tools match">
            Try a different search or category.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">AI tool</th>
                  <th scope="col">Category</th>
                  <th scope="col">Risk</th>
                  <th scope="col">Websites</th>
                  <th scope="col">Desktop programs</th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.key}>
                    <td className="ep-host">
                      <b>{a.name}</b>
                      <span className="app-row-sub">{a.custom ? "Added by your team" : a.vendor}</span>
                    </td>
                    <td>{a.category}</td>
                    <td>
                      <RiskBadge risk={a.risk} />
                      {a.riskNote && <span className="app-row-sub">{a.riskNote}</span>}
                    </td>
                    <td className="ep-mono">{a.domains.join(", ") || "—"}</td>
                    <td className="ep-mono">{a.executables.join(", ") || "—"}</td>
                    <td>
                      {a.custom && (
                        <div className="app-cell-actions">
                          <RowMenu
                            label={`Actions for ${a.name}`}
                            items={[
                              { label: "Edit", icon: Pencil, onSelect: () => setEditing(a) },
                              { label: "Delete", icon: Trash2, danger: true, dividerBefore: true, disabled: deleteApp.isPending, onSelect: () => handleDelete(a) },
                            ]}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <CustomAppDialog app={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function lines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function CustomAppDialog({ app, onClose }: { app: AiAppView | null; onClose: () => void }) {
  const create = useCreateAiApp();
  const update = useUpdateAiApp();
  const [name, setName] = useState(app?.name ?? "");
  const [category, setCategory] = useState(app?.category ?? "Chat assistant");
  const [risk, setRisk] = useState<AiAppRisk>(app?.risk ?? "MEDIUM");
  const [domains, setDomains] = useState(app?.domains.join("\n") ?? "");
  const [executables, setExecutables] = useState(app?.executables.join("\n") ?? "");
  const mutation = app ? update : create;
  const formId = "ai-custom-app-form";

  function submit(e: FormEvent) {
    e.preventDefault();
    const input: AiCustomAppInput = { name: name.trim(), category, risk, domains: lines(domains), executables: lines(executables) };
    if (app) update.mutate({ ...input, id: app.key.replace(/^custom:/, "") }, { onSuccess: onClose });
    else create.mutate(input, { onSuccess: onClose });
  }

  return (
    <Modal
      title={app ? `Edit ${app.name}` : "Add AI Tool"}
      description="AI Guard recognises it by its websites and desktop program names, in usage and in policies."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={mutation.isPending || !name.trim() || (!lines(domains).length && !lines(executables).length)}>
            {mutation.isPending ? "Saving…" : app ? "Save changes" : "Add AI tool"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="app-stack">
        <Field label="Name" htmlFor="ai-name" required>
          <input id="ai-name" data-autofocus className="ep-input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Category" htmlFor="ai-category">
          <select id="ai-category" className="ep-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Risk" htmlFor="ai-risk">
          <select id="ai-risk" className="ep-select" value={risk} onChange={(e) => setRisk(e.target.value as AiAppRisk)}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </Field>
        <Field label="Websites" htmlFor="ai-domains" help="One domain per line, e.g. chat.example.com. Subdomains are included.">
          <textarea id="ai-domains" className="ep-textarea ep-mono" rows={3} value={domains} onChange={(e) => setDomains(e.target.value)} />
        </Field>
        <Field label="Desktop programs" htmlFor="ai-exes" help="One program file name per line, e.g. assistant.exe.">
          <textarea id="ai-exes" className="ep-textarea ep-mono" rows={2} value={executables} onChange={(e) => setExecutables(e.target.value)} />
        </Field>
        {!!mutation.error && <Alert tone="critical">{(mutation.error as Error).message}</Alert>}
      </form>
    </Modal>
  );
}
