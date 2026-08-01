import { useState, type FormEvent } from "react";
import {
  useActivateLicense,
  useLicenseServerConfig,
  useLicenseStatus,
  useRequestLicenseUnlock,
  useSetLicenseServerConfig,
  useTestLicenseServerConnection,
} from "../api/hooks";

const VALIDITY_LABELS: Record<string, string> = {
  ONE_YEAR: "1 year",
  TWO_YEAR: "2 years",
  THREE_YEAR: "3 years",
  PERPETUAL: "Perpetual",
};

const MODULE_LABELS: Record<string, string> = {
  ENDPOINT_MANAGER: "Endpoint Manager",
  NETWORK_MANAGER: "Network Manager",
  SOFTWARE_MANAGER: "Software Manager",
  SECURITY_MANAGER: "Security Manager",
  DATA_MANAGER: "Data Manager",
  USER_MANAGER: "User Manager",
};
const ALL_MODULE_KEYS = Object.keys(MODULE_LABELS);

function LicenseApiPanel() {
  const { data: serverConfig, isLoading } = useLicenseServerConfig();
  const setConfig = useSetLicenseServerConfig();
  const testConnection = useTestLicenseServerConnection();

  const [url, setUrl] = useState("");

  function handleConnect(e: FormEvent) {
    e.preventDefault();
    setConfig.mutate(url, { onSuccess: () => setUrl("") });
  }

  if (isLoading) return null;

  const isConnected = !!serverConfig?.configured && serverConfig.lastConnectionOk === true;

  return (
    <div className="panel">
      <h2>Licence API</h2>
      <p>
        Enter the address of the vendor's central License Server. A key can only be activated once a connection to
        it is confirmed.
      </p>

      {serverConfig?.serverUrl && (
        <div className="detail-grid" style={{ marginBottom: "1rem" }}>
          <div>
            <strong>Configured address</strong>
            <span className="mono-cell">{serverConfig.serverUrl}</span>
          </div>
          <div>
            <strong>Connection</strong>
            <span className={`status-badge ${isConnected ? "online" : "danger"}`}>
              {isConnected ? "Connected" : "Not connected"}
            </span>
          </div>
          <div>
            <strong>Last checked</strong>
            {serverConfig.lastConnectionCheckAt ? new Date(serverConfig.lastConnectionCheckAt).toLocaleString() : "—"}
          </div>
        </div>
      )}

      {serverConfig?.configured && (
        <button
          type="button"
          onClick={() => testConnection.mutate()}
          disabled={testConnection.isPending}
          style={{ marginBottom: "1rem" }}
        >
          {testConnection.isPending ? "Testing…" : "Test connection"}
        </button>
      )}

      <form onSubmit={handleConnect}>
        <label>
          {serverConfig?.configured ? "Change address" : "License Server address"}
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://license.vendor.example"
            required
          />
        </label>
        {setConfig.isError && <p className="error-text">{(setConfig.error as Error).message}</p>}
        {testConnection.isError && <p className="error-text">{(testConnection.error as Error).message}</p>}
        <button type="submit" disabled={setConfig.isPending || !url.trim()}>
          {setConfig.isPending ? "Connecting…" : "Connect"}
        </button>
      </form>
    </div>
  );
}

export default function LicenseActivationPage() {
  const { data: serverConfig } = useLicenseServerConfig();
  const { data: status, isLoading } = useLicenseStatus();
  const activate = useActivateLicense();
  const requestUnlock = useRequestLicenseUnlock();

  const [keyString, setKeyString] = useState("");
  const [reason, setReason] = useState("");
  const [unlockSent, setUnlockSent] = useState(false);

  function handleActivate(e: FormEvent) {
    e.preventDefault();
    activate.mutate(keyString, { onSuccess: () => setKeyString("") });
  }

  function handleUnlockRequest(e: FormEvent) {
    e.preventDefault();
    requestUnlock.mutate(reason, {
      onSuccess: () => {
        setUnlockSent(true);
        setReason("");
      },
    });
  }

  if (isLoading) return <div className="page-loading">Loading…</div>;

  const isExpired = status?.validUntil ? new Date(status.validUntil) < new Date() : false;
  const isRevoked = status?.status === "REVOKED";
  const isUnreachable = !!status?.lastRevalidationError;
  const atCap = status?.activated && status.maxAgents !== undefined && (status.currentAgentCount ?? 0) >= status.maxAgents;
  const canActivate = !!serverConfig?.configured && serverConfig.lastConnectionOk === true;

  return (
    <div>
      <h1>Licensing</h1>
      <p>
        This deployment must activate a license key (issued by the vendor's central License Server) before it can
        enroll new agents. Activation is one-time-use — once a key is redeemed here, it locks to this deployment.
      </p>

      <LicenseApiPanel />

      {status?.activated ? (
        <div className="detail-grid">
          <div>
            <strong>Entity</strong>
            {status.entityName}
          </div>
          <div>
            <strong>Status</strong>
            <span className={`status-badge ${isRevoked ? "danger" : isExpired ? "warn" : "online"}`}>
              {isRevoked ? "Revoked" : isExpired ? "Expired" : "Activated"}
            </span>
          </div>
          <div>
            <strong>Agents</strong>
            {status.currentAgentCount} / {status.maxAgents}
            {atCap && <span className="status-badge danger" style={{ marginLeft: "0.5rem" }}>At cap</span>}
          </div>
          <div>
            <strong>Validity</strong>
            {status.validityType ? VALIDITY_LABELS[status.validityType] : "—"}
          </div>
          <div>
            <strong>Modules</strong>
            {!status.modules || status.modules.length === ALL_MODULE_KEYS.length
              ? "All"
              : status.modules.map((m) => MODULE_LABELS[m] ?? m).join(", ") || "None"}
          </div>
          <div>
            <strong>Valid until</strong>
            {status.validUntil ? new Date(status.validUntil).toLocaleDateString() : "Perpetual"}
          </div>
          <div>
            <strong>Deployment ID</strong>
            <span className="mono-cell">{status.deploymentId}</span>
          </div>
          <div>
            <strong>Last re-validated</strong>
            {status.lastRevalidatedAt ? new Date(status.lastRevalidatedAt).toLocaleString() : "Never"}
          </div>
          {isUnreachable && (
            <div>
              <strong>Re-validation issue</strong>
              <span className="error-text">{status.lastRevalidationError}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="panel">
          <h2>Not activated</h2>
          <p>No license key has been activated on this deployment yet. New agent enrollment is blocked until one is.</p>
        </div>
      )}

      {canActivate ? (
        <form className="panel" onSubmit={handleActivate}>
          <h2>{status?.activated ? "Activate a replacement key" : "Activate a license key"}</h2>
          <label>
            License key
            <input
              type="text"
              value={keyString}
              onChange={(e) => setKeyString(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              required
            />
          </label>
          {activate.isError && <p className="error-text">{(activate.error as Error).message}</p>}
          {activate.isSuccess && <p>License activated.</p>}
          <button type="submit" disabled={activate.isPending || !keyString.trim()}>
            {activate.isPending ? "Activating…" : "Activate"}
          </button>
        </form>
      ) : (
        <div className="panel">
          <h2>Activate a license key</h2>
          <p>Connect to the License Server above first.</p>
        </div>
      )}

      {status?.activated && (
        <form className="panel" onSubmit={handleUnlockRequest}>
          <h2>Request an unlock</h2>
          <p>
            If this deployment is being migrated to new hardware, or the license needs to be re-activated for any
            other reason, send an unlock request to the vendor. A vendor admin reviews and approves it manually
            before the key can be activated again.
          </p>
          <label>
            Reason
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Migrating to new hardware"
              required
            />
          </label>
          {requestUnlock.isError && <p className="error-text">{(requestUnlock.error as Error).message}</p>}
          {unlockSent && !requestUnlock.isError && <p>Unlock request sent — awaiting vendor approval.</p>}
          <button type="submit" disabled={requestUnlock.isPending || !reason.trim()}>
            {requestUnlock.isPending ? "Sending…" : "Send unlock request"}
          </button>
        </form>
      )}
    </div>
  );
}
