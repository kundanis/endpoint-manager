import { useState, type FormEvent } from "react";
import { Eye, History, Pencil, TerminalSquare, Trash2, X } from "lucide-react";
import type { Shell } from "@em/shared";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import {
  useAgents,
  useAssetGroups,
  useBulkQuarantine,
  useBulkRelease,
  useCommandJob,
  useCommandJobs,
  useCommandTemplates,
  useCreateCommandTemplate,
  useDeleteCommandTemplate,
  useDispatchCommand,
  useDispatchCommandTemplate,
  useUpdateCommandTemplate,
} from "../api/hooks";
import type { CommandTemplateView } from "../api/types";
import Collapsible from "../components/Collapsible";
import EndpointLabel from "../components/EndpointLabel";
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
  PageHeader,
  Pagination,
  Pill,
  RowMenu,
  Skeleton,
  Status,
  TaskCounts,
  TaskStatus,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatDateTime, pluralize } from "../format";

const ISOLATE_OPTION = "isolate";
const RELEASE_OPTION = "release";
const CUSTOM_OPTION = "custom";
const TEMPLATE_PREFIX = "template:";

// Command task status → Meridian badge/pill. In-flight states are a warn pill; finished
// states are a badge (success ok, failed/timeout critical). Unknown values stay neutral.
function ManageTemplatesPanel() {
  const { data: templates } = useCommandTemplates();
  const create = useCreateCommandTemplate();
  const update = useUpdateCommandTemplate();
  const del = useDeleteCommandTemplate();
  const confirm = useConfirm();

  const [editingId, setEditingId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shell, setShell] = useState<Shell>("powershell");
  const [script, setScript] = useState("");

  function resetForm() {
    setEditingId(undefined);
    setName("");
    setDescription("");
    setShell("powershell");
    setScript("");
  }

  function startEdit(t: CommandTemplateView) {
    setEditingId(t.id);
    setName(t.name);
    setDescription(t.description ?? "");
    setShell(t.shell);
    setScript(t.script);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = { name, description: description.trim() || undefined, shell, script };
    if (editingId) {
      update.mutate(
        { id: editingId, name, description: description.trim() || null, shell, script },
        { onSuccess: () => resetForm() },
      );
    } else {
      create.mutate(body, { onSuccess: () => resetForm() });
    }
  }

  async function handleDelete(t: CommandTemplateView) {
    const confirmed = await confirm({
      title: `Delete Predefined Command "${t.name}"?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete command",
      tone: "danger",
    });
    if (!confirmed) return;
    del.mutate(t.id, { onSuccess: () => editingId === t.id && resetForm() });
  }

  const mutation = editingId ? update : create;

  return (
    <Collapsible
      title="Manage Predefined Commands"
      hint={templates ? pluralize(templates.length, "command") : undefined}
      defaultOpen={false}
    >
      <div className="app-stack">
        {templates?.length === 0 ? (
          <EmptyState icon={TerminalSquare} title="No predefined commands yet">
            Add one below — it then appears in the predefined command list when you run a command.
          </EmptyState>
        ) : (
          <div className="app-table-wrap">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Description</th>
                  <th scope="col">Shell</th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {templates?.map((t) => (
                  <tr key={t.id} className={t.id === editingId ? "ep-sel" : undefined}>
                    <td>
                      <b>{t.name}</b>
                    </td>
                    <td>{t.description ?? <span className="app-muted">—</span>}</td>
                    <td className="ep-mono">{t.shell}</td>
                    <td>
                      <div className="app-cell-actions">
                        <RowMenu
                          label={`Actions for ${t.name}`}
                          items={[
                            { label: "Edit command", icon: Pencil, onSelect: () => startEdit(t) },
                            { label: "Delete command", icon: Trash2, danger: true, dividerBefore: true, onSelect: () => handleDelete(t) },
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

        <form onSubmit={handleSubmit} className="app-inset-form">
          <span className="app-subhead">{editingId ? "Edit Predefined Command" : "Add Predefined Command"}</span>
          <FormGrid>
            <Field label="Name" htmlFor="template-name" required>
              <input id="template-name" className="ep-input" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Shell" htmlFor="template-shell">
              <select id="template-shell" className="ep-select" value={shell} onChange={(e) => setShell(e.target.value as Shell)}>
                <option value="powershell">PowerShell (Windows)</option>
                <option value="cmd">cmd (Windows)</option>
                <option value="bash">bash (Linux/macOS)</option>
                <option value="sh">sh (Linux/macOS)</option>
              </select>
            </Field>
            <Field label="Description" htmlFor="template-description" span2>
              <input
                id="template-description"
                className="ep-input"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label="Script" htmlFor="template-script" required span2>
              <textarea
                id="template-script"
                className="ep-textarea ep-mono"
                rows={5}
                value={script}
                onChange={(e) => setScript(e.target.value)}
                required
              />
            </Field>
          </FormGrid>
          {mutation.isError && <Alert tone="critical">{(mutation.error as Error).message}</Alert>}
          <div className="app-actions-row app-end">
            {editingId && <Button onClick={resetForm}>Cancel</Button>}
            <Button type="submit" variant="primary" disabled={mutation.isPending || !name.trim() || !script.trim()}>
              {mutation.isPending ? "Saving…" : editingId ? "Save changes" : "Add predefined command"}
            </Button>
          </div>
        </form>
      </div>
    </Collapsible>
  );
}

export default function CommandsPage() {
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: jobs, isLoading: jobsLoading, error: jobsError, refetch: refetchJobs } = useCommandJobs();
  const { data: templates } = useCommandTemplates();
  const dispatch = useDispatchCommand();
  const dispatchTemplate = useDispatchCommandTemplate();
  const bulkQuarantine = useBulkQuarantine();
  const bulkRelease = useBulkRelease();
  const confirm = useConfirm();

  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [predefined, setPredefined] = useState<string>(CUSTOM_OPTION);
  const [shell, setShell] = useState<Shell>("powershell");
  const [script, setScript] = useState("");
  const [timeoutSec, setTimeoutSec] = useState(120);
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();

  const { data: jobDetail } = useCommandJob(selectedJobId);
  const pagedJobs = usePagedList(jobs ?? []);

  const targetCount = new Set(selectedAgentIds).size + selectedGroupIds.length;
  const selectedTemplate = predefined.startsWith(TEMPLATE_PREFIX)
    ? templates?.find((t) => t.id === predefined.slice(TEMPLATE_PREFIX.length))
    : undefined;

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (predefined === ISOLATE_OPTION) {
      const confirmed = await confirm({
        title: `Isolate ${targetCount} Target(s) From the Network?`,
        body: "This locks down outbound access to DNS and this server only, until released.",
        confirmLabel: "Isolate targets",
        tone: "danger",
      });
      if (!confirmed) return;
      bulkQuarantine.mutate(
        { agentIds: selectedAgentIds, groupIds: selectedGroupIds },
        { onSuccess: (result) => setSelectedJobId(result.jobId) },
      );
      return;
    }

    if (predefined === RELEASE_OPTION) {
      const confirmed = await confirm({
        title: `Release ${targetCount} Target(s) From Quarantine?`,
        body: "This restores normal network access.",
        confirmLabel: "Release targets",
      });
      if (!confirmed) return;
      bulkRelease.mutate(
        { agentIds: selectedAgentIds, groupIds: selectedGroupIds },
        { onSuccess: (result) => setSelectedJobId(result.jobId) },
      );
      return;
    }

    if (selectedTemplate) {
      dispatchTemplate.mutate(
        { id: selectedTemplate.id, agentIds: selectedAgentIds, groupIds: selectedGroupIds },
        { onSuccess: (result) => setSelectedJobId(result.jobId) },
      );
      return;
    }

    dispatch.mutate(
      { agentIds: selectedAgentIds, groupIds: selectedGroupIds, shell, script, timeoutSec },
      { onSuccess: (result) => setSelectedJobId(result.jobId) },
    );
  }

  const isCustom = predefined === CUSTOM_OPTION;
  const dispatchPending = dispatch.isPending || dispatchTemplate.isPending || bulkQuarantine.isPending || bulkRelease.isPending;
  const dispatchError = dispatch.error ?? dispatchTemplate.error ?? bulkQuarantine.error ?? bulkRelease.error;

  return (
    <>
      <PageHeader
        title="Commands"
        description="Run a script or predefined command on endpoints and groups, then review each endpoint's output."
      />

      <form className="ep-card" onSubmit={handleSubmit}>
        <FormSection title="Run a Command" description="Pick a predefined command, or write a custom script.">
          <div className="app-stack">
            <FormGrid>
              <Field label="Predefined command" htmlFor="command-predefined" span2>
                <select id="command-predefined" className="ep-select" value={predefined} onChange={(e) => setPredefined(e.target.value)}>
                  <option value={CUSTOM_OPTION}>Custom script</option>
                  <option value={ISOLATE_OPTION}>⚠ Isolate from network</option>
                  <option value={RELEASE_OPTION}>Release from quarantine</option>
                  {templates?.map((t) => (
                    <option key={t.id} value={`${TEMPLATE_PREFIX}${t.id}`}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>

              {isCustom && (
                <>
                  <Field label="Shell" htmlFor="command-shell">
                    <select id="command-shell" className="ep-select" value={shell} onChange={(e) => setShell(e.target.value as Shell)}>
                      <option value="powershell">PowerShell (Windows)</option>
                      <option value="cmd">cmd (Windows)</option>
                      <option value="bash">bash (Linux/macOS)</option>
                      <option value="sh">sh (Linux/macOS)</option>
                    </select>
                  </Field>
                  <Field label="Timeout (seconds)" htmlFor="command-timeout">
                    <input
                      id="command-timeout"
                      className="ep-input ep-num"
                      type="number"
                      min={1}
                      max={900}
                      value={timeoutSec}
                      onChange={(e) => setTimeoutSec(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Script" htmlFor="command-script" required span2>
                    <textarea
                      id="command-script"
                      className="ep-textarea ep-mono"
                      rows={5}
                      value={script}
                      onChange={(e) => setScript(e.target.value)}
                      required
                    />
                  </Field>
                </>
              )}
            </FormGrid>

            {predefined === ISOLATE_OPTION && (
              <Alert tone="warn">
                Locks down outbound network access on every selected endpoint to DNS and this server only, until released.
                Reuses the same mechanism as the per-endpoint Quarantine action.
              </Alert>
            )}
            {predefined === RELEASE_OPTION && <Alert tone="info">Restores normal outbound network access on every selected endpoint.</Alert>}
            {selectedTemplate?.description && <p className="app-text">{selectedTemplate.description}</p>}
          </div>
        </FormSection>

        <FormSection title="Targets" description="Choose groups, individual endpoints, or both.">
          <div className="app-stack-sm">
            {groups && groups.length > 0 && (
              <>
                <span className="app-subhead">Target Groups</span>
                <div className="app-check-grid">
                  {groups.map((g) => (
                    <Check
                      key={g.id}
                      checked={selectedGroupIds.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                      label={
                        <>
                          {g.name} <span className="app-muted ep-num">({g.memberCount})</span>
                        </>
                      }
                    />
                  ))}
                </div>
              </>
            )}

            <EndpointCheckboxList
              agents={agents}
              selectedAgentIds={selectedAgentIds}
              onToggle={toggleAgent}
              selectedGroupIds={selectedGroupIds}
              legend="Target endpoints"
              renderExtra={(agent) => <Status value={agent.status} />}
            />

            {!!dispatchError && <Alert tone="critical">{(dispatchError as Error).message}</Alert>}
          </div>
        </FormSection>

        <FormFooter>
          <span className="app-muted ep-num" style={{ marginRight: "auto", alignSelf: "center" }}>
            {targetCount === 0 ? "No targets selected" : `${pluralize(targetCount, "target")} selected`}
          </span>
          <Button type="submit" variant="primary" disabled={dispatchPending || targetCount === 0}>
            {dispatchPending ? "Dispatching…" : "Dispatch command"}
          </Button>
        </FormFooter>
      </form>

      <Card flush title="Recent Jobs" hint="last 24 hours">
        {jobsLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : jobsError ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load recent jobs"
              action={
                <Button size="sm" onClick={() => refetchJobs()}>
                  Retry
                </Button>
              }
            >
              {(jobsError as Error).message}
            </Alert>
          </div>
        ) : !jobs || jobs.length === 0 ? (
          <EmptyState icon={History} title="No commands dispatched in the last 24 hours">
            Run a command above — its job and each endpoint's result appear here.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Script</th>
                    <th scope="col">Shell</th>
                    <th scope="col">Groups</th>
                    <th scope="col">Created</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="app-vh">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedJobs.pageItems.map((job) => (
                    <tr
                      key={job.id}
                      className={`app-clickable ${job.id === selectedJobId ? "ep-sel" : ""}`}
                      onClick={() => setSelectedJobId(job.id)}
                    >
                      <td className="ep-mono" title={job.script}>
                        {job.script.slice(0, 60)}
                      </td>
                      <td className="ep-mono">{job.shell}</td>
                      <td>{job.targetGroupNames.join(", ") || <span className="app-muted">—</span>}</td>
                      <td>{formatDateTime(job.createdAt)}</td>
                      <td>
                        <TaskCounts counts={job.taskCounts} />
                      </td>
                      <td>
                        <div className="app-cell-actions">
                          <RowMenu
                            label="Actions for this job"
                            items={[{ label: "View results", icon: Eye, onSelect: () => setSelectedJobId(job.id) }]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pagedJobs.page}
              pageSize={pagedJobs.pageSize}
              total={pagedJobs.total}
              noun="jobs"
              onPageChange={pagedJobs.setPage}
              onPageSizeChange={pagedJobs.setPageSize}
            />
          </>
        )}
      </Card>

      {jobDetail && (
        <Card
          title="Job Detail"
          hint={formatDateTime(jobDetail.createdAt)}
          actions={
            <Button size="sm" icon={X} onClick={() => setSelectedJobId(undefined)}>
              Close
            </Button>
          }
        >
          <div className="app-stack">
            <pre className="app-pre">{jobDetail.script}</pre>
            {jobDetail.targetGroupNames.length > 0 && (
              <p className="app-text">Targeted groups: {jobDetail.targetGroupNames.join(", ")}</p>
            )}
            {jobDetail.tasks.length === 0 ? (
              <EmptyState icon={TerminalSquare} title="No endpoints in this job">
                This job has no per-endpoint tasks. Run the command again with different targets.
              </EmptyState>
            ) : (
              <div className="app-table-wrap">
                <table className="ep-tbl">
                  <thead>
                    <tr>
                      <th scope="col">Endpoint</th>
                      <th scope="col">Status</th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Exit code
                      </th>
                      <th scope="col">Output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobDetail.tasks.map((task) => (
                      <tr key={task.id}>
                        <td>
                          <EndpointLabel hostname={task.hostname} agentId={task.agentId} />
                        </td>
                        <td>
                          <TaskStatus status={task.status} />
                        </td>
                        <td className="ep-mono" style={{ textAlign: "right" }}>
                          {task.exitCode ?? <span className="app-muted">—</span>}
                        </td>
                        <td style={{ minWidth: 280 }}>
                          <div className="app-stack-sm">
                            {task.stdout && <pre className="app-pre">{task.stdout}</pre>}
                            {task.stderr && (
                              <>
                                <span className="app-subhead">Error Output</span>
                                <pre className="app-pre app-pre-error">
                                  {task.stderr}
                                </pre>
                              </>
                            )}
                            {!task.stdout && !task.stderr && <span className="app-muted">—</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}

      <ManageTemplatesPanel />
    </>
  );
}
