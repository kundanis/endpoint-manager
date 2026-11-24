import FeatureTree, { featureSummary, selectionOf, type LicenseSelection } from "../components/FeatureTree";
import { useState, type FormEvent } from "react";
import type { LicenseModule, LicenseProduct, ValidityType } from "@license/shared";
import { useEntities, useIssueLicenseKey, useLicenseKeys, useRevokeLicenseKey } from "../api/hooks";
import type { IssuedLicenseKey } from "../api/types";
import ChangeRequestPanel from "../components/ChangeRequestPanel";

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
// INTERVAL_SEC) - keep these in sync with common.schema.ts's LICENSE_MODULES and
// LICENSE_PRODUCTS by hand.
const PRODUCT_LABELS: Record<LicenseProduct, string> = {
  ENDPOINT_ONE: "Endpoint One",
  ENDPOINT_IQ: "Endpoint IQ",
};

// Both products license the same module keys; each shows them under its own names.
// Endpoint IQ's names match its console menu (endpoint-manager packages/console/src/navConfig.ts).
const MODULE_LABELS: Record<LicenseProduct, Record<LicenseModule, string>> = {
  ENDPOINT_ONE: {
    ENDPOINT_MANAGER: "Endpoint Manager",
    NETWORK_MANAGER: "Network Manager",
    SOFTWARE_MANAGER: "Software Manager",
    SECURITY_MANAGER: "Security Manager",
    DATA_MANAGER: "Data Manager",
    USER_MANAGER: "User Manager",
    THREAT_PROTECTION: "Threat Protection",
    AI_GUARD: "AI Guard",
  },
  ENDPOINT_IQ: {
    ENDPOINT_MANAGER: "Endpoint Hub",
    NETWORK_MANAGER: "Network Insight",
    SOFTWARE_MANAGER: "App Center",
    SECURITY_MANAGER: "Security Posture",
    DATA_MANAGER: "Data Governance",
    USER_MANAGER: "Identity Governance",
    THREAT_PROTECTION: "Threat Protection",
    AI_GUARD: "AI Guard",
  },
};

// One-line hint under each Endpoint IQ module, from the Endpoint IQ module-wise feature guide.
const IQ_MODULE_HINTS: Record<LicenseModule, string> = {
  ENDPOINT_MANAGER: "Endpoints, enrollment, commands, packages, agent updates, asset settings",
  NETWORK_MANAGER: "Network discovery of managed and unmanaged devices",
  SOFTWARE_MANAGER: "Software licence compliance",
  SECURITY_MANAGER: "Vulnerabilities, patches, security configuration, Zero Trust, threat detection",
  DATA_MANAGER: "Data types, data discovery, DLP, data movement, EPM, access exceptions",
  USER_MANAGER: "User productivity, user risk, admin logs",
  THREAT_PROTECTION: "Microsoft Defender management, threats, scans and quarantine (also sold as its own edition)",
  AI_GUARD: "Generative-AI discovery and control: which AI tools are used, by whom, and which are allowed or blocked",
};

const LICENSE_MODULES = Object.keys(MODULE_LABELS.ENDPOINT_ONE) as LicenseModule[];
// Threat Protection and AI Guard are sold separately, so a new key starts without them (tick to add).
const DEFAULT_MODULES = LICENSE_MODULES.filter((m) => m !== "THREAT_PROTECTION" && m !== "AI_GUARD");

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
  const [product, setProduct] = useState<LicenseProduct>("ENDPOINT_IQ");
  const [maxAgents, setMaxAgents] = useState(10);
  const [validityType, setValidityType] = useState<ValidityType>("ONE_YEAR");
  const [selection, setSelection] = useState<LicenseSelection>(() => selectionOf([...DEFAULT_MODULES], null));
  const modules = selection.modules;
  const [justIssued, setJustIssued] = useState<IssuedLicenseKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [changingKeyId, setChangingKeyId] = useState<string | null>(null);
  const changingKey = keys?.find((k) => k.id === changingKeyId) ?? null;

  function handleIssue(e: FormEvent) {
    e.preventDefault();
    issueKey.mutate(
      { entityId, product, maxAgents, validityType, modules, features: selection.features },
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
      <p>
        Each key locks to exactly one Endpoint One or Endpoint IQ deployment on first activation. Activated deployments
        don't check back in: revoking a key sends the deployment a revoke notice, and Change sends it a change
        request that the customer accepts or rejects.
      </p>

      {justIssued && (
        <div className="panel">
          <h2>
            {PRODUCT_LABELS[justIssued.product]} key issued for "{justIssued.entity.name}"
          </h2>
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
            <th>Product</th>
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
              <td>{PRODUCT_LABELS[k.product]}</td>
              <td className="mono-cell">…{k.keySuffix}</td>
              <td>{k.maxAgents}</td>
              <td>{VALIDITY_LABELS[k.validityType]}</td>
              <td>
                {k.modules.length === LICENSE_MODULES.length && k.features === null
                  ? "All"
                  : featureSummary(k.modules, k.features, (m) => MODULE_LABELS[k.product][m]) || "None"}
              </td>
              <td>{k.validUntil ? new Date(k.validUntil).toLocaleDateString() : "—"}</td>
              <td>
                <span className={`status-badge ${statusBadgeClass(k.status)}`}>{k.status}</span>
                {k.status === "REVOKED" && k.boundDeploymentId && (
                  <div className="module-hint" title={k.revokeNoticeLastError ?? undefined}>
                    {k.revokeNoticeDeliveredAt
                      ? `Deployment notified ${new Date(k.revokeNoticeDeliveredAt).toLocaleString()}`
                      : "Notice pending - retrying every 5 min"}
                  </div>
                )}
              </td>
              <td>{k.boundDeploymentId ?? "—"}</td>
              <td>
                {k.status === "ACTIVATED" && (
                  <>
                    <button type="button" onClick={() => setChangingKeyId(k.id)}>
                      Change…
                    </button>{" "}
                  </>
                )}
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
              <td colSpan={10}>No license keys issued yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {changingKey && (
        <ChangeRequestPanel
          key={changingKey.id}
          licenseKey={changingKey}
          allModules={LICENSE_MODULES}
          moduleLabels={MODULE_LABELS[changingKey.product]}
          onClose={() => setChangingKeyId(null)}
        />
      )}

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
          Product
          <select value={product} onChange={(e) => setProduct(e.target.value as LicenseProduct)}>
            {Object.entries(PRODUCT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
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
          <legend>{PRODUCT_LABELS[product]} modules and features included</legend>
          <FeatureTree
            allModules={LICENSE_MODULES}
            moduleLabel={(m) => MODULE_LABELS[product][m]}
            moduleHint={(m) => (product === "ENDPOINT_IQ" ? IQ_MODULE_HINTS[m] : null)}
            value={selection}
            onChange={setSelection}
          />
          <p className="module-hint">
            Ticking a module includes all its features; untick the ones not sold. In the customer's console a module
            that isn't licensed is hidden, and a feature that isn't licensed shows as locked.
          </p>
          {product === "ENDPOINT_IQ" && (
            <p className="module-hint">Dashboard, Licensing and Administrators are always included.</p>
          )}
        </fieldset>
        {issueKey.isError && <p className="error-text">{(issueKey.error as Error).message}</p>}
        <button type="submit" disabled={issueKey.isPending || !entityId || modules.length === 0}>
          {issueKey.isPending ? "Issuing…" : "Issue key"}
        </button>
      </form>
    </div>
  );
}
