import { useState, type FormEvent } from "react";
import type { LicenseType, SoftwareLicenseBillingCycle, SoftwareLicenseView } from "../api/types";
import {
  useCreateSoftwareLicense,
  useDeleteSoftwareLicense,
  useSoftwareLicenses,
  useUpdateSoftwareLicense,
} from "../api/hooks";

const LICENSE_TYPES: LicenseType[] = ["PERPETUAL", "SUBSCRIPTION", "VOLUME", "OEM"];
const BILLING_CYCLES: SoftwareLicenseBillingCycle[] = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"];
const BILLING_CYCLE_LABELS: Record<SoftwareLicenseBillingCycle, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
};

function formatCost(cost: number | null): string {
  return cost != null ? `₹${cost.toFixed(2)}` : "—";
}

export default function SoftwareLicensesPage() {
  const { data: licenses } = useSoftwareLicenses();
  const createLicense = useCreateSoftwareLicense();
  const updateLicense = useUpdateSoftwareLicense();
  const deleteLicense = useDeleteSoftwareLicense();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [softwareName, setSoftwareName] = useState("");
  const [vendor, setVendor] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseType, setLicenseType] = useState<LicenseType>("PERPETUAL");
  const [seatsPurchased, setSeatsPurchased] = useState(1);
  const [expiryDate, setExpiryDate] = useState("");
  const [cost, setCost] = useState("");
  const [billingCycle, setBillingCycle] = useState<SoftwareLicenseBillingCycle>("YEARLY");
  const [deploymentType, setDeploymentType] = useState("");
  const [userDepartment, setUserDepartment] = useState("");

  const isEditing = editingId !== null;
  const pending = isEditing ? updateLicense.isPending : createLicense.isPending;
  const mutationError = isEditing ? updateLicense.error : createLicense.error;

  function resetForm() {
    setEditingId(null);
    setSoftwareName("");
    setVendor("");
    setLicenseKey("");
    setLicenseType("PERPETUAL");
    setSeatsPurchased(1);
    setExpiryDate("");
    setCost("");
    setBillingCycle("YEARLY");
    setDeploymentType("");
    setUserDepartment("");
  }

  function startEdit(license: SoftwareLicenseView) {
    setEditingId(license.id);
    setSoftwareName(license.softwareName);
    setVendor(license.vendor ?? "");
    setLicenseKey(license.licenseKey ?? "");
    setLicenseType(license.licenseType);
    setSeatsPurchased(license.seatsPurchased);
    setExpiryDate(license.expiryDate ? license.expiryDate.slice(0, 10) : "");
    setCost(license.cost != null ? String(license.cost) : "");
    setBillingCycle(license.billingCycle);
    setDeploymentType(license.deploymentType ?? "");
    setUserDepartment(license.userDepartment ?? "");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      softwareName,
      vendor: vendor.trim() || null,
      licenseKey: licenseKey.trim() || null,
      licenseType,
      seatsPurchased,
      expiryDate: expiryDate || null,
      cost: cost ? Number(cost) : null,
      billingCycle,
      deploymentType: deploymentType.trim() || null,
      userDepartment: userDepartment.trim() || null,
    };
    if (editingId) {
      updateLicense.mutate({ id: editingId, ...body }, { onSuccess: resetForm });
    } else {
      createLicense.mutate(body, { onSuccess: resetForm });
    }
  }

  return (
    <div>
      <h1>Software licenses</h1>

      <table className="data-table">
        <thead>
          <tr>
            <th>Software</th>
            <th>Vendor</th>
            <th>Type</th>
            <th>Seats (purchased / in use)</th>
            <th>Expiry</th>
            <th>Cost</th>
            <th>Yearly cost</th>
            <th>Deployment type</th>
            <th>User department</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {licenses?.map((l) => (
            <tr key={l.id} className={l.id === editingId ? "selected-row" : ""}>
              <td>{l.softwareName}</td>
              <td>{l.vendor ?? "—"}</td>
              <td>{l.licenseType}</td>
              <td>
                {l.seatsPurchased} / {l.seatsInUse}{" "}
                {l.overCompliance && <span className="status-badge danger">Over</span>}
              </td>
              <td>{l.expiryDate ? new Date(l.expiryDate).toLocaleDateString() : "—"}</td>
              <td>
                {formatCost(l.cost)}
                {l.cost != null && ` / ${BILLING_CYCLE_LABELS[l.billingCycle]}`}
              </td>
              <td>{formatCost(l.annualCost)}</td>
              <td>{l.deploymentType ?? "—"}</td>
              <td>{l.userDepartment ?? "—"}</td>
              <td>
                <button type="button" onClick={() => startEdit(l)}>
                  Edit
                </button>{" "}
                <button type="button" onClick={() => deleteLicense.mutate(l.id)} disabled={deleteLicense.isPending}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {licenses?.length === 0 && (
            <tr>
              <td colSpan={10}>No software licenses recorded yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="panel" onSubmit={handleSubmit}>
        <h2>{isEditing ? "Edit license" : "Add license"}</h2>
        <label>
          Software name
          <input type="text" value={softwareName} onChange={(e) => setSoftwareName(e.target.value)} required />
        </label>
        <label>
          Vendor
          <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </label>
        <label>
          License key
          <input type="text" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} />
        </label>
        <label>
          License type
          <select value={licenseType} onChange={(e) => setLicenseType(e.target.value as LicenseType)}>
            {LICENSE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Seats purchased
          <input
            type="number"
            min={0}
            value={seatsPurchased}
            onChange={(e) => setSeatsPurchased(Number(e.target.value))}
          />
        </label>
        <label>
          Expiry date
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </label>
        <label>
          Cost (₹)
          <input type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
        <label>
          Billing cycle
          <select
            value={billingCycle}
            onChange={(e) => setBillingCycle(e.target.value as SoftwareLicenseBillingCycle)}
          >
            {BILLING_CYCLES.map((c) => (
              <option key={c} value={c}>
                {BILLING_CYCLE_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          Enter the cost for one billing cycle (e.g. one month if Monthly) — the yearly total is calculated
          automatically.
        </p>
        <label>
          Deployment type
          <input
            type="text"
            value={deploymentType}
            onChange={(e) => setDeploymentType(e.target.value)}
            placeholder="e.g. On-Premise, Cloud, Hybrid"
          />
        </label>
        <label>
          User department
          <input
            type="text"
            value={userDepartment}
            onChange={(e) => setUserDepartment(e.target.value)}
            placeholder="e.g. Finance, IT, Sales"
          />
        </label>
        {mutationError && <p className="error-text">{(mutationError as Error).message}</p>}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="submit" disabled={pending || !softwareName.trim()}>
            {pending ? "Saving…" : isEditing ? "Save changes" : "Add license"}
          </button>
          {isEditing && (
            <button type="button" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
