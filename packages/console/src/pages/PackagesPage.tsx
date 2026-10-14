import { useRef, useState, type FormEvent } from "react";
import { Eye, History, Package, Rocket, Trash2, Upload, X } from "lucide-react";
import type { InstallerType } from "@em/shared";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import {
  useAgents,
  useAssetGroups,
  useDeletePackage,
  useDeploymentJob,
  useDeploymentJobs,
  useDispatchDeployment,
  usePackages,
  useUploadPackage,
} from "../api/hooks";
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
  Modal,
  PageHeader,
  Pagination,
  Pill,
  RowMenu,
  Skeleton,
  Tag,
  TaskCounts,
  TaskStatus,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatBytes, formatDateTime, pluralize } from "../format";

// Deployment task status → Meridian badge/pill. In-flight states are a warn pill; finished
// states are a badge (success ok, failed critical). Unknown values stay neutral.
export default function PackagesPage() {
  const { data: packages, isLoading: packagesLoading, error: packagesError, refetch: refetchPackages } = usePackages();
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: jobs, isLoading: jobsLoading, error: jobsError, refetch: refetchJobs } = useDeploymentJobs();
  const upload = useUploadPackage();
  const deletePkg = useDeletePackage();
  const dispatchDeploy = useDispatchDeployment();
  const confirm = useConfirm();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [installerType, setInstallerType] = useState<InstallerType>("EXE");
  const [silentArgs, setSilentArgs] = useState("/S");

  const [selectedPackageId, setSelectedPackageId] = useState<string | undefined>();
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();

  const { data: jobDetail } = useDeploymentJob(selectedJobId);
  const pagedPackages = usePagedList(packages ?? []);
  const pagedJobs = usePagedList(jobs ?? []);
  const selectedPackage = packages?.find((p) => p.id === selectedPackageId);

  function handleUpload(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", name);
    formData.append("version", version);
    formData.append("installerType", installerType);
    formData.append("silentArgs", silentArgs);

    upload.mutate(formData, {
      onSuccess: () => {
        setName("");
        setVersion("");
        setSilentArgs("/S");
        if (fileInputRef.current) fileInputRef.current.value = "";
        setUploading(false);
      },
    });
  }

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  function handleDeploy(e: FormEvent) {
    e.preventDefault();
    if (!selectedPackageId) return;
    dispatchDeploy.mutate(
      { packageId: selectedPackageId, agentIds: selectedAgentIds, groupIds: selectedGroupIds },
      { onSuccess: (result) => setSelectedJobId(result.jobId) },
    );
  }

  async function handleDelete(id: string, label: string) {
    const confirmed = await confirm({
      title: `Delete package "${label}"?`,
      body: "It can no longer be deployed. This cannot be undone.",
      confirmLabel: "Delete package",
      tone: "danger",
    });
    if (!confirmed) return;
    deletePkg.mutate(id);
  }

  const targetCount = selectedAgentIds.length + selectedGroupIds.length;

  return (
    <>
      <PageHeader
        title="Packages"
        description="Upload installers once, then deploy them silently to endpoints and groups."
        actions={
          <Button variant="primary" icon={Upload} onClick={() => setUploading(true)}>
            Upload package
          </Button>
        }
      />

      <Card flush title="Packages" hint={packages ? `${packages.length} total · select one to deploy it` : undefined}>
        {packagesLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : packagesError ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load packages"
              action={
                <Button size="sm" onClick={() => refetchPackages()}>
                  Retry
                </Button>
              }
            >
              {(packagesError as Error).message}
            </Alert>
          </div>
        ) : !packages || packages.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No packages uploaded yet"
            action={
              <Button size="sm" icon={Upload} onClick={() => setUploading(true)}>
                Upload package
              </Button>
            }
          >
            Upload an installer, then select it here to deploy it to endpoints.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Version</th>
                    <th scope="col">Type</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Size
                    </th>
                    <th scope="col">
                      <span className="app-vh">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedPackages.pageItems.map((pkg) => (
                    <tr
                      key={pkg.id}
                      className={`app-clickable ${pkg.id === selectedPackageId ? "ep-sel" : ""}`}
                      onClick={() => setSelectedPackageId(pkg.id)}
                    >
                      <td>
                        <b>{pkg.name}</b>
                      </td>
                      <td className="ep-mono">{pkg.version}</td>
                      <td>
                        <Tag>{pkg.installerType}</Tag>
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {formatBytes(pkg.fileSizeBytes)}
                      </td>
                      <td>
                        <div className="app-cell-actions">
                          <RowMenu
                            label={`Actions for ${pkg.name}`}
                            items={[
                              { label: "Deploy package", icon: Rocket, onSelect: () => setSelectedPackageId(pkg.id) },
                              {
                                label: "Delete package",
                                icon: Trash2,
                                danger: true,
                                dividerBefore: true,
                                onSelect: () => handleDelete(pkg.id, `${pkg.name} v${pkg.version}`),
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
            <Pagination
              page={pagedPackages.page}
              pageSize={pagedPackages.pageSize}
              total={pagedPackages.total}
              noun="packages"
              onPageChange={pagedPackages.setPage}
              onPageSizeChange={pagedPackages.setPageSize}
            />
          </>
        )}
      </Card>

      {selectedPackageId && (
        <form className="ep-card" onSubmit={handleDeploy}>
          <FormSection
            title="Deploy selected package"
            description={
              selectedPackage ? (
                <>
                  {selectedPackage.name} <span className="ep-mono">v{selectedPackage.version}</span> — choose groups,
                  individual endpoints, or both.
                </>
              ) : (
                "Choose groups, individual endpoints, or both."
              )
            }
          >
            <div className="app-stack-sm">
              {groups && groups.length > 0 && (
                <>
                  <span className="app-subhead">Target groups</span>
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
              />
              {dispatchDeploy.isError && <Alert tone="critical">{(dispatchDeploy.error as Error).message}</Alert>}
            </div>
          </FormSection>
          <FormFooter>
            <span className="app-muted ep-num" style={{ marginRight: "auto", alignSelf: "center" }}>
              {targetCount === 0 ? "No targets selected" : `${pluralize(targetCount, "target")} selected`}
            </span>
            <Button onClick={() => setSelectedPackageId(undefined)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={dispatchDeploy.isPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}>
              {dispatchDeploy.isPending ? "Deploying…" : "Deploy"}
            </Button>
          </FormFooter>
        </form>
      )}

      <Card flush title="Deployment jobs" hint={jobs ? `${jobs.length} total` : undefined}>
        {jobsLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : jobsError ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load deployment jobs"
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
          <EmptyState icon={History} title="No deployments dispatched yet">
            Select a package above and deploy it — the job and each endpoint's result appear here.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Package</th>
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
                      <td>
                        <b>{job.packageName}</b> <span className="ep-mono">v{job.packageVersion}</span>
                      </td>
                      <td>{job.targetGroupNames.join(", ") || <span className="app-muted">—</span>}</td>
                      <td>{formatDateTime(job.createdAt)}</td>
                      <td>
                        <TaskCounts counts={job.taskCounts} />
                      </td>
                      <td>
                        <div className="app-cell-actions">
                          <RowMenu
                            label={`Actions for ${job.packageName} deployment`}
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
              noun="deployments"
              onPageChange={pagedJobs.setPage}
              onPageSizeChange={pagedJobs.setPageSize}
            />
          </>
        )}
      </Card>

      {jobDetail && (
        <Card
          title="Deployment detail"
          hint={
            <>
              {jobDetail.packageName} <span className="ep-mono">v{jobDetail.packageVersion}</span>
            </>
          }
          actions={
            <Button size="sm" icon={X} onClick={() => setSelectedJobId(undefined)}>
              Close
            </Button>
          }
        >
          <div className="app-stack">
            {jobDetail.targetGroupNames.length > 0 && (
              <p className="app-text">Targeted groups: {jobDetail.targetGroupNames.join(", ")}</p>
            )}
            {jobDetail.tasks.length === 0 ? (
              <EmptyState icon={Package} title="No endpoints in this deployment">
                This job has no per-endpoint tasks. Deploy the package again with different targets.
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
                      <th scope="col">Message</th>
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
                        <td>{task.message ?? <span className="app-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}

      {uploading && (
        <Modal
          title="Upload a package"
          description="The installer is stored on this server and can then be deployed silently to any endpoint."
          onClose={() => setUploading(false)}
          footer={
            <>
              <Button onClick={() => setUploading(false)}>Cancel</Button>
              <Button type="submit" form="upload-package-form" variant="primary" icon={Upload} disabled={upload.isPending}>
                {upload.isPending ? "Uploading…" : "Upload"}
              </Button>
            </>
          }
        >
          <form id="upload-package-form" className="app-stack" onSubmit={handleUpload}>
            <FormGrid>
              <Field label="Installer file" htmlFor="package-file" required span2>
                <input id="package-file" className="ep-input" ref={fileInputRef} type="file" required />
              </Field>
              <Field label="Name" htmlFor="package-name" required>
                <input id="package-name" className="ep-input" value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field label="Version" htmlFor="package-version" required>
                <input
                  id="package-version"
                  className="ep-input ep-mono"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  required
                />
              </Field>
              <Field label="Installer type" htmlFor="package-type">
                <select
                  id="package-type"
                  className="ep-select"
                  value={installerType}
                  onChange={(e) => setInstallerType(e.target.value as InstallerType)}
                >
                  <option value="EXE">EXE (Windows)</option>
                  <option value="MSI">MSI (Windows)</option>
                  <option value="DEB">DEB (Linux — dpkg)</option>
                  <option value="RPM">RPM (Linux — rpm/yum)</option>
                  <option value="SH">Shell script (Linux/macOS — self-installing .sh)</option>
                  <option value="PKG">PKG (macOS — installer)</option>
                </select>
              </Field>
              <Field label="Silent install args" htmlFor="package-silent-args">
                <input
                  id="package-silent-args"
                  className="ep-input ep-mono"
                  value={silentArgs}
                  onChange={(e) => setSilentArgs(e.target.value)}
                />
              </Field>
            </FormGrid>
            {upload.isError && <Alert tone="critical">{(upload.error as Error).message}</Alert>}
          </form>
        </Modal>
      )}
    </>
  );
}
