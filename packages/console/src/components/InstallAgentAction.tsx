import { useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import { useRemoteInstallJob, useStartRemoteInstall } from "../api/hooks";
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
export default function InstallAgentAction({ hostname, ipAddress }: { hostname: string | null; ipAddress: string }) {
  const startInstall = useStartRemoteInstall();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const { data: job } = useRemoteInstallJob(jobId);

  const target = hostname ?? ipAddress;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    startInstall.mutate(
      { serverUrl: window.location.origin, targets: [target], username, password },
      { onSuccess: (result) => setJobId(result.jobId) },
    );
  }

  if (job) {
    return <RemoteInstallStatusTable tasks={job.tasks} />;
  }

  if (!open) {
    return (
      <Button size="sm" icon={Download} onClick={() => setOpen(true)}>
        Install agent
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="app-inline-form">
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
      {startInstall.isError && <span className="ep-error">{(startInstall.error as Error).message}</span>}
      <div className="app-actions-row">
        <Button size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={startInstall.isPending || !username.trim() || !password}>
          {startInstall.isPending ? "Starting…" : `Install on ${target}`}
        </Button>
      </div>
    </form>
  );
}
