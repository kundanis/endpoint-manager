import { useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import { Link } from "react-router-dom";
import { useAgentSecurityStatus, useEnrollmentTokens, useMe, useRemoteInstallJob, useStartRemoteInstall } from "../api/hooks";
import RemoteInstallStatusTable from "./RemoteInstallStatusTable";
import { Button } from "./ui";

// Per-host "Install agent" on an unmanaged device - same underlying WinRM-based remote
// install as Enrollment Tokens' "Install on endpoint" panel, just triggered with the target
// pre-filled instead of typed in. No enrollment token to supply here (there's no
// token-creation step in this flow at all) - the server mints a short-lived, single-use one
// internally for this one install (see remoteInstall.service.ts). Takes just
// hostname/ipAddress rather than a full discovered-host type so it's reusable against any
// "unmanaged device" shape (Network Scan's per-run results, Endpoints' unmanaged-devices
// summary) without those needing to share a type.
//
// With a remote install account saved (Asset settings -> Remote install) no login is asked:
// the server uses the saved account. "Use another account" still lets an admin type one.
export default function InstallAgentAction({ hostname, ipAddress }: { hostname: string | null; ipAddress: string }) {
  const startInstall = useStartRemoteInstall();
  const [open, setOpen] = useState(false);
  const [useOther, setUseOther] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const { data: job } = useRemoteInstallJob(jobId);
  const { data: security } = useAgentSecurityStatus();
  // Only super admins may install with the saved account (the server refuses it for anyone
  // else), so everyone else always types one.
  const { data: me } = useMe();
  const savedAccount = me?.role === "SUPER_ADMIN" ? (security?.remoteInstallUsername ?? null) : null;
  const typing = !savedAccount || useOther;
  // Group: only groups with an active enrollment token (not revoked or expired, uses left, value
  // kept). Picking one installs with that token, so the device joins its group. "No group" keeps
  // the one-time token the server makes for this install.
  const { data: tokens } = useEnrollmentTokens();
  const now = Date.now();
  const groupTokens = (tokens ?? []).filter(
    (t) => t.groupId && t.groupName && !t.revoked && t.usesRemaining > 0 && t.downloadable && new Date(t.expiresAt).getTime() > now,
  );
  const [tokenId, setTokenId] = useState("");

  const target = hostname ?? ipAddress;

  function start(withTokenId: string) {
    startInstall.mutate(
      {
        serverUrl: window.location.origin,
        targets: [target],
        ...(typing ? { username, password } : {}),
        ...(withTokenId ? { tokenId: withTokenId } : {}),
      },
      { onSuccess: (result) => setJobId(result.jobId) },
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    start(tokenId);
  }

  if (job) {
    return <RemoteInstallStatusTable tasks={job.tasks} />;
  }

  if (!open) {
    return (
      <div className="app-stack-sm">
        <Button size="sm" icon={Download} disabled={startInstall.isPending} onClick={() => setOpen(true)} title={savedAccount ? `Installs as ${savedAccount}` : undefined}>
          {startInstall.isPending ? "Starting…" : "Install agent"}
        </Button>
        {startInstall.isError && <span className="ep-error">{(startInstall.error as Error).message}</span>}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="app-inline-form">
      {typing ? (
        <>
          <input
            className="ep-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="DOMAIN\admin"
            aria-label={`Admin username for ${target}`}
            required
            autoFocus
          />
          <input
            className="ep-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label={`Admin password for ${target}`}
            required
          />
        </>
      ) : (
        <span className="app-muted">
          Installs as <span className="ep-mono">{savedAccount}</span>
        </span>
      )}
      {/* Always shown, so it's clear why no group is offered when none has an active token. */}
      <select
        className="ep-select"
        value={tokenId}
        onChange={(e) => setTokenId(e.target.value)}
        aria-label={`Group for ${target}`}
        title="Groups with an active enrollment token. The device joins the group and uses one of the token's uses."
        disabled={groupTokens.length === 0}
      >
        <option value="">{groupTokens.length === 0 ? "No group (no group has an active token)" : "No group"}</option>
        {groupTokens.map((t) => (
          <option key={t.id} value={t.id}>
            {t.groupName} — {t.label} ({t.usesRemaining} {t.usesRemaining === 1 ? "use" : "uses"} left)
          </option>
        ))}
      </select>
      {groupTokens.length === 0 && (
        <span className="app-muted">
          To add the device to a group, <Link to="/enrollment-tokens">create an enrollment token</Link> with that group.
        </span>
      )}
      {startInstall.isError && <span className="ep-error">{(startInstall.error as Error).message}</span>}
      <div className="app-actions-row">
        <Button
          size="sm"
          onClick={() => {
            setOpen(false);
            setUseOther(false);
          }}
        >
          Cancel
        </Button>
        {savedAccount && (
          <Button size="sm" onClick={() => setUseOther((v) => !v)}>
            {useOther ? "Use saved account" : "Use another account"}
          </Button>
        )}
        <Button size="sm" variant="primary" type="submit" disabled={startInstall.isPending || (typing && (!username.trim() || !password))}>
          {startInstall.isPending ? "Starting…" : `Install on ${target}`}
        </Button>
      </div>
    </form>
  );
}
