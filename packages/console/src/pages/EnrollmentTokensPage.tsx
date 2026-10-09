import { useEffect, useState, type FormEvent } from "react";
import {
  useAgentConnectionSettings,
  useAssetGroups,
  useCreateEnrollmentToken,
  useDownloadAgentSetup,
  useEnrollmentTokens,
  useRemoteInstallJob,
  useRevokeEnrollmentToken,
  useSaveAgentConnectionSettings,
  useStartRemoteInstall,
} from "../api/hooks";
import RemoteInstallStatusTable from "../components/RemoteInstallStatusTable";

type Protocol = "http" | "https";
interface AddressParts {
  protocol: Protocol;
  host: string;
  port: string;
}

function splitUrl(url: string | null | undefined, defaultProtocol: Protocol): AddressParts {
  if (!url) return { protocol: defaultProtocol, host: "", port: "" };
  try {
    const u = new URL(url);
    return { protocol: u.protocol === "https:" ? "https" : "http", host: u.hostname, port: u.port };
  } catch {
    return { protocol: defaultProtocol, host: "", port: "" };
  }
}

function joinUrl(parts: AddressParts): string {
  const host = parts.host.trim();
  if (!host) return "";
  const port = parts.port.trim();
  return `${parts.protocol}://${host}${port ? `:${port}` : ""}`;
}

function AddressFields({ label, value, onChange }: { label: string; value: AddressParts; onChange: (v: AddressParts) => void }) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <label style={{ display: "inline-block" }}>
          Protocol
          <select value={value.protocol} onChange={(e) => onChange({ ...value, protocol: e.target.value as Protocol })}>
            <option value="http">http</option>
            <option value="https">https</option>
          </select>
        </label>
        <label style={{ display: "inline-block", flex: "1 1 12rem" }}>
          IP address
          <input type="text" value={value.host} onChange={(e) => onChange({ ...value, host: e.target.value })} />
        </label>
        <label style={{ display: "inline-block", width: "7rem" }}>
          Port
          <input
            type="number"
            min={1}
            max={65535}
            value={value.port}
            onChange={(e) => onChange({ ...value, port: e.target.value })}
          />
        </label>
      </div>
    </fieldset>
  );
}

// Where agents reach this server. Every address here is baked into each token's setup exe and
// pushed to already-enrolled agents on their next check-in; agents try them in the order
// shown (LAN, web URL, public IP) and stay on the first one that answers.
function ServerConnectionPanel() {
  const { data: settings } = useAgentConnectionSettings();
  const save = useSaveAgentConnectionSettings();
  const [local, setLocal] = useState<AddressParts>(() => splitUrl(null, "http"));
  const [publicAddr, setPublicAddr] = useState<AddressParts>(() => splitUrl(null, "https"));
  const [webUrl, setWebUrl] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!settings || loaded) return;
    setLocal(splitUrl(settings.localUrl ?? settings.detectedLocalUrl, "http"));
    setPublicAddr(splitUrl(settings.publicUrl, "https"));
    setWebUrl(settings.webUrl ?? "");
    setLoaded(true);
  }, [settings, loaded]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ localUrl: joinUrl(local), webUrl: webUrl.trim(), publicUrl: joinUrl(publicAddr) });
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>Server connection details</h2>
      <p>
        Agents get every address below automatically — in each token's setup file and, for agents already installed, on
        their next check-in. An endpoint in the office connects over the local address; one outside (WAN) falls back to
        the web URL, then the public IP. Nobody has to type a server address during setup.
      </p>
      {settings && !settings.configured && (
        <p className="error-text">
          Not saved yet — until you save, agents only get the auto-detected local address and can't connect from
          outside the office.
        </p>
      )}
      <AddressFields label="1. Local (LAN) address of this server" value={local} onChange={setLocal} />
      <label>
        2. Web URL (e.g. https://endpoint.example.com — its HTTPS certificate must match this name)
        <input type="text" value={webUrl} onChange={(e) => setWebUrl(e.target.value)} placeholder="https://…" />
      </label>
      <AddressFields label="3. Public IP and port (NAT on your firewall)" value={publicAddr} onChange={setPublicAddr} />
      {publicAddr.host.trim() && publicAddr.protocol === "http" && (
        <p className="error-text">
          Plain http over the public IP sends agent traffic, including each agent's key, across the internet
          unencrypted. Prefer the https web URL; keep this as a last-resort fallback only.
        </p>
      )}
      {save.isError && <p className="error-text">{(save.error as Error).message}</p>}
      {save.isSuccess && <p>Saved. Enrolled agents pick up the new addresses on their next check-in.</p>}
      <button type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save connection details"}
      </button>
    </form>
  );
}

// "Install on endpoint" - pushes the already-built agent installer out to one or more
// not-yet-enrolled Windows machines over PowerShell Remoting (WinRM), instead of an admin
// manually copying it and double-clicking on each one. Only usable right after creating a
// token, in the same browser session - the plaintext token value is never available again
// after this (see the panel above), same restriction the "Download setup script" option
// already has.
function RemoteInstallPanel({ tokenId, token, serverUrl }: { tokenId: string; token: string; serverUrl: string }) {
  const startInstall = useStartRemoteInstall();
  const [targetsText, setTargetsText] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const { data: job } = useRemoteInstallJob(jobId);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const targets = targetsText
      .split(/[\n,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (targets.length === 0) return;
    startInstall.mutate(
      { tokenId, enrollmentToken: token, serverUrl, targets, username, password },
      { onSuccess: (result) => setJobId(result.jobId) },
    );
  }

  return (
    <div className="panel">
      <h3>Install on endpoint (optional)</h3>
      <p>
        Have this server reach out over PowerShell Remoting (WinRM) and install the agent directly on one or more
        machines already on the network — no need to copy anything or touch the target machine yourself. Requires
        WinRM enabled on the targets and an admin credential valid on all of them.
      </p>
      <form onSubmit={handleSubmit}>
        <label>
          Target hostnames or IPs (one per line, or comma-separated)
          <textarea
            rows={4}
            value={targetsText}
            onChange={(e) => setTargetsText(e.target.value)}
            placeholder={"SSSIL-DSK-68\n10.10.6.79"}
            required
          />
        </label>
        <label>
          Admin username (e.g. DOMAIN\admin or .\localadmin)
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <p className="error-text">
          This credential is used once to reach the target machine(s) and is never stored — it isn't saved anywhere
          on this server.
        </p>
        {startInstall.isError && <p className="error-text">{(startInstall.error as Error).message}</p>}
        <button type="submit" disabled={startInstall.isPending || !targetsText.trim() || !username.trim() || !password}>
          {startInstall.isPending ? "Starting…" : "Install on endpoint(s)"}
        </button>
      </form>

      {job && <RemoteInstallStatusTable tasks={job.tasks} />}
    </div>
  );
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
  const [justCreated, setJustCreated] = useState<{
    id: string;
    label: string;
    token: string;
    groupName: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const downloadSetup = useDownloadAgentSetup();

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createToken.mutate(
      { label, expiresInDays, usesRemaining, groupId: groupId || undefined },
      {
        onSuccess: (result) => {
          const group = groups?.find((g) => g.id === groupId);
          setJustCreated({ id: result.id, label, token: result.token, groupName: group?.name ?? null });
          setCopied(false);
          setLabel("");
          setExpiresInDays(7);
          setUsesRemaining(1);
          setGroupId("");
        },
      },
    );
  }

  function legacyCopy(token: string): boolean {
    // Fallback for insecure contexts (plain http:// on a real host/IP, not localhost) —
    // navigator.clipboard is only defined in secure contexts, so a deployment running
    // without TLS in front of it (the default here — see docs/tls-setup.md) falls
    // through to this instead of throwing on an undefined navigator.clipboard.
    const textarea = document.createElement("textarea");
    textarea.value = token;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let succeeded = false;
    try {
      succeeded = document.execCommand("copy");
    } catch {
      succeeded = false;
    }
    document.body.removeChild(textarea);
    return succeeded;
  }

  function handleCopy(token: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(token).then(
        () => setCopied(true),
        () => setCopied(legacyCopy(token)),
      );
    } else {
      setCopied(legacyCopy(token));
    }
  }

  return (
    <div>
      <h1>Enrollment tokens</h1>
      <p>
        A new agent needs one of these tokens to enroll. The quickest path: create a token below, then download its
        setup file — it already contains this server's addresses and the token, so running it on the target machine
        needs no typing at all. Once enrolled, the agent persists its own identity and never needs the token again.
      </p>

      <ServerConnectionPanel />

      <div className="panel">
        <h2>Download the agent installer</h2>
        <p>
          The self-elevating installer (<code>EndpointProAgentSetup.exe</code>). It already contains this server's
          addresses from <em>Server connection details</em> (as saved when you download it), so when run it only asks
          for an enrollment token. For a no-typing install, create a token below and use{" "}
          <em>Download setup for this token</em> instead.
        </p>
        <a className="button-like" href="/api/admin/agent-installer" download>
          Download agent installer
        </a>
      </div>

      {justCreated && (
        <div className="panel">
          <h2>Token created for "{justCreated.label}"</h2>
          <p className="error-text">
            This is the only time the token value is shown — download the setup file now, or copy the token. Revoking
            or losing it means creating a new one.
          </p>
          <button
            type="button"
            onClick={() => downloadSetup.mutate({ tokenId: justCreated.id, enrollmentToken: justCreated.token })}
            disabled={downloadSetup.isPending}
          >
            {downloadSetup.isPending ? "Preparing…" : "Download setup for this token"}
          </button>
          {downloadSetup.isError && <p className="error-text">{(downloadSetup.error as Error).message}</p>}
          <p>
            Copy the downloaded <code>EndpointProAgentSetup-….exe</code> to the target machine and double-click it — it
            installs and enrolls the agent with every server address from <em>Server connection details</em>, and the
            agent picks whichever one it can reach (LAN or WAN). One file works for as many machines as the token's uses
            allow.
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
        </div>
      )}

      {justCreated && (
        // The server installs with the addresses from Server connection details; this origin
        // is only its fallback when none are configured or detectable.
        <RemoteInstallPanel tokenId={justCreated.id} token={justCreated.token} serverUrl={window.location.origin} />
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
