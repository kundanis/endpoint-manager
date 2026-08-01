import { useState, type FormEvent } from "react";
import { useAssetGroups, useCreateEnrollmentToken, useEnrollmentTokens, useRevokeEnrollmentToken } from "../api/hooks";

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildSetupScript(serverUrl: string, token: string): string {
  // Calls the already-downloaded EndpointProAgentSetup.exe with the server URL and
  // enrollment token pre-filled, so double-clicking this file needs no typing at all.
  // SetupStub.cs (packages/agent/scripts/templates) already accepts these as two
  // positional args and self-elevates via UAC - this script only supplies them.
  return [
    "@echo off",
    "echo Installing the Endpoint Pro agent...",
    `"%~dp0EndpointProAgentSetup.exe" "${serverUrl}" "${token}"`,
    "",
  ].join("\r\n");
}

export default function EnrollmentTokensPage() {
  const { data: tokens } = useEnrollmentTokens();
  const { data: groups } = useAssetGroups();
  const createToken = useCreateEnrollmentToken();
  const revokeToken = useRevokeEnrollmentToken();

  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [usesRemaining, setUsesRemaining] = useState(1);
  const [groupId, setGroupId] = useState("");
  const [justCreated, setJustCreated] = useState<{ label: string; token: string; groupName: string | null } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => window.location.origin);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createToken.mutate(
      { label, expiresInDays, usesRemaining, groupId: groupId || undefined },
      {
        onSuccess: (result) => {
          const group = groups?.find((g) => g.id === groupId);
          setJustCreated({ label, token: result.token, groupName: group?.name ?? null });
          setCopied(false);
          setLabel("");
          setExpiresInDays(7);
          setUsesRemaining(1);
          setGroupId("");
        },
      },
    );
  }

  function handleCopy(token: string) {
    navigator.clipboard.writeText(token).then(() => setCopied(true));
  }

  function handleDownloadScript() {
    if (!justCreated) return;
    const safeName = justCreated.label.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "agent";
    downloadTextFile(`Setup-${safeName}.bat`, buildSetupScript(serverUrl, justCreated.token));
  }

  return (
    <div>
      <h1>Enrollment tokens</h1>
      <p>
        A new agent needs one of these tokens to enroll. The quickest path: download the agent installer once below,
        then for each token, download its matching setup script and run both together on the target machine — no
        typing required. You can also set the token manually as <code>UEM_ENROLLMENT_TOKEN</code> (env var) or the{" "}
        <code>enrollmentToken</code> field in the agent's <code>config.json</code> if you prefer. Once enrolled, the
        agent persists its own identity and never needs the token again.
      </p>

      <div className="panel">
        <h2>1. Download the agent installer</h2>
        <p>
          A single self-elevating installer (<code>EndpointProAgentSetup.exe</code>) — download it once and reuse it
          for every endpoint. Double-clicking it alone prompts for a server URL and token; paired with a setup script
          below, it needs neither.
        </p>
        <a className="button-like" href="/api/admin/agent-installer" download>
          Download agent installer
        </a>
      </div>

      {justCreated && (
        <div className="panel">
          <h2>2. Token created for "{justCreated.label}"</h2>
          <p className="error-text">
            This is the only time the token value is shown — copy it now, or download the setup script below.
            Revoking or losing it means creating a new one.
          </p>
          <p className="mono-cell">{justCreated.token}</p>
          <button type="button" onClick={() => handleCopy(justCreated.token)}>
            {copied ? "Copied" : "Copy to clipboard"}
          </button>
          {justCreated.groupName && (
            <p>
              Endpoints enrolled with this token will automatically join the <strong>{justCreated.groupName}</strong>{" "}
              group.
            </p>
          )}
          <label>
            Server URL agents should connect to
            <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} required />
          </label>
          <button type="button" onClick={handleDownloadScript} disabled={!serverUrl.trim()}>
            Download setup script
          </button>
          <p>
            Place the setup script in the same folder as the downloaded installer on the target machine, then
            double-click the script — it installs and enrolls the agent with no further input.
          </p>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Group</th>
            <th>Uses remaining</th>
            <th>Expires</th>
            <th>Status</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tokens?.map((t) => {
            const isExpired = new Date(t.expiresAt) < new Date();
            const isDead = t.revoked || isExpired || t.usesRemaining <= 0;
            return (
              <tr key={t.id}>
                <td>{t.label}</td>
                <td>{t.groupName ?? "—"}</td>
                <td>{t.usesRemaining}</td>
                <td>{new Date(t.expiresAt).toLocaleString()}</td>
                <td>
                  <span className={`status-badge ${isDead ? "danger" : "online"}`}>
                    {t.revoked ? "Revoked" : isExpired ? "Expired" : t.usesRemaining <= 0 ? "Exhausted" : "Active"}
                  </span>
                </td>
                <td>{new Date(t.createdAt).toLocaleString()}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => revokeToken.mutate(t.id)}
                    disabled={t.revoked || revokeToken.isPending}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            );
          })}
          {tokens?.length === 0 && (
            <tr>
              <td colSpan={7}>No enrollment tokens created yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="panel" onSubmit={handleCreate}>
        <h2>New token</h2>
        <label>
          Label
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Finance laptops batch 1"
            required
          />
        </label>
        <label>
          Expires in (days)
          <input
            type="number"
            min={1}
            max={365}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(Number(e.target.value))}
          />
        </label>
        <label>
          Uses remaining (how many agents can enroll with it)
          <input
            type="number"
            min={1}
            max={10000}
            value={usesRemaining}
            onChange={(e) => setUsesRemaining(Number(e.target.value))}
          />
        </label>
        <label>
          Target group (optional)
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">No group</option>
            {groups?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {groupId && (
          <p>Every endpoint that enrolls with this token will automatically be added to this group.</p>
        )}
        {createToken.isError && <p className="error-text">{(createToken.error as Error).message}</p>}
        <button type="submit" disabled={createToken.isPending || !label.trim()}>
          {createToken.isPending ? "Creating…" : "Create token"}
        </button>
      </form>
    </div>
  );
}
