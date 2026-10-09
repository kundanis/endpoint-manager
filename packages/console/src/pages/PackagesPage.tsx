import { useRef, useState, type FormEvent } from "react";
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

export default function PackagesPage() {
  const { data: packages } = usePackages();
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: jobs } = useDeploymentJobs();
  const upload = useUploadPackage();
  const deletePkg = useDeletePackage();
  const dispatchDeploy = useDispatchDeployment();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [installerType, setInstallerType] = useState<InstallerType>("EXE");
  const [silentArgs, setSilentArgs] = useState("/S");

  const [selectedPackageId, setSelectedPackageId] = useState<string | undefined>();
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();

  const { data: jobDetail } = useDeploymentJob(selectedJobId);

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

  return (
    <div>
      <h1>Packages</h1>

      <form className="panel" onSubmit={handleUpload}>
        <h2>Upload a package</h2>
        <label>
          Installer file
          <input ref={fileInputRef} type="file" required />
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Version
          <input value={version} onChange={(e) => setVersion(e.target.value)} required />
        </label>
        <label>
          Installer type
          <select value={installerType} onChange={(e) => setInstallerType(e.target.value as InstallerType)}>
            <option value="EXE">EXE (Windows)</option>
            <option value="MSI">MSI (Windows)</option>
            <option value="DEB">DEB (Linux — dpkg)</option>
            <option value="RPM">RPM (Linux — rpm/yum)</option>
            <option value="SH">Shell script (Linux — self-installing .sh)</option>
          </select>
        </label>
        <label>
          Silent install args
          <input value={silentArgs} onChange={(e) => setSilentArgs(e.target.value)} />
        </label>
        {upload.isError && <p className="error-text">{(upload.error as Error).message}</p>}
        <button type="submit" disabled={upload.isPending}>
          {upload.isPending ? "Uploading…" : "Upload"}
        </button>
      </form>

      <h2>Packages</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Version</th>
            <th>Type</th>
            <th>Size</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {packages?.map((pkg) => (
            <tr
              key={pkg.id}
              className={`clickable-row ${pkg.id === selectedPackageId ? "selected-row" : ""}`}
              onClick={() => setSelectedPackageId(pkg.id)}
            >
              <td>{pkg.name}</td>
              <td>{pkg.version}</td>
              <td>{pkg.installerType}</td>
              <td>{(pkg.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB</td>
              <td>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePkg.mutate(pkg.id);
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {packages?.length === 0 && (
            <tr>
              <td colSpan={5}>No packages uploaded yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {selectedPackageId && (
        <form className="panel" onSubmit={handleDeploy}>
          <h2>Deploy selected package</h2>
          {groups && groups.length > 0 && (
            <fieldset>
              <legend>Target groups</legend>
              {groups.map((g) => (
                <label key={g.id} className="checkbox-row">
                  <input type="checkbox" checked={selectedGroupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                  {g.name} ({g.memberCount})
                </label>
              ))}
            </fieldset>
          )}
          <EndpointCheckboxList
            agents={agents}
            selectedAgentIds={selectedAgentIds}
            onToggle={toggleAgent}
            selectedGroupIds={selectedGroupIds}
            legend="Target endpoints"
          />
          {dispatchDeploy.isError && <p className="error-text">{(dispatchDeploy.error as Error).message}</p>}
          <button
            type="submit"
            disabled={dispatchDeploy.isPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
          >
            {dispatchDeploy.isPending ? "Deploying…" : "Deploy"}
          </button>
        </form>
      )}

      <h2>Deployment jobs</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Groups</th>
            <th>Created</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs?.map((job) => (
            <tr key={job.id} className="clickable-row" onClick={() => setSelectedJobId(job.id)}>
              <td>
                {job.packageName} v{job.packageVersion}
              </td>
              <td>{job.targetGroupNames.join(", ") || "—"}</td>
              <td>{new Date(job.createdAt).toLocaleString()}</td>
              <td>
                {Object.entries(job.taskCounts)
                  .map(([status, count]) => `${status}: ${count}`)
                  .join(", ")}
              </td>
            </tr>
          ))}
          {jobs?.length === 0 && (
            <tr>
              <td colSpan={4}>No deployments dispatched yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {jobDetail && (
        <div className="panel">
          <h2>
            Deployment detail — {jobDetail.packageName} v{jobDetail.packageVersion}
          </h2>
          {jobDetail.targetGroupNames.length > 0 && <p>Targeted groups: {jobDetail.targetGroupNames.join(", ")}</p>}
          <table className="data-table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Exit code</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {jobDetail.tasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <EndpointLabel hostname={task.hostname} agentId={task.agentId} />
                  </td>
                  <td>{task.status}</td>
                  <td>{task.exitCode ?? "—"}</td>
                  <td>{task.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
