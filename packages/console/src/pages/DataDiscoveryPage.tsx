import { Fragment, useEffect, useState, type FormEvent } from "react";
import type { DataDiscoveryRegulation } from "@em/shared";
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import {
  useAgents,
  useAgentDataDiscoveryFindings,
  useAssetGroups,
  useAssignDataDiscoveryPolicy,
  useCreateDataDiscoveryPolicy,
  useDataDiscoveryAgentBreakdown,
  useDataDiscoveryAssignments,
  useDataDiscoveryPolicies,
  useDataDiscoveryPolicy,
  useDeleteDataDiscoveryPolicy,
  useRequestDataDiscoveryScanNow,
  useUnassignDataDiscoveryPolicy,
  useUpdateDataDiscoveryPolicy,
} from "../api/hooks";
import type { DataDiscoveryPolicyDetail } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import EndpointLabel from "../components/EndpointLabel";

const REGULATIONS: DataDiscoveryRegulation[] = ["DPDP", "GDPR", "BOTH"];

const REGULATION_LABEL: Record<DataDiscoveryRegulation, string> = {
  DPDP: "DPDP (India)",
  GDPR: "GDPR (EU)",
  BOTH: "DPDP + GDPR",
};

const DEFAULT_TARGET_PATHS = ["%USERPROFILE%\\Documents", "%USERPROFILE%\\Desktop", "%USERPROFILE%\\Downloads"];

function pathsToText(paths: string[]): string {
  return paths.join("\n");
}

function textToPaths(text: string): string[] {
  return text
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
}

function PolicySettingsPanel({ policy }: { policy: DataDiscoveryPolicyDetail }) {
  const updatePolicy = useUpdateDataDiscoveryPolicy();
  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description ?? "");
  const [regulation, setRegulation] = useState<DataDiscoveryRegulation>(policy.regulation);
  const [pathsText, setPathsText] = useState(pathsToText(policy.targetPaths));

  useEffect(() => {
    setName(policy.name);
    setDescription(policy.description ?? "");
    setRegulation(policy.regulation);
    setPathsText(pathsToText(policy.targetPaths));
  }, [policy.id, policy.name, policy.description, policy.regulation, policy.targetPaths]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    updatePolicy.mutate({
      id: policy.id,
      name,
      description: description.trim() || null,
      regulation,
      targetPaths: textToPaths(pathsText),
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
      <label>
        Regulation
        <select value={regulation} onChange={(e) => setRegulation(e.target.value as DataDiscoveryRegulation)}>
          {REGULATIONS.map((r) => (
            <option key={r} value={r}>
              {REGULATION_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Target paths (one per line — %ENV_VAR% placeholders are expanded on each endpoint)
        <textarea rows={4} className="mono-cell" value={pathsText} onChange={(e) => setPathsText(e.target.value)} required />
      </label>
      {updatePolicy.isError && <p className="error-text">{(updatePolicy.error as Error).message}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <button type="submit" disabled={updatePolicy.isPending || !name.trim() || textToPaths(pathsText).length === 0}>
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
  const { data: assignments } = useDataDiscoveryAssignments(policyId);
  const assign = useAssignDataDiscoveryPolicy();
  const unassign = useUnassignDataDiscoveryPolicy();

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

type ResultsFilter = "all" | "flagged" | "clean" | "nothing-scanned";

// Expanded drill-down shown under an endpoint row: the files where personal data was found on
// that endpoint, with the category of each match (Aadhaar, PAN, credit card, …), the match
// count, and masked previews. Scoped to this policy. Reuses the same per-agent findings API
// the endpoint detail page uses.
function AgentFindingsDetail({ agentId, policyId }: { agentId: string; policyId: string }) {
  const { data: findings } = useAgentDataDiscoveryFindings(agentId);
  if (!findings) return <p style={{ color: "var(--text-muted)" }}>Loading findings…</p>;
  const forPolicy = findings.filter((f) => f.policyId === policyId);
  if (forPolicy.length === 0) return <p style={{ color: "var(--text-muted)" }}>No file-level findings recorded for this endpoint yet.</p>;

  return (
    <table className="data-table" style={{ margin: "0.25rem 0" }}>
      <thead>
        <tr>
          <th>File path</th>
          <th>Category of data found</th>
          <th>Last seen</th>
        </tr>
      </thead>
      <tbody>
        {forPolicy.map((f) => (
          <tr key={f.id}>
            <td className="mono-cell">{f.filePath}</td>
            <td>
              {f.matches.map((m) => (
                <div key={m.label} style={{ marginBottom: "0.4rem" }}>
                  <span className="status-badge danger">
                    {m.label} ({m.count})
                  </span>
                  {m.samples.length > 0 && (
                    <div className="mono-cell" style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                      {m.samples.join(", ")}
                      {m.count > m.samples.length ? ` (+${m.count - m.samples.length} more)` : ""}
                    </div>
                  )}
                </div>
              ))}
            </td>
            <td>{new Date(f.lastSeenAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResultsPanel({ policyId }: { policyId: string }) {
  const { data: breakdown } = useDataDiscoveryAgentBreakdown(policyId);
  const scanNow = useRequestDataDiscoveryScanNow();
  const [filter, setFilter] = useState<ResultsFilter>("all");
  // Which endpoint's file-level findings are expanded, if any.
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  const agents = breakdown?.agents ?? [];
  // A scan that read zero files proves nothing — it isn't "clean", it means none of the
  // target folders existed on that endpoint (or none held a supported file type).
  const readNothing = (a: (typeof agents)[number]) => a.scanned && a.filesScanned === 0;
  const flaggedCount = agents.filter((a) => a.fileCount > 0).length;
  const cleanCount = agents.filter((a) => a.scanned && a.fileCount === 0 && !readNothing(a)).length;
  const nothingScannedCount = agents.filter(readNothing).length;
  const filtered = agents.filter((a) => {
    if (filter === "flagged") return a.fileCount > 0;
    if (filter === "clean") return a.scanned && a.fileCount === 0 && !readNothing(a);
    if (filter === "nothing-scanned") return readNothing(a);
    return true;
  });

  return (
    <div className="panel">
      <h2>Discovery results</h2>
      <p>
        <button
          type="button"
          onClick={() => scanNow.mutate({ policyId })}
          disabled={scanNow.isPending || agents.length === 0}
        >
          {scanNow.isPending ? "Requesting…" : "Scan all assigned now"}
        </button>{" "}
        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          Reaches each endpoint on its next check-in (usually within ~30s) rather than waiting for the normal scan
          interval.
        </span>
        {scanNow.isSuccess && (
          <span style={{ marginLeft: "0.5rem", color: "var(--online)" }}>
            Requested for {scanNow.data.requestedCount} endpoint(s).
          </span>
        )}
        {scanNow.isError && <span className="error-text"> {(scanNow.error as Error).message}</span>}
      </p>

      <div className="tiles">
        <div className={`tile ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          <div className="tile-label">Total devices</div>
          <div className="tile-value">{agents.length}</div>
        </div>
        <div className={`tile accent-critical ${filter === "flagged" ? "active" : ""}`} onClick={() => setFilter("flagged")}>
          <div className="tile-label">Files with personal data</div>
          <div className="tile-value">{flaggedCount}</div>
        </div>
        <div className={`tile accent-good ${filter === "clean" ? "active" : ""}`} onClick={() => setFilter("clean")}>
          <div className="tile-label">Clean (scanned, none found)</div>
          <div className="tile-value">{cleanCount}</div>
        </div>
        <div
          className={`tile accent-warn ${filter === "nothing-scanned" ? "active" : ""}`}
          onClick={() => setFilter("nothing-scanned")}
          title="The last scan read 0 files — the target folders don't exist on these endpoints, or hold no supported files"
        >
          <div className="tile-label">Nothing scanned (0 files read)</div>
          <div className="tile-value">{nothingScannedCount}</div>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Scanned</th>
            <th>Files read</th>
            <th>Files with personal data</th>
            <th>Last scan</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => {
            const canExpand = a.fileCount > 0;
            const isExpanded = expandedAgentId === a.agentId;
            return (
              <Fragment key={a.agentId}>
                <tr
                  className={canExpand ? "clickable-row" : undefined}
                  onClick={canExpand ? () => setExpandedAgentId(isExpanded ? null : a.agentId) : undefined}
                  title={canExpand ? "Click to show the files and the type of data found" : undefined}
                >
                  <td>
                    {canExpand && <span style={{ marginRight: "0.4rem", color: "var(--text-muted)" }}>{isExpanded ? "▾" : "▸"}</span>}
                    <EndpointLabel hostname={a.hostname} agentId={a.agentId} />
                  </td>
                  <td>{a.scanned ? "Yes" : "Pending first scan"}</td>
                  <td>{a.filesScanned ?? "—"}</td>
                  <td>
                    {a.fileCount > 0 ? (
                      <StatusBadge kind="fail" label={`${a.fileCount} file${a.fileCount === 1 ? "" : "s"}`} />
                    ) : readNothing(a) ? (
                      <StatusBadge kind="warn" label="Nothing scanned — check target paths" />
                    ) : a.scanned ? (
                      <StatusBadge kind="pass" label="None found" />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{a.lastScanAt ? new Date(a.lastScanAt).toLocaleString() : "—"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {a.scanPending ? (
                      <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Scan requested…</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => scanNow.mutate({ policyId, agentId: a.agentId })}
                        disabled={scanNow.isPending}
                      >
                        Scan now
                      </button>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={6} style={{ background: "var(--stripe)" }}>
                      <AgentFindingsDetail agentId={a.agentId} policyId={policyId} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6}>{agents.length === 0 ? "Not assigned to any endpoint yet." : "No devices match this filter."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function DataDiscoveryPage() {
  const { data: policies } = useDataDiscoveryPolicies();
  const createPolicy = useCreateDataDiscoveryPolicy();
  const updatePolicy = useUpdateDataDiscoveryPolicy();
  const deletePolicy = useDeleteDataDiscoveryPolicy();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [regulation, setRegulation] = useState<DataDiscoveryRegulation>("DPDP");
  const [pathsText, setPathsText] = useState(pathsToText(DEFAULT_TARGET_PATHS));

  const { data: policy } = useDataDiscoveryPolicy(selectedId);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createPolicy.mutate(
      { name, description: description.trim() || null, regulation, targetPaths: textToPaths(pathsText) },
      {
        onSuccess: (result) => {
          setSelectedId(result.id);
          setName("");
          setDescription("");
          setPathsText(pathsToText(DEFAULT_TARGET_PATHS));
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
      <h1>Data Discovery</h1>
      <p>
        Find where personal data lives across your endpoints — each policy scans a set of folders on assigned
        endpoints for patterns relevant to DPDP (India's Digital Personal Data Protection Act) and/or GDPR (Aadhaar,
        PAN, email, phone numbers, card numbers, IP addresses, and more). Findings report the file path, match
        counts, and a handful of <em>masked</em> previews per pattern (e.g. "••••••••6789") — enough to confirm a
        real match, but the unmasked value never leaves the endpoint.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "3rem" }}>Enabled</th>
            <th>Name</th>
            <th>Regulation</th>
            <th>Target paths</th>
            <th>Assigned endpoints</th>
            <th>Files with personal data</th>
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
              <td>{REGULATION_LABEL[p.regulation]}</td>
              <td className="mono-cell">{p.targetPaths.join(", ")}</td>
              <td>{p.assignedAgentCount}</td>
              <td>{p.filesWithFindingsCount}</td>
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
              <td colSpan={7}>No policies yet.</td>
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
        <label>
          Regulation
          <select value={regulation} onChange={(e) => setRegulation(e.target.value as DataDiscoveryRegulation)}>
            {REGULATIONS.map((r) => (
              <option key={r} value={r}>
                {REGULATION_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target paths (one per line — %ENV_VAR% placeholders are expanded on each endpoint)
          <textarea rows={4} className="mono-cell" value={pathsText} onChange={(e) => setPathsText(e.target.value)} required />
        </label>
        {createPolicy.isError && <p className="error-text">{(createPolicy.error as Error).message}</p>}
        <button type="submit" disabled={createPolicy.isPending || !name.trim() || textToPaths(pathsText).length === 0}>
          {createPolicy.isPending ? "Creating…" : "Create policy"}
        </button>
      </form>

      {policy && (
        <>
          <PolicySettingsPanel policy={policy} />
          <AssignmentPanel policyId={policy.id} />
          <ResultsPanel policyId={policy.id} />
        </>
      )}
    </div>
  );
}
