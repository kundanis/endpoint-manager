import { useState, type FormEvent } from "react";
import type { LicenseModule, ValidityType } from "@license/shared";
import { useEntities, useIssueLicenseKey, useLicenseKeys, useRevokeLicenseKey } from "../api/hooks";
import type { IssuedLicenseKey } from "../api/types";

const VALIDITY_LABELS: Record<ValidityType, string> = {
  ONE_YEAR: "1 year",
  TWO_YEAR: "2 years",
  THREE_YEAR: "3 years",
  PERPETUAL: "Perpetual",
};

// Hardcoded, not imported as a runtime value from @license/shared - that package
// compiles to CommonJS, and Vite/Rollup's CJS-interop analysis can't statically resolve
// a raw runtime export (const array) through it, only `import type`. Same landmine
// already hit and fixed this way for @em/shared in the main console (DEFAULT_POLL_
// INTERVAL_SEC) - keep these six in sync with common.schema.ts's LICENSE_MODULES by hand.
const MODULE_LABELS: Record<LicenseModule, string> = {
  ENDPOINT_MANAGER: "Endpoint Manager",
  NETWORK_MANAGER: "Network Manager",
  SOFTWARE_MANAGER: "Software Manager",
  SECURITY_MANAGER: "Security Manager",
  DATA_MANAGER: "Data Manager",
  USER_MANAGER: "User Manager",
};
const LICENSE_MODULES = Object.keys(MODULE_LABELS) as LicenseModule[];

function statusBadgeClass(status: string): string {
  if (status === "ACTIVATED") return "online";
  if (status === "REVOKED") return "danger";
  return "offline";
}

export default function LicenseKeysPage() {
  const { data: entities } = useEntities();
  const { data: keys } = useLicenseKeys();
  const issueKey = useIssueLicenseKey();
  const revokeKey = useRevokeLicenseKey();

  const [entityId, setEntityId] = useState("");
  const [maxAgents, setMaxAgents] = useState(10);
  const [validityType, setValidityType] = useState<ValidityType>("ONE_YEAR");
  const [modules, setModules] = useState<LicenseModule[]>([...LICENSE_MODULES]);
  const [justIssued, setJustIssued] = useState<IssuedLicenseKey | null>(null);
  const [copied, setCopied] = useState(false);

  function toggleModule(m: LicenseModule) {
    setModules((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  function handleIssue(e: FormEvent) {
    e.preventDefault();
    issueKey.mutate(
      { entityId, maxAgents, validityType, modules },
      {
        onSuccess: (result) => {
          setJustIssued(result);
          setCopied(false);
        },
      },
    );
  }

  function handleCopy(keyString: string) {
    navigator.clipboard.writeText(keyString).then(() => setCopied(true));
  }

  return (
    <div>
      <h1>License Keys</h1>
      <p>Each key locks to exactly one Endpoint Manager deployment on first activation.</p>

      {justIssued && (
        <div className="panel">
          <h2>Key issued for "{justIssued.entity.name}"</h2>
          <p className="error-text">
            This is the only time the full key value is shown — copy it now and deliver it to the customer securely.
            After this, only the last 4 characters ({justIssued.keySuffix}) remain visible.
          </p>
          <p className="mono-cell">{justIssued.keyString}</p>
          <button type="button" onClick={() => handleCopy(justIssued.keyString)}>
            {copied ? "Copied" : "Copy to clipboard"}
          </button>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Entity</th>
            <th>Key (suffix)</th>
            <th>Max agents</th>
            <th>Validity</th>
            <th>Modules</th>
            <th>Valid until</th>
            <th>Status</th>
            <th>Bound deployment</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {keys?.map((k) => (
            <tr key={k.id}>
              <td>{k.entity.name}</td>
              <td className="mono-cell">…{k.keySuffix}</td>
              <td>{k.maxAgents}</td>
              <td>{VALIDITY_LABELS[k.validityType]}</td>
              <td>
                {k.modules.length === LICENSE_MODULES.length
                  ? "All"
                  : k.modules.map((m) => MODULE_LABELS[m]).join(", ") || "None"}
              </td>
              <td>{k.validUntil ? new Date(k.validUntil).toLocaleDateString() : "—"}</td>
              <td>
                <span className={`status-badge ${statusBadgeClass(k.status)}`}>{k.status}</span>
              </td>
              <td>{k.boundDeploymentId ?? "—"}</td>
              <td>
                <button
                  type="button"
                  onClick={() => revokeKey.mutate(k.id)}
                  disabled={k.status === "REVOKED" || revokeKey.isPending}
                >
                  Revoke
                </button>
              </td>
            </tr>
          ))}
          {keys?.length === 0 && (
            <tr>
              <td colSpan={9}>No license keys issued yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="panel" onSubmit={handleIssue}>
        <h2>Issue a new key</h2>
        <label>
          Entity
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)} required>
            <option value="" disabled>
              Select an entity…
            </option>
            {entities?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Max agents (fleet-wide cap)
          <input type="number" min={1} value={maxAgents} onChange={(e) => setMaxAgents(Number(e.target.value))} required />
        </label>
        <label>
          Validity
          <select value={validityType} onChange={(e) => setValidityType(e.target.value as ValidityType)}>
            {Object.entries(VALIDITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Modules included</legend>
          {LICENSE_MODULES.map((m) => (
            <label key={m} className="checkbox-row">
              <input type="checkbox" checked={modules.includes(m)} onChange={() => toggleModule(m)} />
              {MODULE_LABELS[m]}
            </label>
          ))}
        </fieldset>
        {issueKey.isError && <p className="error-text">{(issueKey.error as Error).message}</p>}
        <button type="submit" disabled={issueKey.isPending || !entityId || modules.length === 0}>
          {issueKey.isPending ? "Issuing…" : "Issue key"}
        </button>
      </form>
    </div>
  );
}
