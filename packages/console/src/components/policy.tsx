import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AgentListItem } from "../api/types";
import { Users, X } from "lucide-react";
import { useAgents, useAssetGroups } from "../api/hooks";
import EndpointCheckboxList from "./EndpointCheckboxList";
import EndpointLabel from "./EndpointLabel";
import {
  useConfirm,
  Alert,
  Badge,
  Button,
  Check,
  EmptyState,
  Field,
  FormFooter,
  IconButton,
  Modal,
  Pill,
  Tabs,
} from "./ui";
import { formatDateTime } from "../format";

// Shared building blocks for every policy page (EPM categories, DLP content and email
// policies): one consistent list → detail workflow. Each page keeps its own hooks and rule
// editor; these components carry the layout and the parts that are identical everywhere.

// h2-level header for a section that lives under a page header + tabs (e.g. one EPM tab).
export function SectionHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="app-section-head">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="app-actions-row">{actions}</div>}
    </div>
  );
}

// "New policy" modal: name + description (+ any page-specific fields as children).
export function NewPolicyDialog({
  title = "New policy",
  onClose,
  onCreate,
  pending,
  error,
  children,
  extraValid = true,
}: {
  title?: string;
  onClose: () => void;
  // Resolve to close the dialog; reject to keep it open with the error shown.
  onCreate: (values: { name: string; description: string | null }) => Promise<unknown>;
  pending: boolean;
  error: unknown;
  children?: ReactNode;
  // Page-specific fields can block submission until they're valid.
  extraValid?: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const formId = "new-policy-form";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await onCreate({ name: name.trim(), description: description.trim() || null });
      onClose();
    } catch {
      // error is rendered from the mutation state
    }
  }

  return (
    <Modal
      title={title}
      description="Name it after what it blocks or who it applies to, so it's easy to find later."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={pending || !name.trim() || !extraValid}>
            {pending ? "Creating…" : "Create policy"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="app-stack">
        <Field label="Name" htmlFor="new-policy-name" required>
          <input id="new-policy-name" data-autofocus className="ep-input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Description" htmlFor="new-policy-desc">
          <textarea id="new-policy-desc" className="ep-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {children}
        {!!error && <Alert tone="critical">{(error as Error).message}</Alert>}
      </form>
    </Modal>
  );
}

export interface PolicyDetailTab {
  value: string;
  label: ReactNode;
  content: ReactNode;
}

// The selected policy: name, on/off state, and its sub-views as tabs. Scrolls itself into
// view when a different policy is opened, since it renders below the policy list.
export function PolicyDetail({
  policyId,
  name,
  enabled,
  meta,
  tabs,
  onClose,
  actions,
}: {
  policyId: string;
  name: string;
  enabled: boolean;
  // Short facts after the status ("12 domains · 4 endpoints").
  meta?: ReactNode;
  tabs: PolicyDetailTab[];
  onClose: () => void;
  // Extra header buttons, left of the close button (e.g. Zero Trust "Scan now").
  actions?: ReactNode;
}) {
  const [tab, setTab] = useState(tabs[0]?.value ?? "");
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    setTab(tabs[0]?.value ?? "");
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Only when a different policy is opened — not on every re-render of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId]);

  const active = tabs.find((t) => t.value === tab) ?? tabs[0];

  return (
    <section ref={ref} className="ep-card app-policy-detail" aria-label={`Policy ${name}`}>
      <div className="ep-ch">
        <h3>{name}</h3>
        <Pill tone={enabled ? "ok" : "neutral"}>{enabled ? "Enabled" : "Paused"}</Pill>
        {meta && <span className="ep-hint">· {meta}</span>}
        <div className="ep-r">
          {actions}
          <IconButton icon={X} label="Close policy" onClick={onClose} />
        </div>
      </div>
      <div className="app-policy-tabs">
        <Tabs items={tabs.map((t) => ({ value: t.value, label: t.label }))} value={active?.value} onChange={setTab} />
      </div>
      <div className="ep-cb">{active?.content}</div>
    </section>
  );
}

// Policy name/description editor, with optional page-specific fields as children.
export function PolicySettingsForm({
  policyId,
  name: initialName,
  description: initialDescription,
  onSave,
  pending,
  error,
  saved,
  children,
}: {
  policyId: string;
  name: string;
  description: string | null;
  onSave: (values: { name: string; description: string | null }) => void;
  pending: boolean;
  error: unknown;
  saved: boolean;
  children?: ReactNode;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");

  useEffect(() => {
    setName(initialName);
    setDescription(initialDescription ?? "");
  }, [policyId, initialName, initialDescription]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSave({ name, description: description.trim() || null });
  }

  return (
    <form onSubmit={handleSubmit} className="app-settings-form">
      <div className="app-stack" style={{ maxWidth: 640 }}>
        <Field label="Name" htmlFor={`policy-name-${policyId}`} required>
          <input id={`policy-name-${policyId}`} className="ep-input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Description" htmlFor={`policy-desc-${policyId}`}>
          <textarea id={`policy-desc-${policyId}`} className="ep-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {children}
        {!!error && <Alert tone="critical">{(error as Error).message}</Alert>}
      </div>
      <FormFooter>
        {saved && !pending && <span className="app-saved">Saved</span>}
        <Button variant="primary" type="submit" disabled={pending || !name.trim()}>
          {pending ? "Saving…" : "Save policy"}
        </Button>
      </FormFooter>
    </form>
  );
}

export interface AssignmentRow {
  id: string;
  agentId?: string | null;
  hostname?: string | null;
  groupId?: string | null;
  groupName?: string | null;
}

// One row per target: older servers could store the same endpoint/group twice, so duplicates
// are folded together (and removing the row removes every copy).
function foldAssignments(assignments: AssignmentRow[]): (AssignmentRow & { ids: string[] })[] {
  const byTarget = new Map<string, AssignmentRow & { ids: string[] }>();
  for (const a of assignments) {
    const key = a.agentId ? `agent:${a.agentId}` : a.groupId ? `group:${a.groupId}` : `row:${a.id}`;
    const seen = byTarget.get(key);
    if (seen) seen.ids.push(a.id);
    else byTarget.set(key, { ...a, ids: [a.id] });
  }
  return [...byTarget.values()];
}

// Blocking policies reach every assigned endpoint at its next sync. Past this many endpoints,
// assigning one asks for confirmation and suggests trying a small group first.
export const LARGE_BLOCKING_ASSIGNMENT = 10;

export async function confirmLargeBlockingAssignment(
  confirm: ReturnType<typeof useConfirm>,
  agentIds: string[],
  groupIds: string[],
  groups: { id: string; memberCount: number }[],
): Promise<boolean> {
  const count = agentIds.length + groups.filter((g) => groupIds.includes(g.id)).reduce((n, g) => n + g.memberCount, 0);
  if (count < LARGE_BLOCKING_ASSIGNMENT) return true;
  return confirm({
    title: `Apply a blocking policy to about ${count} endpoints?`,
    body: "Its rules take effect on every one of them within a minute. If you haven't yet, assign it to a few test devices first and check they still work normally. Endpoints can be released at once with Pause, or from EPM with Emergency release.",
    confirmLabel: "Assign",
    tone: "danger",
  });
}

// Current assignments (removable) + the group/endpoint picker to add more.
export function AssignmentEditor({
  assignments,
  onUnassign,
  unassignPending,
  onAssign,
  assignPending,
  assignError,
  renderAgentExtra,
  blocking = false,
}: {
  assignments: AssignmentRow[] | undefined;
  onUnassign: (assignmentId: string) => void;
  unassignPending: boolean;
  // Call `done` on success so the picker clears.
  onAssign: (agentIds: string[], groupIds: string[], done: () => void) => void;
  assignPending: boolean;
  assignError: unknown;
  // Extra text after each endpoint in the picker (e.g. its OS edition).
  renderAgentExtra?: (agent: AgentListItem) => ReactNode;
  // A policy that blocks or stops things on endpoints: assigning it widely asks for confirmation.
  blocking?: boolean;
}) {
  const confirmAssign = useConfirm();
  const { data: allAgents } = useAgents();
  const { data: allGroups } = useAssetGroups();

  // Already-assigned targets aren't offered again - neither directly assigned endpoints and
  // groups, nor endpoints already covered through an assigned group.
  const rows = assignments ? foldAssignments(assignments) : undefined;
  const assignedGroupIds = new Set((assignments ?? []).map((a) => a.groupId).filter((id): id is string => !!id));
  const assignedAgentIds = new Set((assignments ?? []).map((a) => a.agentId).filter((id): id is string => !!id));
  const groups = allGroups?.filter((g) => !assignedGroupIds.has(g.id));
  const agents = allAgents?.filter((a) => !assignedAgentIds.has(a.id) && !a.groups.some((g) => assignedGroupIds.has(g.id)));
  const hiddenCount = (allAgents?.length ?? 0) - (agents?.length ?? 0) + (allGroups?.length ?? 0) - (groups?.length ?? 0);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  return (
    <div className="app-stack">
      <div className="app-stack-sm">
        <span className="app-subhead">Currently assigned</span>
        {rows && rows.length === 0 ? (
          <EmptyState icon={Users} title="Not assigned yet">
            Pick groups or endpoints below. A policy does nothing until it's assigned.
          </EmptyState>
        ) : (
          <div className="app-table-wrap">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Target</th>
                  <th scope="col">Type</th>
                  <th scope="col">
                    <span className="app-vh">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((a) => (
                  <tr key={a.id}>
                    <td>{a.hostname ? <EndpointLabel hostname={a.hostname} agentId={a.agentId} /> : a.groupName}</td>
                    <td>{a.hostname ? "Endpoint" : <Badge tone="neu">Group</Badge>}</td>
                    <td>
                      <div className="app-cell-actions">
                        <IconButton
                          icon={X}
                          label={`Remove ${a.hostname ?? a.groupName ?? "assignment"}`}
                          onClick={() => a.ids.forEach((id) => onUnassign(id))}
                          disabled={unassignPending}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="app-stack-sm">
        <span className="app-subhead">Assign to</span>
        {hiddenCount > 0 && (
          <p className="app-text app-muted">
            {hiddenCount} already-assigned {hiddenCount === 1 ? "target is" : "targets are"} not listed (assigned directly or
            through a group).
          </p>
        )}
        {groups && groups.length > 0 && (
          <div className="app-check-grid">
            {groups.map((g) => (
              <Check
                key={g.id}
                checked={selectedGroupIds.includes(g.id)}
                onChange={() => setSelectedGroupIds((prev) => toggle(prev, g.id))}
                label={
                  <>
                    {g.name} <span className="app-muted ep-num">({g.memberCount})</span>
                  </>
                }
              />
            ))}
          </div>
        )}
        <EndpointCheckboxList
          agents={agents}
          selectedAgentIds={selectedAgentIds}
          onToggle={(id) => setSelectedAgentIds((prev) => toggle(prev, id))}
          selectedGroupIds={selectedGroupIds}
          renderExtra={renderAgentExtra}
          emptyMessage={allAgents && allAgents.length > 0 ? "Every endpoint is already assigned." : undefined}
        />
        {!!assignError && <Alert tone="critical">{(assignError as Error).message}</Alert>}
        <div className="app-actions-row app-end">
          <Button
            variant="primary"
            onClick={async () => {
              if (blocking && !(await confirmLargeBlockingAssignment(confirmAssign, selectedAgentIds, selectedGroupIds, allGroups ?? []))) return;
              onAssign(selectedAgentIds, selectedGroupIds, () => {
                setSelectedAgentIds([]);
                setSelectedGroupIds([]);
              });
            }}
            disabled={assignPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
          >
            {assignPending ? "Assigning…" : "Assign"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface SyncStatusRow {
  agentId: string;
  hostname: string;
  groupName: string | null;
  lastLoggedOnUser: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
}

// "Did each endpoint apply the current rule list?" — for modules with no per-event log.
export function SyncStatusTable({ rows, explanation }: { rows: SyncStatusRow[]; explanation?: ReactNode }) {
  const failedCount = rows.filter((a) => a.lastSyncStatus === "FAILED").length;
  const syncedCount = rows.filter((a) => a.lastSyncStatus === "SUCCESS").length;
  return (
    <div className="app-stack">
      {explanation && <p className="app-text">{explanation}</p>}
      <div className="app-badge-row">
        <Badge tone="neu">{rows.length} assigned</Badge>
        <Badge tone="ok">{syncedCount} synced</Badge>
        <Badge tone={failedCount > 0 ? "crit" : "neu"}>{failedCount} failed</Badge>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Users} title="Not assigned to any endpoint yet">
          Assign the policy to see each endpoint's sync status here.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">Group</th>
                <th scope="col">User</th>
                <th scope="col">Status</th>
                <th scope="col">Last synced</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.agentId}>
                  <td>
                    <EndpointLabel hostname={a.hostname} agentId={a.agentId} hideUser />
                  </td>
                  <td>{a.groupName ?? <span className="app-muted">—</span>}</td>
                  <td>{a.lastLoggedOnUser ?? <span className="app-muted">—</span>}</td>
                  <td>
                    {a.lastSyncStatus === "SUCCESS" ? (
                      <Badge tone="ok">Synced</Badge>
                    ) : a.lastSyncStatus === "FAILED" ? (
                      <span title={a.lastSyncError ?? undefined}>
                        <Badge tone="crit">Failed</Badge>
                        {a.lastSyncError && <span className="app-muted app-cell-note">{a.lastSyncError}</span>}
                      </span>
                    ) : (
                      <Pill tone="warn">Not synced yet</Pill>
                    )}
                  </td>
                  <td className="app-muted">{formatDateTime(a.lastSyncedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
