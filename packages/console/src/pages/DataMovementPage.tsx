import { useEffect, useState, type FormEvent } from "react";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import {
  useAgents,
  useAssetGroups,
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
import StatusBadge from "../components/StatusBadge";
import EndpointLabel from "../components/EndpointLabel";

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
    <fieldset>
      <legend>Channels to monitor</legend>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={monitorUsb}
          onChange={(e) => onChange({ monitorUsb: e.target.checked, monitorCloudSync, monitorNetworkShare })}
        />
        USB / removable media
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={monitorCloudSync}
          onChange={(e) => onChange({ monitorUsb, monitorCloudSync: e.target.checked, monitorNetworkShare })}
        />
        Cloud sync folders (OneDrive, Dropbox, Google Drive)
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={monitorNetworkShare}
          onChange={(e) => onChange({ monitorUsb, monitorCloudSync, monitorNetworkShare: e.target.checked })}
        />
        Mapped network drives
      </label>
    </fieldset>
  );
}

function PolicySettingsPanel({ policy }: { policy: DataMovementPolicyDetail }) {
  const updatePolicy = useUpdateDataMovementPolicy();
  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description ?? "");
  const [monitorUsb, setMonitorUsb] = useState(policy.monitorUsb);
  const [monitorCloudSync, setMonitorCloudSync] = useState(policy.monitorCloudSync);
  const [monitorNetworkShare, setMonitorNetworkShare] = useState(policy.monitorNetworkShare);
  const [pathsText, setPathsText] = useState(pathsToText(policy.extraCloudSyncPaths));

  useEffect(() => {
    setName(policy.name);
    setDescription(policy.description ?? "");
    setMonitorUsb(policy.monitorUsb);
    setMonitorCloudSync(policy.monitorCloudSync);
    setMonitorNetworkShare(policy.monitorNetworkShare);
    setPathsText(pathsToText(policy.extraCloudSyncPaths));
  }, [policy.id, policy.name, policy.description, policy.monitorUsb, policy.monitorCloudSync, policy.monitorNetworkShare, policy.extraCloudSyncPaths]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    updatePolicy.mutate({
      id: policy.id,
      name,
      description: description.trim() || null,
      monitorUsb,
      monitorCloudSync,
      monitorNetworkShare,
      extraCloudSyncPaths: textToPaths(pathsText),
    });
  }

  return (
    <form className="card accent-blue" onSubmit={handleSave}>
      <h2>Policy settings</h2>
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Description
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
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
      <label>
        Extra cloud-sync paths (one per line, optional — %ENV_VAR% expanded on each endpoint; OneDrive/Dropbox/Google
        Drive are already covered automatically)
        <textarea rows={3} className="mono-cell" value={pathsText} onChange={(e) => setPathsText(e.target.value)} />
      </label>
      {updatePolicy.isError && <p className="error-text">{(updatePolicy.error as Error).message}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <button type="submit" disabled={updatePolicy.isPending || !name.trim()}>
          {updatePolicy.isPending ? "Saving…" : "Save policy"}
        </button>
        {updatePolicy.isSuccess && <span style={{ color: "var(--online)", fontSize: "0.85rem" }}>Saved</span>}
      </div>
    </form>
  );
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const { data: assignments } = useDataMovementAssignments(policyId);
  const assign = useAssignDataMovementPolicy();
  const unassign = useUnassignDataMovementPolicy();

  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  function handleAssign() {
    assign.mutate(
      { policyId, agentIds: selectedAgentIds, groupIds: selectedGroupIds },
      { onSuccess: () => { setSelectedAgentIds([]); setSelectedGroupIds([]); } },
    );
  }

  return (
    <div className="panel">
      <h2>Assignment</h2>

      <h3>Currently assigned</h3>
      <ul>
        {assignments?.map((a) => (
          <li key={a.id}>
            {a.hostname ? <EndpointLabel hostname={a.hostname} agentId={a.agentId} /> : `Group: ${a.groupName}`}{" "}
            <button type="button" onClick={() => unassign.mutate({ policyId, assignmentId: a.id })} disabled={unassign.isPending}>
              Remove
            </button>
          </li>
        ))}
        {assignments?.length === 0 && <li>Not assigned to any endpoint or group yet.</li>}
      </ul>

      <h3>Assign to</h3>
      {groups && groups.length > 0 && (
        <fieldset>
          <legend>Groups</legend>
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
      />

      {assign.isError && <p className="error-text">{(assign.error as Error).message}</p>}
      <button
        type="button"
        onClick={handleAssign}
        disabled={assign.isPending || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
      >
        {assign.isPending ? "Assigning…" : "Assign"}
      </button>
    </div>
  );
}

type ActivityFilter = "all" | "usb" | "cloud" | "network";

function ActivityPanel({ policyId }: { policyId: string }) {
  const { data: breakdown } = useDataMovementAgentBreakdown(policyId);
  const [filter, setFilter] = useState<ActivityFilter>("all");

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

  return (
    <div className="panel">
      <h2>Activity</h2>

      <div className="tiles">
        <div className={`tile ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          <div className="tile-label">Total devices</div>
          <div className="tile-value">{agents.length}</div>
        </div>
        <div className={`tile accent-critical ${filter === "usb" ? "active" : ""}`} onClick={() => setFilter("usb")}>
          <div className="tile-label">USB copies</div>
          <div className="tile-value">{usbTotal}</div>
        </div>
        <div className={`tile ${filter === "cloud" ? "active" : ""}`} onClick={() => setFilter("cloud")}>
          <div className="tile-label">Cloud sync</div>
          <div className="tile-value">{cloudTotal}</div>
        </div>
        <div className={`tile ${filter === "network" ? "active" : ""}`} onClick={() => setFilter("network")}>
          <div className="tile-label">Network share</div>
          <div className="tile-value">{networkTotal}</div>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>USB</th>
            <th>Cloud sync</th>
            <th>Network share</th>
            <th>Last event</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <tr key={a.agentId}>
              <td>
                <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
              </td>
              <td>{a.usbCount > 0 ? <StatusBadge kind="warn" label={String(a.usbCount)} /> : "—"}</td>
              <td>{a.cloudSyncCount > 0 ? <StatusBadge kind="warn" label={String(a.cloudSyncCount)} /> : "—"}</td>
              <td>{a.networkShareCount > 0 ? <StatusBadge kind="warn" label={String(a.networkShareCount)} /> : "—"}</td>
              <td>{a.lastEventAt ? new Date(a.lastEventAt).toLocaleString() : "—"}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={5}>{agents.length === 0 ? "Not assigned to any endpoint yet." : "No devices match this filter."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function DataMovementPage() {
  const { data: policies } = useDataMovementPolicies();
  const createPolicy = useCreateDataMovementPolicy();
  const updatePolicy = useUpdateDataMovementPolicy();
  const deletePolicy = useDeleteDataMovementPolicy();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [monitorUsb, setMonitorUsb] = useState(true);
  const [monitorCloudSync, setMonitorCloudSync] = useState(true);
  const [monitorNetworkShare, setMonitorNetworkShare] = useState(true);
  const [pathsText, setPathsText] = useState("");

  const { data: policy } = useDataMovementPolicy(selectedId);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createPolicy.mutate(
      {
        name,
        description: description.trim() || null,
        monitorUsb,
        monitorCloudSync,
        monitorNetworkShare,
        extraCloudSyncPaths: textToPaths(pathsText),
      },
      {
        onSuccess: (result) => {
          setSelectedId(result.id);
          setName("");
          setDescription("");
          setPathsText("");
        },
      },
    );
  }

  function toggleEnabled(id: string, enabled: boolean) {
    updatePolicy.mutate({ id, enabled });
  }

  function handleDelete(id: string) {
    deletePolicy.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(undefined);
      },
    });
  }

  return (
    <div>
      <h1>Data Movement</h1>
      <p>
        Track where data is leaving an endpoint through — files recently copied to a USB/removable drive, written
        into a cloud-sync folder (OneDrive, Dropbox, Google Drive), or copied onto a mapped network drive. This is a
        lightweight, agent-side heuristic (recently-modified files in monitored locations on a periodic scan), not a
        real-time kernel-level interception — it can miss a very fast copy-then-move, or occasionally flag a file
        that was just edited in place rather than copied.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "3rem" }}>Enabled</th>
            <th>Name</th>
            <th>Channels</th>
            <th>Assigned endpoints</th>
            <th>Events</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {policies?.map((p) => (
            <tr key={p.id} className="clickable-row" onClick={() => setSelectedId(p.id)}>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => toggleEnabled(p.id, e.target.checked)}
                  title="Enabled — paused policies are skipped entirely and don't scan any device"
                />
              </td>
              <td>{p.name}</td>
              <td>
                {[p.monitorUsb && "USB", p.monitorCloudSync && "Cloud sync", p.monitorNetworkShare && "Network share"]
                  .filter(Boolean)
                  .join(", ") || "None"}
              </td>
              <td>{p.assignedAgentCount}</td>
              <td>{p.eventCount}</td>
              <td>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(p.id);
                  }}
                  disabled={deletePolicy.isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {policies?.length === 0 && (
            <tr>
              <td colSpan={6}>No policies yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="panel" onSubmit={handleCreate}>
        <h2>New policy</h2>
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Description
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
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
        <label>
          Extra cloud-sync paths (one per line, optional — %ENV_VAR% expanded on each endpoint)
          <textarea rows={3} className="mono-cell" value={pathsText} onChange={(e) => setPathsText(e.target.value)} />
        </label>
        {createPolicy.isError && <p className="error-text">{(createPolicy.error as Error).message}</p>}
        <button type="submit" disabled={createPolicy.isPending || !name.trim()}>
          {createPolicy.isPending ? "Creating…" : "Create policy"}
        </button>
      </form>

      {policy && (
        <>
          <PolicySettingsPanel policy={policy} />
          <AssignmentPanel policyId={policy.id} />
          <ActivityPanel policyId={policy.id} />
        </>
      )}
    </div>
  );
}
