import { useEffect, useState, type FormEvent } from "react";
import {
  useActivateLicense,
  useLicenseServerConfig,
  useLicenseStatus,
  useMe,
  useModuleVisibility,
  useRequestLicenseUnlock,
  useSetLicenseServerConfig,
  useSetModuleVisibility,
  useTestLicenseServerConnection,
} from "../api/hooks";
import { NAV_MODULES } from "../navConfig";

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

// Org-wide "hide this for everyone" panel — a third, most-authoritative layer on top of
// what the license includes (above) and per-admin grants (Administrators page). Editable
// by SUPER_ADMIN only (server-enforced on the PUT regardless of this UI check), read-only
// note shown to a plain ADMIN instead since they could otherwise hide something out from
// under other admins including super admins.
function ModuleVisibilityPanel() {
  const { data: me } = useMe();
  const { data: visibility, isLoading } = useModuleVisibility();
  const setVisibility = useSetModuleVisibility();

  const [hiddenModuleKeys, setHiddenModuleKeys] = useState<string[]>([]);
  const [hiddenItemPaths, setHiddenItemPaths] = useState<string[]>([]);

  useEffect(() => {
    if (visibility) {
      setHiddenModuleKeys(visibility.hiddenModuleKeys);
      setHiddenItemPaths(visibility.hiddenItemPaths);
    }
  }, [visibility]);

  const hideableModules = NAV_MODULES.filter((m) => m.licenseModule && m.items);

  function toggleModule(key: string) {
    setHiddenModuleKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function toggleItem(path: string) {
    setHiddenItemPaths((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  }

  function handleSave() {
    setVisibility.mutate({ hiddenModuleKeys, hiddenItemPaths });
  }

  if (isLoading) return null;

  if (me?.role !== "SUPER_ADMIN") {
    return (
      <div className="panel">
        <h2>Module visibility</h2>
        <p className="hint">Only a super admin can hide/unhide modules. Ask one to change this if needed.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Module visibility</h2>
      <p>
        Hide a main module or an individual item within it for <strong>every</strong> admin on this deployment —
        this is stronger than license modules or per-admin access above/in Administrators: a hidden module or item
        disappears from the menu and its page for everyone, including super admins, and (for a whole main module)
        its underlying API is blocked too, not just the menu.
      </p>

      {hideableModules.map((module) => {
        const moduleHidden = hiddenModuleKeys.includes(module.licenseModule!);
        return (
          <fieldset key={module.key} style={{ marginBottom: "0.75rem" }}>
            <legend>
              <label style={{ fontWeight: "bold" }}>
                <input type="checkbox" checked={moduleHidden} onChange={() => toggleModule(module.licenseModule!)} />{" "}
                Hide {module.label} entirely
              </label>
            </legend>
            {!moduleHidden &&
              module.items!.map((item) => (
                <label key={item.path} style={{ display: "block", fontWeight: "normal" }}>
                  <input
                    type="checkbox"
                    checked={hiddenItemPaths.includes(item.path)}
                    onChange={() => toggleItem(item.path)}
                  />{" "}
                  Hide {item.label}
                </label>
              ))}
          </fieldset>
        );
      })}

      {setVisibility.isError && <p className="error-text">{(setVisibility.error as Error).message}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <button type="button" onClick={handleSave} disabled={setVisibility.isPending}>
          {setVisibility.isPending ? "Saving…" : "Save changes"}
        </button>
        {setVisibility.isSuccess && <span style={{ color: "var(--online)", fontSize: "0.85rem" }}>Saved</span>}
      </div>
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
      <ModuleVisibilityPanel />

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
            <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
              Paused endpoints still count here — pausing releases policy enforcement, not the seat.
            </div>
          </div>
          <div>
            <strong>Total ever uninstalled</strong>
            {status.totalAgentsUninstalled ?? 0}
            <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
              Lifetime count of seats released back by uninstalling — not currently-active usage.
            </div>
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
