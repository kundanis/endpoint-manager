import { useState, type FormEvent } from "react";
import type { LicenseModule } from "@license/shared";
import { useCancelLicenseChangeRequest, useCreateLicenseChangeRequest, useLicenseChangeRequests } from "../api/hooks";
import type { LicenseChangeRequestItem, LicenseKeyListItem, LicenseTermsView } from "../api/types";
import FeatureTree, { featureSummary, selectionOf, type LicenseSelection } from "./FeatureTree";
import { featureChanges } from "../../../license-shared/src/featureCatalog";

// Changing an ACTIVATED key: the change is pushed to the customer's server, whose admin accepts
// or rejects it there. Additions only apply when accepted; a reduction applies by itself after
// 15 days (keep in sync with REDUCTION_AUTO_APPLY_DAYS in @license/shared - a runtime value
// can't be imported here, see LicenseKeysPage).
const REDUCTION_DAYS = 15;

const STATUS_LABELS: Record<LicenseChangeRequestItem["status"], string> = {
  PENDING: "Waiting for customer",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  AUTO_APPLIED: "Applied automatically",
  CANCELLED: "Cancelled",
};

function dateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function describe(t: LicenseTermsView, labels: Record<LicenseModule, string>): string {
  const until = t.validUntil ? new Date(t.validUntil).toLocaleDateString() : "perpetual";
  return `${t.maxAgents} endpoints · until ${until} · ${featureSummary(t.modules, t.features ?? null, (m) => labels[m])}`;
}

// Same rule as the License Server's classifyChange: anything taken away makes it a reduction.
function classify(cur: LicenseTermsView, next: LicenseTermsView): "ADDITION" | "REDUCTION" | null {
  const a = cur.validUntil ? Date.parse(cur.validUntil) : Infinity;
  const b = next.validUntil ? Date.parse(next.validUntil) : Infinity;
  const { added, removed } = featureChanges(cur, next);
  const reduced = cur.modules.some((m) => !next.modules.includes(m)) || removed.length > 0 || next.maxAgents < cur.maxAgents || b < a;
  const gained = next.modules.some((m) => !cur.modules.includes(m)) || added.length > 0 || next.maxAgents > cur.maxAgents || b > a;
  return reduced ? "REDUCTION" : gained ? "ADDITION" : null;
}

export default function ChangeRequestPanel({
  licenseKey,
  allModules,
  moduleLabels,
  onClose,
}: {
  licenseKey: LicenseKeyListItem;
  allModules: LicenseModule[];
  moduleLabels: Record<LicenseModule, string>;
  onClose: () => void;
}) {
  const { data: requests } = useLicenseChangeRequests(licenseKey.id);
  const create = useCreateLicenseChangeRequest();
  const cancel = useCancelLicenseChangeRequest();

  const [selection, setSelection] = useState<LicenseSelection>(() => selectionOf(licenseKey.modules, licenseKey.features));
  const modules = selection.modules;
  const [maxAgents, setMaxAgents] = useState(licenseKey.maxAgents);
  const [perpetual, setPerpetual] = useState(licenseKey.validUntil === null);
  const [validUntil, setValidUntil] = useState(dateInput(licenseKey.validUntil));
  const [message, setMessage] = useState("");

  const current: LicenseTermsView = {
    maxAgents: licenseKey.maxAgents,
    validityType: licenseKey.validityType,
    validUntil: licenseKey.validUntil,
    modules: licenseKey.modules,
    features: licenseKey.features,
  };
  // End of the chosen day, so "valid until 31/03" includes that whole day.
  const proposedUntil = perpetual || !validUntil ? null : new Date(`${validUntil}T23:59:59Z`).toISOString();
  const proposed: LicenseTermsView = { ...current, maxAgents, modules, features: selection.features, validUntil: perpetual ? null : proposedUntil };
  const kind = !perpetual && !validUntil ? null : classify(current, proposed);
  const pending = requests?.find((r) => r.status === "PENDING");

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ licenseKeyId: licenseKey.id, modules, features: selection.features, maxAgents, validUntil: proposed.validUntil, message: message.trim() || undefined });
  }

  return (
    <div className="panel">
      <h2>
        Change licence: {licenseKey.entity.name} (…{licenseKey.keySuffix})
      </h2>
      <p>
        The change is sent to the customer's server, where their administrator sees what changes and accepts or rejects
        it. <b>Additions</b> (modules, endpoints, a later end date) only apply when accepted. <b>Reductions</b> (anything
        removed or lowered) can be accepted or rejected, but apply by themselves after {REDUCTION_DAYS} days.
      </p>
      <p className="module-hint">Current: {describe(current, moduleLabels)}</p>

      <form onSubmit={submit}>
        <fieldset>
          <legend>Modules and features</legend>
          <FeatureTree
            allModules={allModules}
            moduleLabel={(m) => moduleLabels[m]}
            value={selection}
            onChange={setSelection}
            compareTo={selectionOf(licenseKey.modules, licenseKey.features)}
          />
        </fieldset>
        <label>
          Max agents
          <input type="number" min={1} value={maxAgents} onChange={(e) => setMaxAgents(Number(e.target.value))} required />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={perpetual} onChange={(e) => setPerpetual(e.target.checked)} />
          Perpetual (no end date)
        </label>
        {!perpetual && (
          <label>
            Valid until
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} required />
          </label>
        )}
        <label>
          Message to the customer (optional)
          <textarea rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>

        {kind === null ? (
          <p className="module-hint">Change at least one value.</p>
        ) : kind === "ADDITION" ? (
          <p className="module-hint">Addition: applies only if the customer accepts.</p>
        ) : (
          <p className="error-text">
            Reduction: the customer can accept or reject, but it applies automatically after {REDUCTION_DAYS} days.
          </p>
        )}
        {pending && <p className="module-hint">Sending this replaces the request still waiting for the customer.</p>}
        {create.isError && <p className="error-text">{(create.error as Error).message}</p>}
        <button type="submit" disabled={create.isPending || kind === null || modules.length === 0}>
          {create.isPending ? "Sending…" : "Send to customer"}
        </button>{" "}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </form>

      <h2>Requests</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Sent</th>
            <th>Change</th>
            <th>Status</th>
            <th>Delivery</th>
            <th>Customer's reason</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requests?.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.createdAt).toLocaleString()}</td>
              <td>
                <b>{r.kind === "ADDITION" ? "Addition" : "Reduction"}</b>
                <div className="module-hint">From: {describe(r.current, moduleLabels)}</div>
                <div className="module-hint">To: {describe(r.proposed, moduleLabels)}</div>
                {r.message && <div className="module-hint">Message: {r.message}</div>}
              </td>
              <td>
                {STATUS_LABELS[r.status]}
                {r.kind === "REDUCTION" && r.autoApplyAt && (r.status === "PENDING" || r.status === "REJECTED") && (
                  <div className="module-hint">Applies automatically {new Date(r.autoApplyAt).toLocaleDateString()}</div>
                )}
              </td>
              <td title={r.lastDeliveryError ?? undefined}>
                {r.delivered
                  ? `Delivered${r.deliveredAt ? ` ${new Date(r.deliveredAt).toLocaleString()}` : ""}`
                  : r.lastDeliveryError
                    ? "Not delivered - retrying every 5 min (the customer can also use Check for licence requests)"
                    : "Sending…"}
              </td>
              <td>{r.responseReason ?? "—"}</td>
              <td>
                {r.status === "PENDING" && (
                  <button type="button" onClick={() => cancel.mutate(r.id)} disabled={cancel.isPending}>
                    Cancel
                  </button>
                )}
              </td>
            </tr>
          ))}
          {requests?.length === 0 && (
            <tr>
              <td colSpan={6}>No change requests for this key yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
