import { useEffect, useState, type FormEvent } from "react";
import { Ban, ClipboardCheck, Copy, Download, KeyRound, Plus } from "lucide-react";
import {
  useAgentConnectionSettings,
  useAssetGroups,
  useCreateEnrollmentToken,
  useDownloadAgentInstaller,
  useDownloadAgentSetup,
  useEnrollmentTokens,
  useRemoteInstallJob,
  useRevokeEnrollmentToken,
  useSaveAgentConnectionSettings,
  useStartRemoteInstall,
} from "../api/hooks";
import RemoteInstallStatusTable from "../components/RemoteInstallStatusTable";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormFooter,
  FormGrid,
  FormSection,
  Modal,
  PageHeader,
  Pagination,
  Row,
  RowMenu,
  Skeleton,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatDateTime } from "../format";

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

// Protocol / IP address / port for one server address. `idPrefix` keeps the label/input ids
// unique, since the same field set appears twice in the connection form.
function AddressFields({ idPrefix, value, onChange }: { idPrefix: string; value: AddressParts; onChange: (v: AddressParts) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 20px" }}>
      <div style={{ flex: "0 0 120px" }}>
        <Field label="Protocol" htmlFor={`${idPrefix}-protocol`}>
          <select
            id={`${idPrefix}-protocol`}
            className="ep-select"
            value={value.protocol}
            onChange={(e) => onChange({ ...value, protocol: e.target.value as Protocol })}
          >
            <option value="http">http</option>
            <option value="https">https</option>
          </select>
        </Field>
      </div>
      <div style={{ flex: "1 1 12rem" }}>
        <Field label="IP address" htmlFor={`${idPrefix}-host`}>
          <input
            id={`${idPrefix}-host`}
            className="ep-input ep-mono"
            type="text"
            value={value.host}
            onChange={(e) => onChange({ ...value, host: e.target.value })}
          />
        </Field>
      </div>
      <div style={{ flex: "0 0 120px" }}>
        <Field label="Port" htmlFor={`${idPrefix}-port`}>
          <input
            id={`${idPrefix}-port`}
            className="ep-input ep-num"
            type="number"
            min={1}
            max={65535}
            value={value.port}
            onChange={(e) => onChange({ ...value, port: e.target.value })}
          />
        </Field>
      </div>
    </div>
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
    <form className="ep-card" onSubmit={handleSubmit}>
      <FormSection
        title="Server connection details"
        description="Agents get every address below automatically — in each token's setup file and, for agents already installed, on their next check-in. An endpoint in the office connects over the local address; one outside (WAN) falls back to the web URL, then the public IP. Nobody has to type a server address during setup."
      >
        {settings && !settings.configured && (
          <Alert tone="warn" title="Not saved yet">
            Until you save, agents only get the auto-detected local address and can't connect from outside the office.
          </Alert>
        )}
      </FormSection>
      <FormSection title="1. Local (LAN) address of this server">
        <AddressFields idPrefix="conn-local" value={local} onChange={setLocal} />
      </FormSection>
      <FormSection title="2. Web URL" description="For example https://endpoint.example.com — its HTTPS certificate must match this name.">
        <FormGrid>
          <Field label="Web URL" htmlFor="conn-web-url" span2>
            <input
              id="conn-web-url"
              className="ep-input ep-mono"
              type="text"
              value={webUrl}
              onChange={(e) => setWebUrl(e.target.value)}
              placeholder="https://…"
            />
          </Field>
        </FormGrid>
      </FormSection>
      <FormSection title="3. Public IP and port" description="NAT on your firewall.">
        <div className="app-stack-sm">
          <AddressFields idPrefix="conn-public" value={publicAddr} onChange={setPublicAddr} />
          {publicAddr.host.trim() && publicAddr.protocol === "http" && (
            <Alert tone="warn">
              Plain http over the public IP sends agent traffic, including each agent's key, across the internet
              unencrypted. Prefer the https web URL; keep this as a last-resort fallback only.
            </Alert>
          )}
          {save.isError && <Alert tone="critical">{(save.error as Error).message}</Alert>}
        </div>
      </FormSection>
      <FormFooter>
        {save.isSuccess && <span className="app-saved">Saved. Enrolled agents pick up the new addresses on their next check-in.</span>}
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save connection details"}
        </Button>
      </FormFooter>
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
    <form className="ep-card" onSubmit={handleSubmit}>
      <FormSection
        title="Install on endpoint (optional)"
        description="Have this server reach out over PowerShell Remoting (WinRM) and install the agent directly on one or more machines already on the network — no need to copy anything or touch the target machine yourself. Requires WinRM enabled on the targets and an admin credential valid on all of them."
      >
        <div className="app-stack">
          <FormGrid>
            <Field label="Target hostnames or IPs" htmlFor="remote-targets" required span2 help="One per line, or comma-separated.">
              <textarea
                id="remote-targets"
                className="ep-textarea ep-mono"
                rows={4}
                value={targetsText}
                onChange={(e) => setTargetsText(e.target.value)}
                placeholder={"SSSIL-DSK-68\n10.10.6.79"}
                required
              />
            </Field>
            <Field label="Admin username" htmlFor="remote-username" required help="For example DOMAIN\admin or .\localadmin">
              <input
                id="remote-username"
                className="ep-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </Field>
            <Field label="Password" htmlFor="remote-password" required>
              <input
                id="remote-password"
                className="ep-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          </FormGrid>
          <Alert tone="info">
            This credential is used once to reach the target machine(s) and is never stored — it isn't saved anywhere on
            this server.
          </Alert>
          {startInstall.isError && <Alert tone="critical">{(startInstall.error as Error).message}</Alert>}
        </div>
      </FormSection>
      {job && (
        <FormSection title="Install status">
          <RemoteInstallStatusTable tasks={job.tasks} />
        </FormSection>
      )}
      <FormFooter>
        <Button
          type="submit"
          variant="primary"
          icon={Download}
          disabled={startInstall.isPending || !targetsText.trim() || !username.trim() || !password}
        >
          {startInstall.isPending ? "Starting…" : "Install on endpoint(s)"}
        </Button>
      </FormFooter>
    </form>
  );
}

export default function EnrollmentTokensPage() {
  const { data: tokens, isLoading, error, refetch } = useEnrollmentTokens();
  const { data: groups } = useAssetGroups();
  const createToken = useCreateEnrollmentToken();
  const revokeToken = useRevokeEnrollmentToken();
  const confirm = useConfirm();

  const [creating, setCreating] = useState(false);
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
  const downloadInstaller = useDownloadAgentInstaller();

  const paged = usePagedList(tokens ?? []);

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
          setCreating(false);
        },
      },
    );
  }

  async function handleRevoke(id: string, tokenLabel: string) {
    const confirmed = await confirm({
      title: `Revoke token "${tokenLabel}"?`,
      body: "New agents can no longer enroll with it. Endpoints that already enrolled keep working. This cannot be undone.",
      confirmLabel: "Revoke token",
      tone: "danger",
    });
    if (!confirmed) return;
    revokeToken.mutate(id);
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
    <>
      <PageHeader
        title="Enrollment tokens"
        description="A new agent needs one of these tokens to enroll. Once enrolled, the agent persists its own identity and never needs the token again."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Create token
          </Button>
        }
      />

      {justCreated && (
        <Card title={`Token created for "${justCreated.label}"`}>
          <div className="app-stack">
            <Alert tone="warn" title="Shown only once">
              This is the only time the token value is shown — download the setup file now, or copy the token. Revoking or
              losing it means creating a new one.
            </Alert>
            <p className="app-text">
              Copy the downloaded <span className="ep-mono">EndpointProAgentSetup-….exe</span> to the target machine and
              double-click it — it installs and enrolls the agent with every server address from{" "}
              <em>Server connection details</em>, and the agent picks whichever one it can reach (LAN or WAN). One file
              works for as many machines as the token's uses allow.
            </p>
            <div className="app-actions-row">
              <Button
                variant="primary"
                icon={Download}
                onClick={() => downloadSetup.mutate({ tokenId: justCreated.id, enrollmentToken: justCreated.token })}
                disabled={downloadSetup.isPending}
              >
                {downloadSetup.isPending ? "Preparing…" : "Download setup for this token"}
              </Button>
            </div>
            {downloadSetup.isError && <Alert tone="critical">{(downloadSetup.error as Error).message}</Alert>}
            <div className="ep-code">
              {justCreated.token}
              <Button size="sm" icon={copied ? ClipboardCheck : Copy} onClick={() => handleCopy(justCreated.token)}>
                {copied ? "Copied" : "Copy to clipboard"}
              </Button>
            </div>
            {justCreated.groupName && (
              <p className="app-text">
                Endpoints enrolled with this token will automatically join the <strong>{justCreated.groupName}</strong>{" "}
                group.
              </p>
            )}
          </div>
        </Card>
      )}

      {justCreated && (
        // The server installs with the addresses from Server connection details; this origin
        // is only its fallback when none are configured or detectable.
        <RemoteInstallPanel tokenId={justCreated.id} token={justCreated.token} serverUrl={window.location.origin} />
      )}

      <Card flush title="Tokens" hint={tokens ? `${tokens.length} total` : undefined}>
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load enrollment tokens"
              action={
                <Button size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            >
              {(error as Error).message}
            </Alert>
          </div>
        ) : !tokens || tokens.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No enrollment tokens created yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                Create token
              </Button>
            }
          >
            Create a token, then download its setup file to enroll your first endpoint.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Label</th>
                    <th scope="col">Group</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Uses remaining
                    </th>
                    <th scope="col">Expires</th>
                    <th scope="col">Status</th>
                    <th scope="col">Created</th>
                    <th scope="col">
                      <span className="app-vh">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.pageItems.map((t) => {
                    const isExpired = new Date(t.expiresAt) < new Date();
                    const isDead = t.revoked || isExpired || t.usesRemaining <= 0;
                    return (
                      <tr key={t.id}>
                        <td>
                          <b>{t.label}</b>
                        </td>
                        <td>{t.groupName ?? <span className="app-muted">—</span>}</td>
                        <td className="ep-num" style={{ textAlign: "right" }}>
                          {t.usesRemaining}
                        </td>
                        <td>{formatDateTime(t.expiresAt)}</td>
                        <td>
                          <Badge tone={isDead ? "crit" : "ok"}>
                            {t.revoked ? "Revoked" : isExpired ? "Expired" : t.usesRemaining <= 0 ? "Exhausted" : "Active"}
                          </Badge>
                        </td>
                        <td>{formatDateTime(t.createdAt)}</td>
                        <td>
                          <div className="app-cell-actions">
                            <RowMenu
                              label={`Actions for ${t.label}`}
                              items={[
                                {
                                  label: "Revoke token",
                                  icon: Ban,
                                  danger: true,
                                  disabled: t.revoked || revokeToken.isPending,
                                  onSelect: () => handleRevoke(t.id, t.label),
                                },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              noun="tokens"
              onPageChange={paged.setPage}
              onPageSizeChange={paged.setPageSize}
            />
          </>
        )}
      </Card>

      <Row layout="21">
        <ServerConnectionPanel />
        <Card title="Download the agent installer" style={{ alignSelf: "start" }}>
          <div className="app-stack">
            <p className="app-text">
              The self-elevating installer (<span className="ep-mono">EndpointProAgentSetup.exe</span>). It already
              contains this server's addresses from <em>Server connection details</em> (as saved when you download it), so
              when run it only asks for an enrollment token. For a no-typing install, create a token and use{" "}
              <em>Download setup for this token</em> instead.
            </p>
            {downloadInstaller.isError && (
              <Alert tone="critical" title="Installer not available">
                {(downloadInstaller.error as Error).message}
              </Alert>
            )}
            <div className="app-actions-row">
              <Button icon={Download} onClick={() => downloadInstaller.mutate()} disabled={downloadInstaller.isPending}>
                {downloadInstaller.isPending ? "Preparing…" : "Download agent installer"}
              </Button>
            </div>
          </div>
        </Card>
      </Row>

      {creating && (
        <Modal
          title="Create enrollment token"
          description="The quickest path: create a token, then download its setup file — it already contains this server's addresses and the token, so running it on the target machine needs no typing at all."
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" form="create-token-form" variant="primary" disabled={createToken.isPending || !label.trim()}>
                {createToken.isPending ? "Creating…" : "Create token"}
              </Button>
            </>
          }
        >
          <form id="create-token-form" className="app-stack" onSubmit={handleCreate}>
            <FormGrid>
              <Field label="Label" htmlFor="token-label" required span2>
                <input
                  id="token-label"
                  className="ep-input"
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Finance laptops batch 1"
                  required
                  data-autofocus
                />
              </Field>
              <Field label="Expires in (days)" htmlFor="token-expires">
                <input
                  id="token-expires"
                  className="ep-input ep-num"
                  type="number"
                  min={1}
                  max={365}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                />
              </Field>
              <Field label="Uses remaining" htmlFor="token-uses" help="How many agents can enroll with it.">
                <input
                  id="token-uses"
                  className="ep-input ep-num"
                  type="number"
                  min={1}
                  max={10000}
                  value={usesRemaining}
                  onChange={(e) => setUsesRemaining(Number(e.target.value))}
                />
              </Field>
              <Field
                label="Target group (optional)"
                htmlFor="token-group"
                span2
                help={groupId ? "Every endpoint that enrolls with this token will automatically be added to this group." : undefined}
              >
                <select id="token-group" className="ep-select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">No group</option>
                  {groups?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </Field>
            </FormGrid>
            {createToken.isError && <Alert tone="critical">{(createToken.error as Error).message}</Alert>}
          </form>
        </Modal>
      )}
    </>
  );
}
