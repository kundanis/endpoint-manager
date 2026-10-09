import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type {
  LicenseType,
  SoftwareLicenseAccessType,
  SoftwareLicenseBillingCycle,
  SoftwareLicenseDeploymentType,
  SoftwareLicenseView,
} from "../api/types";
import {
  useCreateSoftwareLicense,
  useDeleteSoftwareLicense,
  useImportSoftwareLicenses,
  useSoftwareLicenses,
  useUpdateSoftwareLicense,
  type SoftwareLicenseInput,
} from "../api/hooks";

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Quote every cell and double up any internal quotes - the only escaping CSV actually
// needs, and safe even for fields without commas/quotes (Excel doesn't care either way).
// Same helper as AgentsPage.tsx's export - duplicated locally per this codebase's existing
// convention of not sharing per-page CSV helpers.
function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

// Column order matches createSoftwareLicenseRequestSchema exactly, so an unedited export
// re-imports cleanly. The last four columns are read-only/computed and ignored on import.
const CSV_HEADERS = [
  "Software Name", "Version", "Vendor", "License Key", "License Type", "Seats Purchased",
  "Purchase Date", "Expiry Date", "Cost", "Billing Cycle", "Deployment Type", "Access Type",
  "User Department", "Notes", "Seats In Use", "Over Compliance", "Yearly Cost", "Created At",
];

function buildLicensesCsv(licenses: SoftwareLicenseView[]): string {
  const rows = licenses.map((l) => [
    l.softwareName,
    l.version ?? "",
    l.vendor ?? "",
    l.licenseKey ?? "",
    l.licenseType,
    l.seatsPurchased,
    l.purchaseDate ? l.purchaseDate.slice(0, 10) : "",
    l.expiryDate ? l.expiryDate.slice(0, 10) : "",
    l.cost ?? "",
    l.billingCycle,
    l.deploymentType ?? "",
    l.accessType ?? "",
    l.userDepartment ?? "",
    l.notes ?? "",
    l.seatsInUse,
    l.overCompliance ? "Yes" : "No",
    l.annualCost ?? "",
    l.createdAt.slice(0, 10),
  ]);
  return [CSV_HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

// A single blank example row so a first-time importer sees the exact expected column
// names and valid enum values without needing an existing license to export first.
function buildLicensesCsvTemplate(): string {
  const example = [
    "Microsoft 365 Apps for business", "", "Microsoft", "", "SUBSCRIPTION", "25",
    "", "2027-03-31", "1499", "MONTHLY", "VENDOR_CLOUD", "INTERNAL", "IT", "",
  ];
  return [CSV_HEADERS.slice(0, 14), example].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

// Minimal RFC4180-ish parser: handles quoted fields (including embedded commas, quotes
// doubled as "", and embedded newlines) and both CRLF/LF line endings - Excel and Google
// Sheets both export in this shape.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r") {
      i++;
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

const IMPORT_COLUMNS: Record<string, keyof SoftwareLicenseInput> = {
  "software name": "softwareName",
  version: "version",
  vendor: "vendor",
  "license key": "licenseKey",
  "license type": "licenseType",
  "seats purchased": "seatsPurchased",
  "purchase date": "purchaseDate",
  "expiry date": "expiryDate",
  cost: "cost",
  "billing cycle": "billingCycle",
  "deployment type": "deploymentType",
  "access type": "accessType",
  "user department": "userDepartment",
  notes: "notes",
};

// Tolerates the human-friendly labels/casing a hand-edited spreadsheet is likely to use
// (e.g. "Half Yearly", "on-premise") rather than requiring the exact enum spelling.
function normalizeEnumValue(v: string | undefined): string {
  return v ? v.trim().toUpperCase().replace(/[\s-]+/g, "_") : "";
}

function csvRowsToLicenseInputs(rows: string[][]): SoftwareLicenseInput[] {
  if (rows.length < 2) {
    throw new Error("The file needs a header row plus at least one data row.");
  }
  const headerRow = rows[0].map((h) => h.trim().toLowerCase());
  const columnFields = headerRow.map((h) => IMPORT_COLUMNS[h]);
  if (!columnFields.includes("softwareName")) {
    throw new Error('Missing required "Software Name" column - check the header row matches the template.');
  }

  const dataRows = rows.slice(1).filter((r) => r.some((cell) => cell.trim() !== ""));

  return dataRows.map((cells, index) => {
    const raw: Partial<Record<string, string>> = {};
    columnFields.forEach((field, i) => {
      if (field) raw[field] = (cells[i] ?? "").trim();
    });

    if (!raw.softwareName) {
      throw new Error(`Row ${index + 2}: "Software Name" is required.`);
    }

    return {
      softwareName: raw.softwareName,
      version: raw.version || null,
      vendor: raw.vendor || null,
      licenseKey: raw.licenseKey || null,
      licenseType: normalizeEnumValue(raw.licenseType) as LicenseType,
      seatsPurchased: raw.seatsPurchased ? Number(raw.seatsPurchased) : 0,
      purchaseDate: raw.purchaseDate || null,
      expiryDate: raw.expiryDate || null,
      cost: raw.cost ? Number(raw.cost) : null,
      billingCycle: raw.billingCycle ? (normalizeEnumValue(raw.billingCycle) as SoftwareLicenseBillingCycle) : undefined,
      deploymentType: raw.deploymentType ? (normalizeEnumValue(raw.deploymentType) as SoftwareLicenseDeploymentType) : null,
      accessType: raw.accessType ? (normalizeEnumValue(raw.accessType) as SoftwareLicenseAccessType) : null,
      userDepartment: raw.userDepartment || null,
      notes: raw.notes || null,
    };
  });
}

const LICENSE_TYPES: LicenseType[] = ["PERPETUAL", "SUBSCRIPTION", "VOLUME", "OEM"];
const BILLING_CYCLES: SoftwareLicenseBillingCycle[] = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"];
const BILLING_CYCLE_LABELS: Record<SoftwareLicenseBillingCycle, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
};
const DEPLOYMENT_TYPES: SoftwareLicenseDeploymentType[] = ["ON_PREMISE", "VENDOR_CLOUD", "SYSTEMATIX_CLOUD", "HYBRID"];
const DEPLOYMENT_TYPE_LABELS: Record<SoftwareLicenseDeploymentType, string> = {
  ON_PREMISE: "On-Premise",
  VENDOR_CLOUD: "Vendor Cloud",
  SYSTEMATIX_CLOUD: "Systematix Cloud",
  HYBRID: "Hybrid",
};
const ACCESS_TYPES: SoftwareLicenseAccessType[] = ["INTERNAL", "PUBLIC", "VPN"];
const ACCESS_TYPE_LABELS: Record<SoftwareLicenseAccessType, string> = {
  INTERNAL: "Internal",
  PUBLIC: "Public",
  VPN: "Over VPN",
};

function formatCost(cost: number | null): string {
  return cost != null ? `₹${cost.toFixed(2)}` : "—";
}

// Explicit dd/mm/yyyy, not toLocaleDateString() — that follows the browser's own locale,
// which isn't guaranteed to be dd/mm/yyyy for every viewer.
function formatExpiryDate(expiryDate: string | null): string {
  if (!expiryDate) return "—";
  const d = new Date(expiryDate);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function SoftwareLicensesPage() {
  const { data: licenses } = useSoftwareLicenses();
  const createLicense = useCreateSoftwareLicense();
  const updateLicense = useUpdateSoftwareLicense();
  const deleteLicense = useDeleteSoftwareLicense();
  const importLicenses = useImportSoftwareLicenses();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a failed attempt
    if (!file) return;
    setImportMessage(null);
    try {
      const rows = parseCsv(await file.text());
      const inputs = csvRowsToLicenseInputs(rows);
      importLicenses.mutate(inputs, {
        onSuccess: (result) => setImportMessage({ kind: "success", text: `Imported ${result.count} license(s).` }),
        onError: (err) => setImportMessage({ kind: "error", text: (err as Error).message }),
      });
    } catch (err) {
      setImportMessage({ kind: "error", text: err instanceof Error ? err.message : "Could not read that file." });
    }
  }

  const [editingId, setEditingId] = useState<string | null>(null);
  const [softwareName, setSoftwareName] = useState("");
  const [version, setVersion] = useState("");
  const [vendor, setVendor] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseType, setLicenseType] = useState<LicenseType>("PERPETUAL");
  const [seatsPurchased, setSeatsPurchased] = useState(1);
  const [seatsInUseOverride, setSeatsInUseOverride] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [cost, setCost] = useState("");
  const [billingCycle, setBillingCycle] = useState<SoftwareLicenseBillingCycle>("YEARLY");
  const [deploymentType, setDeploymentType] = useState<SoftwareLicenseDeploymentType | "">("");
  const [accessType, setAccessType] = useState<SoftwareLicenseAccessType | "">("");
  const [userDepartment, setUserDepartment] = useState("");

  const isEditing = editingId !== null;
  const pending = isEditing ? updateLicense.isPending : createLicense.isPending;
  const mutationError = isEditing ? updateLicense.error : createLicense.error;

  function resetForm() {
    setEditingId(null);
    setSoftwareName("");
    setVersion("");
    setVendor("");
    setLicenseKey("");
    setLicenseType("PERPETUAL");
    setSeatsPurchased(1);
    setSeatsInUseOverride("");
    setExpiryDate("");
    setCost("");
    setBillingCycle("YEARLY");
    setDeploymentType("");
    setAccessType("");
    setUserDepartment("");
  }

  function startEdit(license: SoftwareLicenseView) {
    setEditingId(license.id);
    setSoftwareName(license.softwareName);
    setVersion(license.version ?? "");
    setVendor(license.vendor ?? "");
    setLicenseKey(license.licenseKey ?? "");
    setLicenseType(license.licenseType);
    setSeatsPurchased(license.seatsPurchased);
    setSeatsInUseOverride(license.seatsInUseOverride != null ? String(license.seatsInUseOverride) : "");
    setExpiryDate(license.expiryDate ? license.expiryDate.slice(0, 10) : "");
    setCost(license.cost != null ? String(license.cost) : "");
    setBillingCycle(license.billingCycle);
    setDeploymentType(license.deploymentType ?? "");
    setAccessType(license.accessType ?? "");
    setUserDepartment(license.userDepartment ?? "");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      softwareName,
      version: version.trim() || null,
      vendor: vendor.trim() || null,
      licenseKey: licenseKey.trim() || null,
      licenseType,
      seatsPurchased,
      seatsInUseOverride: seatsInUseOverride.trim() ? Number(seatsInUseOverride) : null,
      expiryDate: expiryDate || null,
      cost: cost ? Number(cost) : null,
      billingCycle,
      deploymentType: deploymentType || null,
      accessType: accessType || null,
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

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => downloadTextFile("software-licenses.csv", buildLicensesCsv(licenses ?? []))}
          disabled={!licenses || licenses.length === 0}
        >
          Export to CSV
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importLicenses.isPending}>
          {importLicenses.isPending ? "Importing…" : "Import from CSV"}
        </button>
        <button type="button" onClick={() => downloadTextFile("software-licenses-template.csv", buildLicensesCsvTemplate())}>
          Download template
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleImportFile}
          style={{ display: "none" }}
        />
      </div>
      {importMessage && (
        <p className={importMessage.kind === "error" ? "error-text" : "hint"}>{importMessage.text}</p>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Software</th>
            <th>Version</th>
            <th>Vendor</th>
            <th>Type</th>
            <th>Seats (purchased / in use)</th>
            <th>EXPIRY (dd/mm/yyyy)</th>
            <th>Cost</th>
            <th>Yearly cost</th>
            <th>Deployment type</th>
            <th>Access type</th>
            <th>User department</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {licenses?.map((l) => (
            <tr key={l.id} className={l.id === editingId ? "selected-row" : ""}>
              <td>{l.softwareName}</td>
              <td>{l.version ?? "—"}</td>
              <td>{l.vendor ?? "—"}</td>
              <td>{l.licenseType}</td>
              <td>
                <span title={l.seatsInUseOverride != null ? "Manually set" : "Auto-detected from installed software"}>
                  {l.seatsPurchased}/{l.seatsInUse}
                </span>{" "}
                {l.overCompliance && <span className="status-badge danger">Over</span>}
              </td>
              <td>{formatExpiryDate(l.expiryDate)}</td>
              <td>
                {formatCost(l.cost)}
                {l.cost != null && ` / ${BILLING_CYCLE_LABELS[l.billingCycle]}`}
              </td>
              <td>{formatCost(l.annualCost)}</td>
              <td>{l.deploymentType ? DEPLOYMENT_TYPE_LABELS[l.deploymentType] : "—"}</td>
              <td>{l.accessType ? ACCESS_TYPE_LABELS[l.accessType] : "—"}</td>
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
              <td colSpan={12}>No software licenses recorded yet.</td>
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
          Version
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="e.g. 2024, 16.0.1"
          />
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
          Seats in use (optional override)
          <input
            type="number"
            min={0}
            value={seatsInUseOverride}
            onChange={(e) => setSeatsInUseOverride(e.target.value)}
            placeholder="Auto-detected from installed software"
          />
        </label>
        <p className="hint">
          Leave blank to keep the automatic estimate (matched against installed software across the fleet). Set a
          number here to use that instead — useful when the automatic match doesn't fit, or this license's usage
          isn't tracked via installed software at all. Clear it later to go back to automatic.
        </p>
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
          <select
            value={deploymentType}
            onChange={(e) => setDeploymentType(e.target.value as SoftwareLicenseDeploymentType | "")}
          >
            <option value="">—</option>
            {DEPLOYMENT_TYPES.map((d) => (
              <option key={d} value={d}>
                {DEPLOYMENT_TYPE_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Access type
          <select
            value={accessType}
            onChange={(e) => setAccessType(e.target.value as SoftwareLicenseAccessType | "")}
          >
            <option value="">—</option>
            {ACCESS_TYPES.map((a) => (
              <option key={a} value={a}>
                {ACCESS_TYPE_LABELS[a]}
              </option>
            ))}
          </select>
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
