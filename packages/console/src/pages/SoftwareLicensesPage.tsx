import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Download, FileDown, KeyRound, Pencil, Plus, SearchX, Trash2, TriangleAlert, Upload, Users, Wallet } from "lucide-react";
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
  Kpi,
  KpiStrip,
  PageHeader,
  Pagination,
  RowMenu,
  SearchInput,
  Segmented,
  Skeleton,
  Toolbar,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { CHART_SEMANTIC } from "../chartTheme";
import { downloadCsv } from "../csv";
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

// Column order matches createSoftwareLicenseRequestSchema exactly, so an unedited export
// re-imports cleanly. The last four columns are read-only/computed and ignored on import.
const CSV_HEADERS = [
  "Software Name", "Version", "Vendor", "License Key", "License Type", "Seats Purchased",
  "Purchase Date", "Expiry Date", "Cost", "Billing Cycle", "Deployment Type", "Access Type",
  "User Department", "Notes", "Seats In Use", "Over Compliance", "Yearly Cost", "Created At",
];

// Exported with the shared downloadCsv (../csv), which puts an apostrophe before any cell
// that starts like a spreadsheet formula (= + - @ tab CR) so Excel shows it as text;
// csvRowsToLicenseInputs strips that apostrophe again, so an export still re-imports as-is.
function buildLicensesCsv(licenses: SoftwareLicenseView[]): (string | number)[][] {
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
  return rows;
}

// A single blank example row so a first-time importer sees the exact expected column
// names and valid enum values without needing an existing license to export first.
function buildLicensesCsvTemplate(): string[][] {
  const example = [
    "Microsoft 365 Apps for business", "", "Microsoft", "", "SUBSCRIPTION", "25",
    "", "2027-03-31", "1499", "MONTHLY", "VENDOR_CLOUD", "INTERNAL", "IT", "",
  ];
  return [example];
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

// Undoes the export's formula neutralisation ('=x -> =x). Only ever stored as text here.
function unneutralizeCsvCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
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
      if (field) raw[field] = unneutralizeCsvCell((cells[i] ?? "").trim());
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
  SYSTEMATIX_CLOUD: "In-house cloud",
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

// Display labels for the license-type enum; the stored/exported value is unchanged.
const LICENSE_TYPE_LABELS: Record<LicenseType, string> = {
  PERPETUAL: "Perpetual",
  SUBSCRIPTION: "Subscription",
  VOLUME: "Volume",
  OEM: "OEM",
};

type ComplianceFilter = "all" | "over" | "compliant";

export default function SoftwareLicensesPage() {
  const { data: licenses, isLoading, error, refetch } = useSoftwareLicenses();
  const createLicense = useCreateSoftwareLicense();
  const updateLicense = useUpdateSoftwareLicense();
  const deleteLicense = useDeleteSoftwareLicense();
  const importLicenses = useImportSoftwareLicenses();
  const confirm = useConfirm();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [importMessage, setImportMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [search, setSearch] = useState("");
  const [complianceFilter, setComplianceFilter] = useState<ComplianceFilter>("all");

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

  // The form sits under the table; bring it into view and focus its first field.
  function focusForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    formRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
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
    focusForm();
  }

  async function handleDelete(license: SoftwareLicenseView) {
    const confirmed = await confirm({
      title: `Delete License "${license.softwareName}"?`,
      body: "Its seat, cost and expiry details are removed from the license register. This cannot be undone.",
      confirmLabel: "Delete license",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteLicense.mutate(license.id);
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

  const all = licenses ?? [];
  const term = search.trim().toLowerCase();
  const filtered = all
    .filter((l) => complianceFilter === "all" || (complianceFilter === "over" ? l.overCompliance : !l.overCompliance))
    .filter(
      (l) =>
        !term ||
        l.softwareName.toLowerCase().includes(term) ||
        (l.vendor ?? "").toLowerCase().includes(term) ||
        (l.version ?? "").toLowerCase().includes(term) ||
        (l.userDepartment ?? "").toLowerCase().includes(term),
    );
  const paged = usePagedList(filtered, 25);

  const overCount = all.filter((l) => l.overCompliance).length;
  const seatsPurchasedTotal = all.reduce((s, l) => s + l.seatsPurchased, 0);
  const seatsInUseTotal = all.reduce((s, l) => s + l.seatsInUse, 0);
  const yearlyTotal = all.reduce((s, l) => s + (l.annualCost ?? 0), 0);

  function clearFilters() {
    setSearch("");
    setComplianceFilter("all");
  }

  return (
    <>
      <PageHeader
        title="Software Licenses"
        description="Purchased licenses, seats in use across the fleet, renewal dates and cost."
        actions={
          <>
            <Button icon={FileDown} onClick={() => downloadCsv("software-licenses-template.csv", CSV_HEADERS.slice(0, 14), buildLicensesCsvTemplate())}>
              Download template
            </Button>
            <Button icon={Upload} onClick={() => fileInputRef.current?.click()} disabled={importLicenses.isPending}>
              {importLicenses.isPending ? "Importing…" : "Import from CSV"}
            </Button>
            <Button
              icon={Download}
              onClick={() => downloadCsv("software-licenses.csv", CSV_HEADERS, buildLicensesCsv(licenses ?? []))}
              disabled={!licenses || licenses.length === 0}
            >
              Export to CSV
            </Button>
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => {
                resetForm();
                focusForm();
              }}
            >
              Add license
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportFile}
              style={{ display: "none" }}
              aria-label="CSV file to import"
            />
          </>
        }
      />

      {importMessage && <Alert tone={importMessage.kind === "error" ? "critical" : "success"}>{importMessage.text}</Alert>}

      {isLoading ? (
        <Card>
          <Skeleton lines={6} />
        </Card>
      ) : error && !licenses ? (
        <Alert tone="critical" title="Couldn't load software licenses" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
          {(error as Error).message}
        </Alert>
      ) : (
        <>
          {all.length > 0 && (
            <KpiStrip>
              <Kpi
                icon={KeyRound}
                label="Licenses"
                value={all.length}
                suffix="recorded"
                active={complianceFilter === "all"}
                onClick={() => setComplianceFilter("all")}
              />
              <Kpi
                icon={Users}
                label="Seats in use"
                value={seatsInUseTotal}
                suffix={`of ${seatsPurchasedTotal} purchased`}
                bar={[
                  { value: Math.min(seatsInUseTotal, seatsPurchasedTotal), color: CHART_SEMANTIC.ok },
                  { value: Math.max(seatsPurchasedTotal - seatsInUseTotal, 0), color: CHART_SEMANTIC.neutral },
                ]}
              />
              <Kpi
                icon={TriangleAlert}
                label="Over-deployed"
                value={overCount}
                valueTone={overCount > 0 ? "critical" : undefined}
                suffix={`of ${all.length}`}
                footer="more seats in use than purchased"
                active={complianceFilter === "over"}
                onClick={() => setComplianceFilter("over")}
              />
              <Kpi icon={Wallet} label="Yearly cost" value={formatCost(yearlyTotal)} suffix="all licenses" />
            </KpiStrip>
          )}

          <Card flush>
            {all.length > 0 && (
              <Toolbar
                right={
                  <Segmented
                    label="Compliance"
                    value={complianceFilter}
                    onChange={setComplianceFilter}
                    options={[
                      { value: "all", label: `All ${all.length}` },
                      { value: "compliant", label: `Compliant ${all.length - overCount}` },
                      { value: "over", label: `Over-deployed ${overCount}` },
                    ]}
                  />
                }
              >
                <div style={{ width: 320 }}>
                  <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search software, vendor, version, department…" />
                </div>
              </Toolbar>
            )}

            {all.length === 0 ? (
              <EmptyState
                icon={KeyRound}
                title="No software licenses recorded yet"
                action={
                  <Button size="sm" icon={Upload} onClick={() => fileInputRef.current?.click()} disabled={importLicenses.isPending}>
                    Import from CSV
                  </Button>
                }
              >
                Add a license with the form below, or import a CSV built from the template.
              </EmptyState>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="No licenses match"
                action={
                  <Button size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              >
                {term ? `Nothing matches "${search}" with the current filters.` : "No licenses match the current filter."}
              </EmptyState>
            ) : (
              <>
                <div className="app-table-scroll">
                  <table className="ep-tbl">
                    <thead>
                      <tr>
                        <th scope="col">Software</th>
                        <th scope="col">Version</th>
                        <th scope="col">Vendor</th>
                        <th scope="col">Type</th>
                        <th scope="col" style={{ textAlign: "right" }}>
                          Seats (purchased / in use)
                        </th>
                        <th scope="col">Compliance</th>
                        <th scope="col">Expiry (dd/mm/yyyy)</th>
                        <th scope="col" style={{ textAlign: "right" }}>
                          Cost
                        </th>
                        <th scope="col" style={{ textAlign: "right" }}>
                          Yearly cost
                        </th>
                        <th scope="col">Deployment type</th>
                        <th scope="col">Access type</th>
                        <th scope="col">User department</th>
                        <th scope="col">
                          <span className="app-vh">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.pageItems.map((l) => (
                        <tr key={l.id} className={l.id === editingId ? "ep-sel" : undefined}>
                          <td className="ep-host">
                            <b>{l.softwareName}</b>
                          </td>
                          <td className="ep-mono">{l.version ?? <span className="app-muted">—</span>}</td>
                          <td>{l.vendor ?? <span className="app-muted">—</span>}</td>
                          <td>{LICENSE_TYPE_LABELS[l.licenseType] ?? l.licenseType}</td>
                          <td className="ep-num" style={{ textAlign: "right" }}>
                            <span title={l.seatsInUseOverride != null ? "Manually set" : "Auto-detected from installed software"}>
                              {l.seatsPurchased} / {l.seatsInUse}
                            </span>
                          </td>
                          <td>{l.overCompliance ? <Badge tone="crit">Over-deployed</Badge> : <Badge tone="ok">Compliant</Badge>}</td>
                          <td className="ep-num">{formatExpiryDate(l.expiryDate)}</td>
                          <td className="ep-num" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            {formatCost(l.cost)}
                            {l.cost != null && <span className="app-muted"> / {BILLING_CYCLE_LABELS[l.billingCycle]}</span>}
                          </td>
                          <td className="ep-num" style={{ textAlign: "right" }}>
                            {formatCost(l.annualCost)}
                          </td>
                          <td>{l.deploymentType ? DEPLOYMENT_TYPE_LABELS[l.deploymentType] : <span className="app-muted">—</span>}</td>
                          <td>{l.accessType ? ACCESS_TYPE_LABELS[l.accessType] : <span className="app-muted">—</span>}</td>
                          <td>{l.userDepartment ?? <span className="app-muted">—</span>}</td>
                          <td>
                            <div className="app-cell-actions">
                              <RowMenu
                                label={`Actions for ${l.softwareName}`}
                                items={[
                                  { label: "Edit license", icon: Pencil, onSelect: () => startEdit(l) },
                                  {
                                    label: "Delete license",
                                    icon: Trash2,
                                    danger: true,
                                    dividerBefore: true,
                                    disabled: deleteLicense.isPending,
                                    onSelect: () => handleDelete(l),
                                  },
                                ]}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={paged.page}
                  pageSize={paged.pageSize}
                  total={paged.total}
                  noun="licenses"
                  onPageChange={paged.setPage}
                  onPageSizeChange={paged.setPageSize}
                />
              </>
            )}
          </Card>
        </>
      )}

      <form ref={formRef} className="ep-card" onSubmit={handleSubmit} style={{ scrollMarginTop: 16 }}>
        <FormSection
          title={isEditing ? "Edit License" : "Add License"}
          description="Name the software as it appears in installed-software inventory so seats in use can be matched automatically."
        >
          <FormGrid>
            <Field label="Software name" htmlFor="lic-name" required>
              <input id="lic-name" className="ep-input" type="text" value={softwareName} onChange={(e) => setSoftwareName(e.target.value)} required />
            </Field>
            <Field label="Version" htmlFor="lic-version">
              <input
                id="lic-version"
                className="ep-input ep-mono"
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="e.g. 2024, 16.0.1"
              />
            </Field>
            <Field label="Vendor" htmlFor="lic-vendor">
              <input id="lic-vendor" className="ep-input" type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </Field>
            <Field label="License key" htmlFor="lic-key">
              <input id="lic-key" className="ep-input ep-mono" type="text" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} />
            </Field>
            <Field label="License type" htmlFor="lic-type">
              <select id="lic-type" className="ep-select" value={licenseType} onChange={(e) => setLicenseType(e.target.value as LicenseType)}>
                {LICENSE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LICENSE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Seats purchased" htmlFor="lic-seats">
              <input
                id="lic-seats"
                className="ep-input ep-num"
                type="number"
                min={0}
                value={seatsPurchased}
                onChange={(e) => setSeatsPurchased(Number(e.target.value))}
              />
            </Field>
            <Field
              label="Seats in use (optional override)"
              htmlFor="lic-inuse"
              span2
              help="Leave blank to keep the automatic estimate (matched against installed software across the fleet). Set a number here to use that instead — useful when the automatic match doesn't fit, or this license's usage isn't tracked via installed software at all. Clear it later to go back to automatic."
            >
              <input
                id="lic-inuse"
                className="ep-input ep-num"
                type="number"
                min={0}
                value={seatsInUseOverride}
                onChange={(e) => setSeatsInUseOverride(e.target.value)}
                placeholder="Auto-detected from installed software"
              />
            </Field>
          </FormGrid>
        </FormSection>

        <FormSection
          title="Cost and Renewal"
          description="Enter the cost for one billing cycle (e.g. one month if Monthly) — the yearly total is calculated automatically."
        >
          <FormGrid>
            <Field label="Expiry date" htmlFor="lic-expiry">
              <input id="lic-expiry" className="ep-input" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </Field>
            <Field label="Cost (₹)" htmlFor="lic-cost">
              <input
                id="lic-cost"
                className="ep-input ep-num"
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </Field>
            <Field label="Billing cycle" htmlFor="lic-cycle">
              <select
                id="lic-cycle"
                className="ep-select"
                value={billingCycle}
                onChange={(e) => setBillingCycle(e.target.value as SoftwareLicenseBillingCycle)}
              >
                {BILLING_CYCLES.map((c) => (
                  <option key={c} value={c}>
                    {BILLING_CYCLE_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
          </FormGrid>
        </FormSection>

        <FormSection title="Deployment" description="Where the software runs, how it's reached and who uses it.">
          <FormGrid>
            <Field label="Deployment type" htmlFor="lic-deploy">
              <select
                id="lic-deploy"
                className="ep-select"
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
            </Field>
            <Field label="Access type" htmlFor="lic-access">
              <select
                id="lic-access"
                className="ep-select"
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
            </Field>
            <Field label="User department" htmlFor="lic-dept">
              <input
                id="lic-dept"
                className="ep-input"
                type="text"
                value={userDepartment}
                onChange={(e) => setUserDepartment(e.target.value)}
                placeholder="e.g. Finance, IT, Sales"
              />
            </Field>
          </FormGrid>
          {!!mutationError && (
            <div style={{ marginTop: 12 }}>
              <Alert tone="critical">{(mutationError as Error).message}</Alert>
            </div>
          )}
        </FormSection>

        <FormFooter>
          {isEditing && <Button onClick={resetForm}>Cancel</Button>}
          <Button type="submit" variant="primary" disabled={pending || !softwareName.trim()}>
            {pending ? "Saving…" : isEditing ? "Save changes" : "Add license"}
          </Button>
        </FormFooter>
      </form>
    </>
  );
}
