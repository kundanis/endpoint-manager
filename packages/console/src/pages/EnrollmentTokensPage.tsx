import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Ban, ClipboardCheck, Copy, Download, KeyRound, Plus, Radar } from "lucide-react";
import {
  useAgentConnectionSettings,
  useAgentSecurityStatus,
  useAssetGroups,
  useCreateAssetGroup,
  useCreateEnrollmentToken,
  useDownloadAgentInstaller,
  useDownloadAgentSetup,
  useDownloadTokenSetup,
  fetchEnrollmentTokenValue,
  useDownloadUnixAgent,
  useEnrollmentTokens,
  useIsItemHidden,
  useNetworkDeviceSummary,
  useMe,
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
  Segmented,
  Skeleton,
  useConfirm,
  usePagedList,
  useToast,
} from "../components/ui";
import type { EnrollmentTokenListItem } from "../api/types";
import { formatDateTime } from "../format";

const UNMANAGED_PREVIEW_ROWS = 4;
const NOT_DOWNLOADABLE = "Created before tokens could be downloaded again - create a new token for a setup file.";

// Onboarding shortcut: how many devices the latest network discovery scans found without the
// agent, so whoever is enrolling machines sees what's still missing. Renders nothing when the
// Network discovery page is hidden, or when this admin can't use Network Manager (the server
// refuses the summary - license or per-admin grant).
function DevicesWithoutAgentCard() {
  const hidden = useIsItemHidden("/network-scan");
  const { data: summary, isError } = useNetworkDeviceSummary();
  if (hidden || isError || !summary) return null;

  const scanned = summary.perVlan.some((v) => v.hasScan);
  const hosts = summary.unmanagedHosts;
  const openLink = (
    <Link className="ep-link" to="/network-scan">
      Open network discovery
    </Link>
  );

  return (
    <Card title="Devices Without the Agent" actions={openLink}>
      {!scanned ? (
        <EmptyState icon={Radar} title="No network scans yet">
          Scan your VLANs on the Network discovery page to find devices that still need the agent.
        </EmptyState>
      ) : hosts.length === 0 ? (
        <div className="app-stack-sm">
          <div>
            <Badge tone="ok">All covered</Badge>
          </div>
          <p className="app-text">Every device found on scanned VLANs already has the agent.</p>
        </div>
      ) : (
        <div className="app-stack-sm">
          <p className="app-text">
            <Badge tone="med">{hosts.length}</Badge> {hosts.length === 1 ? "device" : "devices"} on scanned VLANs{" "}
            {hosts.length === 1 ? "doesn't" : "don't"} have the agent yet. Some may be printers, switches or phones.
          </p>
          <div className="app-table-wrap">
            <table className="ep-tbl">
              <tbody>
                {hosts.slice(0, UNMANAGED_PREVIEW_ROWS).map((h) => (
                  <tr key={`${h.vlanName}-${h.ipAddress}`}>
                    <td className="ep-host">
                      <b className={h.hostname ? undefined : "app-unnamed"}>{h.hostname ?? "Unknown hostname"}</b>
                      <small>{h.ipAddress}</small>
                    </td>
                    <td className="app-muted">{h.vlanName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hosts.length > UNMANAGED_PREVIEW_ROWS && (
            <span className="app-muted">+{hosts.length - UNMANAGED_PREVIEW_ROWS} more on the Network discovery page</span>
          )}
        </div>
      )}
    </Card>
  );
}

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
        title="Server Connection Details"
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
// manually copying it and double-clicking on each one. Shown right after creating a token,
// while the browser still holds the token value.
function RemoteInstallPanel({ tokenId, token, serverUrl }: { tokenId: string; token: string; serverUrl: string }) {
  const startInstall = useStartRemoteInstall();
  // With a remote install account saved (Asset settings -> Remote install) the account is optional.
  const { data: security } = useAgentSecurityStatus();
  // Only super admins may install with the saved account (the server refuses it for anyone
  // else), so everyone else always types one.
  const { data: me } = useMe();
  const savedAccount = me?.role === "SUPER_ADMIN" ? (security?.remoteInstallUsername ?? null) : null;
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
      { tokenId, enrollmentToken: token, serverUrl, targets, ...(username.trim() && password ? { username, password } : {}) },
      { onSuccess: (result) => setJobId(result.jobId) },
    );
  }

  return (
    <form className="ep-card" onSubmit={handleSubmit}>
      <FormSection
        title="Install on Endpoint (Optional)"
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
                placeholder={savedAccount ?? undefined}
                required={!savedAccount}
              />
            </Field>
            <Field label="Password" htmlFor="remote-password" required={!savedAccount}>
              <input
                id="remote-password"
                className="ep-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!savedAccount || !!username.trim()}
              />
            </Field>
          </FormGrid>
          <Alert tone="info">
            {savedAccount ? (
              <>
                Leave the account empty to use the saved remote install account ({savedAccount}). An account typed here is used
                once and never stored.
              </>
            ) : (
              <>
                This credential is used once to reach the target machine(s) and is never stored. A super admin can save one in
                Asset settings → Remote install so it isn't asked each time.
              </>
            )}
          </Alert>
          {startInstall.isError && <Alert tone="critical">{(startInstall.error as Error).message}</Alert>}
        </div>
      </FormSection>
      {job && (
        <FormSection title="Install Status">
          <RemoteInstallStatusTable tasks={job.tasks} />
        </FormSection>
      )}
      <FormFooter>
        <Button
          type="submit"
          variant="primary"
          icon={Download}
          disabled={startInstall.isPending || !targetsText.trim() || (savedAccount ? !!username.trim() !== !!password : !username.trim() || !password)}
        >
          {startInstall.isPending ? "Starting…" : "Install on endpoint(s)"}
        </Button>
      </FormFooter>
    </form>
  );
}

// Fallback for insecure contexts (plain http:// on a real host/IP, not localhost) -
// navigator.clipboard is only defined in secure contexts, so a deployment running without
// TLS in front of it (see docs/tls-setup.md) falls through to this instead of throwing on an
// undefined navigator.clipboard.
function legacyCopy(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
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

function copyText(text: string): Promise<boolean> {
  if (!navigator.clipboard) return Promise.resolve(legacyCopy(text));
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => legacyCopy(text),
  );
}

type UnixPlatform = "macos" | "linux";

const UNIX_INSTALLERS: Record<UnixPlatform, { label: string; file: string; folder: string; requirement: string }> = {
  macos: {
    label: "macOS",
    file: "EndpointProAgentMac.tar.gz",
    folder: "EndpointProAgentMac",
    requirement: "macOS 12 or later, Apple silicon or Intel. Node.js is bundled - nothing else to install.",
  },
  linux: {
    label: "Linux",
    file: "EndpointProAgentLinux.tar.gz",
    folder: "EndpointProAgentLinux",
    requirement: "systemd-based distributions. Uses the Node.js bundled in the package (or the distribution's own Node.js 18+ if the bundled one can't run).",
  },
};

function isUsableToken(t: EnrollmentTokenListItem): boolean {
  return !t.revoked && t.usesRemaining > 0 && new Date(t.expiresAt) > new Date();
}

// Mac and Linux installs: a tarball plus one terminal command. Nothing is baked into the
// tarball, so the command carries this server's addresses (from Server connection details,
// in the agent's failover order) and - right after creating one - the token itself.
function UnixInstallCard({
  tokens,
  justCreated,
}: {
  tokens: EnrollmentTokenListItem[];
  justCreated: { id: string; token: string } | null;
}) {
  const [platform, setPlatform] = useState<UnixPlatform>("macos");
  const [copied, setCopied] = useState(false);
  // Any active token whose value the server kept can fill the command in.
  const usable = tokens.filter((t) => t.downloadable && isUsableToken(t));
  const [tokenId, setTokenId] = useState("");
  const [tokenValue, setTokenValue] = useState<{ id: string; token: string } | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    if (justCreated) {
      setTokenId(justCreated.id);
      setTokenValue(justCreated);
    }
  }, [justCreated]);

  function chooseToken(id: string) {
    setTokenId(id);
    setCopied(false);
    setTokenError(null);
    if (!id) return setTokenValue(null);
    if (justCreated?.id === id) return setTokenValue(justCreated);
    fetchEnrollmentTokenValue(id).then(
      (token) => setTokenValue({ id, token }),
      (err: Error) => {
        setTokenValue(null);
        setTokenError(err.message);
      },
    );
  }
  const token = tokenValue && tokenValue.id === tokenId ? tokenValue.token : null;
  const { data: settings } = useAgentConnectionSettings();
  const download = useDownloadUnixAgent();
  const info = UNIX_INSTALLERS[platform];

  const serverUrls = [settings?.localUrl ?? settings?.detectedLocalUrl, settings?.webUrl, settings?.publicUrl].filter(
    (u): u is string => Boolean(u),
  );
  const serverUrl = serverUrls.length > 0 ? serverUrls.join(",") : window.location.origin;
  // Extracted by root into a fresh root-only mktemp folder: a fixed /tmp path could be
  // pre-created by another local user, who could then swap install.sh or the bundled node
  // before root runs them (install.sh refuses a package folder non-root users can modify).
  // The token goes in on stdin via the printf builtin, so it never shows in the process list;
  // the leading space keeps the line out of history where the shell ignores space-prefixed lines.
  const command =
    ` d=$(sudo mktemp -d /tmp/${info.folder}.XXXXXX) && sudo tar --no-same-owner -xzf ${info.file} -C "$d" && ` +
    `printf '%s' '${token ?? "<enrollment-token>"}' | sudo bash "$d/install.sh" --server-url "${serverUrl}" --enrollment-token-stdin`;

  function choose(next: UnixPlatform) {
    setPlatform(next);
    setCopied(false);
    download.reset();
  }

  return (
    <Card
      title="Install on Mac or Linux"
      actions={
        <Segmented
          label="Platform"
          value={platform}
          onChange={choose}
          options={[
            { value: "macos", label: "macOS" },
            { value: "linux", label: "Linux" },
          ]}
        />
      }
    >
      <div className="app-stack">
        <p className="app-text">
          Download <span className="ep-mono">{info.file}</span>, copy it to the {info.label} machine and run the command
          below in Terminal from the folder it's in. {info.requirement}
        </p>
        {download.isError && (
          <Alert tone="critical" title={`${info.label} agent not available`}>
            {(download.error as Error).message}
          </Alert>
        )}
        <Field label="Enrollment token" htmlFor="unix-token" help={usable.length === 0 ? "Create a token to fill it into the command." : undefined}>
          <select id="unix-token" className="ep-select" value={tokenId} onChange={(e) => chooseToken(e.target.value)}>
            <option value="">Choose a token…</option>
            {usable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        {tokenError && <Alert tone="critical">{tokenError}</Alert>}
        <div className="app-actions-row">
          <Button icon={Download} onClick={() => download.mutate(platform)} disabled={download.isPending}>
            {download.isPending ? "Preparing…" : `Download ${info.label} agent`}
          </Button>
        </div>
        <div className="ep-code">
          {command}
          <Button size="sm" icon={copied ? ClipboardCheck : Copy} onClick={() => copyText(command).then(setCopied)}>
            {copied ? "Copied" : "Copy command"}
          </Button>
        </div>

      </div>
    </Card>
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
  // "New group…" in the Target group list: name it here and it's created and selected.
  const NEW_GROUP = "__new__";
  const createGroup = useCreateAssetGroup();
  const [newGroupName, setNewGroupName] = useState("");
  const [createdGroup, setCreatedGroup] = useState<{ id: string; name: string } | null>(null);
  const [justCreated, setJustCreated] = useState<{
    id: string;
    label: string;
    token: string;
    groupName: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const downloadSetup = useDownloadAgentSetup();
  const downloadInstaller = useDownloadAgentInstaller();
  const downloadTokenSetup = useDownloadTokenSetup();
  const toast = useToast();

  const paged = usePagedList(tokens ?? []);

  function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    createGroup.mutate(
      { name },
      {
        onSuccess: (g) => {
          setCreatedGroup({ id: g.id, name: g.name });
          setGroupId(g.id);
          setNewGroupName("");
          toast(`Group ${g.name} created.`);
        },
      },
    );
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createToken.mutate(
      { label, expiresInDays, usesRemaining, groupId: groupId && groupId !== NEW_GROUP ? groupId : undefined },
      {
        onSuccess: (result) => {
          const group = groups?.find((g) => g.id === groupId) ?? (createdGroup?.id === groupId ? createdGroup : undefined);
          setJustCreated({ id: result.id, label, token: result.token, groupName: group?.name ?? null });
          setCopied(false);
          setLabel("");
          setExpiresInDays(7);
          setUsesRemaining(1);
          setGroupId("");
          setNewGroupName("");
          setCreatedGroup(null);
          setCreating(false);
        },
      },
    );
  }

  async function handleRevoke(id: string, tokenLabel: string) {
    const confirmed = await confirm({
      title: `Revoke Token "${tokenLabel}"?`,
      body: "New agents can no longer enroll with it. Endpoints that already enrolled keep working. This cannot be undone.",
      confirmLabel: "Revoke token",
      tone: "danger",
    });
    if (!confirmed) return;
    revokeToken.mutate(id);
  }

  function handleCopy(token: string) {
    copyText(token).then(setCopied);
  }

  return (
    <>
      <PageHeader
        title="Enrollment Tokens"
        description="A new agent needs one of these tokens to enroll. Once enrolled, the agent persists its own identity and never needs the token again."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Create token
          </Button>
        }
      />

      {justCreated && (
        <Card title={`Token Created for "${justCreated.label}"`}>
          <div className="app-stack">
            <Alert tone="info" title="Available again later">
              You can download this token's setup file or copy the token any time while it's active, from its{" "}
              <strong>⋯</strong> menu in the token list below.
            </Alert>
            <p className="app-text">
              Copy the downloaded <span className="ep-mono">EndpointProAgentSetup-….exe</span> to the target machine and
              double-click it — it installs and enrolls the agent with every server address from{" "}
              <em>Server connection details</em>, and the agent picks whichever one it can reach (LAN or WAN). One file
              works for as many machines as the token's uses allow. If Group Policy blocks PowerShell on the machine
              (setup reports "This program is blocked by group policy"), use the setup without PowerShell — it installs
              the same agent.
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
              <Button
                icon={Download}
                onClick={() =>
                  downloadSetup.mutate({ tokenId: justCreated.id, enrollmentToken: justCreated.token, variant: "no-powershell" })
                }
                disabled={downloadSetup.isPending}
              >
                Setup without PowerShell
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
                                  label: "Download Windows setup",
                                  icon: Download,
                                  disabled: isDead || !t.downloadable || downloadTokenSetup.isPending,
                                  title: !t.downloadable ? NOT_DOWNLOADABLE : isDead ? "This token can no longer enroll endpoints" : undefined,
                                  onSelect: () =>
                                    downloadTokenSetup.mutate({ tokenId: t.id }, { onError: (err) => toast((err as Error).message) }),
                                },
                                {
                                  label: "Download Windows setup without PowerShell",
                                  icon: Download,
                                  disabled: isDead || !t.downloadable || downloadTokenSetup.isPending,
                                  title: !t.downloadable
                                    ? NOT_DOWNLOADABLE
                                    : isDead
                                      ? "This token can no longer enroll endpoints"
                                      : "For machines where Group Policy blocks PowerShell",
                                  onSelect: () =>
                                    downloadTokenSetup.mutate(
                                      { tokenId: t.id, variant: "no-powershell" },
                                      { onError: (err) => toast((err as Error).message) },
                                    ),
                                },
                                {
                                  label: "Copy token",
                                  icon: Copy,
                                  disabled: isDead || !t.downloadable,
                                  title: !t.downloadable ? NOT_DOWNLOADABLE : isDead ? "This token can no longer enroll endpoints" : undefined,
                                  onSelect: () =>
                                    fetchEnrollmentTokenValue(t.id)
                                      .then(copyText)
                                      .then(
                                        (ok) => toast(ok ? `Token for "${t.label}" copied.` : "Couldn't copy to the clipboard."),
                                        (err: Error) => toast(err.message),
                                      ),
                                },
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
        <div className="app-stack" style={{ alignSelf: "start" }}>
        <Card title="Download the Agent Installer">
          <div className="app-stack">
            <p className="app-text">
              The self-elevating installer (<span className="ep-mono">EndpointProAgentSetup.exe</span>). It already
              contains this server's addresses from <em>Server connection details</em> (as saved when you download it), so
              when run it only asks for an enrollment token. For a no-typing install, create a token and use{" "}
              <em>Download setup for this token</em> instead.
            </p>
            <p className="app-text">
              <strong>Without PowerShell</strong> installs the same agent without starting PowerShell, for machines where
              Group Policy blocks it (setup reports "This program is blocked by group policy").
            </p>
            {downloadInstaller.isError && (
              <Alert tone="critical" title="Installer not available">
                {(downloadInstaller.error as Error).message}
              </Alert>
            )}
            <div className="app-actions-row">
              <Button icon={Download} onClick={() => downloadInstaller.mutate("standard")} disabled={downloadInstaller.isPending}>
                {downloadInstaller.isPending ? "Preparing…" : "Download agent installer"}
              </Button>
              <Button icon={Download} onClick={() => downloadInstaller.mutate("no-powershell")} disabled={downloadInstaller.isPending}>
                Without PowerShell
              </Button>
            </div>
          </div>
        </Card>
        <UnixInstallCard tokens={tokens ?? []} justCreated={justCreated} />
        <DevicesWithoutAgentCard />
        </div>
      </Row>

      {creating && (
        <Modal
          title="Create Enrollment Token"
          description="The quickest path: create a token, then download its setup file — it already contains this server's addresses and the token, so running it on the target machine needs no typing at all."
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" form="create-token-form" variant="primary" disabled={createToken.isPending || !label.trim() || groupId === NEW_GROUP}>
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
                help={
                  groupId && groupId !== NEW_GROUP ? "Every endpoint that enrolls with this token will automatically be added to this group." : undefined
                }
              >
                <select id="token-group" className="ep-select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">No group</option>
                  {groups?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                  {createdGroup && !groups?.some((g) => g.id === createdGroup.id) && <option value={createdGroup.id}>{createdGroup.name}</option>}
                  <option value={NEW_GROUP}>New group…</option>
                </select>
              </Field>
              {groupId === NEW_GROUP && (
                <Field label="New group name" htmlFor="token-new-group" span2 help="The group is created now and selected for this token.">
                  <div className="app-actions-row">
                    <input
                      id="token-new-group"
                      className="ep-input"
                      type="text"
                      maxLength={200}
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCreateGroup();
                        }
                      }}
                      autoFocus
                    />
                    <Button icon={Plus} onClick={handleCreateGroup} disabled={!newGroupName.trim() || createGroup.isPending}>
                      {createGroup.isPending ? "Creating…" : "Create group"}
                    </Button>
                  </div>
                </Field>
              )}
              {createGroup.isError && <Alert tone="critical">{(createGroup.error as Error).message}</Alert>}
            </FormGrid>
            {createToken.isError && <Alert tone="critical">{(createToken.error as Error).message}</Alert>}
          </form>
        </Modal>
      )}
    </>
  );
}
