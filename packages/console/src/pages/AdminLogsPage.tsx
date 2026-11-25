import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, ScrollText } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAdminAuditFacets, useAdminAuditLog, useAdminAuditSettings, useClearAdminAudit, useSaveAdminAuditSettings, type AdminAuditFilters } from "../api/hooks";
import type { AdminAuditEntry } from "../api/types";
import { Alert, Badge, Button, Card, EmptyState, Field, FormGrid, IconButton, PageHeader, Pagination, Skeleton, Toolbar, useConfirm, useToast } from "../components/ui";
import { csvDate, downloadCsv } from "../csv";
import { formatDateTime } from "../format";

// Identity Governance -> Admin logs (super admins only). Every change made in the console,
// sign-ins and views of sensitive data, newest first. Entries can't be edited or deleted one by
// one; old ones go through the retention setting or "clear older than", which are logged too.

// Date inputs give a day; "to" covers that whole day.
function query(f: AdminAuditFilters, page: number, pageSize: number) {
  const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, k === "from" ? new Date(`${v}T00:00:00`).toISOString() : k === "to" ? new Date(`${v}T23:59:59.999`).toISOString() : v);
  return p.toString();
}

// The values worth showing: the submitted request (or a view's filters), without browser
// strings, empty values or older entries' user agent. null when nothing is left.
function usefulDetail(e: AdminAuditEntry): unknown {
  const prune = (v: unknown): unknown => {
    if (v === null || v === undefined || v === "") return undefined;
    if (Array.isArray(v)) return v.length ? v : undefined;
    if (typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "userAgent") continue;
      const p = prune(val);
      if (p !== undefined) out[k] = p;
    }
    return Object.keys(out).length ? out : undefined;
  };
  const d = prune(e.detail) as Record<string, unknown> | undefined;
  if (!d) return null;
  // Unwrap the single "request" / "query" wrapper the server stores.
  const keys = Object.keys(d);
  return keys.length === 1 && (keys[0] === "request" || keys[0] === "query") ? d[keys[0]] : d;
}

// Internal record IDs mean nothing to a reader, so they're left out of the details.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function withoutIds(v: unknown): unknown {
  if (typeof v === "string") return UUID.test(v) ? undefined : v;
  if (Array.isArray(v)) {
    const kept = v.map(withoutIds).filter((x) => x !== undefined);
    return kept.length ? kept : undefined;
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const kept = withoutIds(val);
      if (kept !== undefined) out[k] = kept;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}

// "softwareName" -> "Software name"; keys stored already readable ("Endpoint") stay as they are.
function label(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function plain(v: unknown): string | null {
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v) && v.every((x) => typeof x !== "object")) return v.map((x) => plain(x)).join(", ");
  return null;
}

function Detail({ e }: { e: AdminAuditEntry }) {
  const detail = withoutIds(usefulDetail(e));
  if (detail === undefined || detail === null) return <span className="app-muted">No further details.</span>;
  const simple = plain(detail);
  if (simple !== null) return <span>{simple}</span>;
  return (
    <dl className="app-stack-sm" style={{ margin: 0 }}>
      {Object.entries(detail as Record<string, unknown>).map(([k, v]) => {
        const text = plain(v);
        return (
          <div key={k} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <dt className="app-muted" style={{ minWidth: 120 }}>{label(k)}</dt>
            <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
              {text !== null ? (
                text
              ) : (
                <pre className="ep-mono" style={{ margin: 0, whiteSpace: "pre-wrap", maxHeight: 240, overflowY: "auto", fontSize: 12 }}>
                  {JSON.stringify(v, null, 2)}
                </pre>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function RetentionCard() {
  const { data } = useAdminAuditSettings();
  const save = useSaveAdminAuditSettings();
  const clear = useClearAdminAudit();
  const confirm = useConfirm();
  const toast = useToast();
  const [days, setDays] = useState(365);
  const [before, setBefore] = useState("");

  useEffect(() => {
    if (data) setDays(data.retentionDays);
  }, [data]);

  if (!data) return <Skeleton lines={3} />;
  const latestClear = new Date(Date.now() - data.minRetentionDays * 24 * 60 * 60_000).toISOString().slice(0, 10);

  async function handleClear() {
    const ok = await confirm({
      title: `Clear Admin Log Entries Older Than ${before}?`,
      body: "They're removed permanently. The clearing itself is recorded as a new entry with your name.",
      confirmLabel: "Clear entries",
      tone: "danger",
    });
    if (ok) clear.mutate(before, { onSuccess: (r) => toast(`Removed ${r.removed} ${r.removed === 1 ? "entry" : "entries"}.`) });
  }

  return (
    <Card title="Keeping Logs" hint={`${data.totalEntries} entries${data.oldestEntryAt ? `, oldest ${formatDateTime(data.oldestEntryAt)}` : ""}`}>
      <div className="app-stack">
        <FormGrid>
          <Field label="Keep entries for (days)" htmlFor="al-days" help={`Older entries are removed automatically. ${data.minRetentionDays} days minimum.`}>
            <div className="app-actions-row">
              <input
                id="al-days"
                type="number"
                min={data.minRetentionDays}
                max={3650}
                className="ep-input"
                style={{ width: 120 }}
                value={days}
                onChange={(e) => setDays(Math.floor(Number(e.target.value) || 0))}
              />
              <Button disabled={save.isPending || days === data.retentionDays} onClick={() => save.mutate(days, { onSuccess: () => toast("Retention saved.") })}>
                Save
              </Button>
            </div>
          </Field>
          <Field label="Clear entries older than" htmlFor="al-before" help={`Only entries older than ${data.minRetentionDays} days can be cleared.`}>
            <div className="app-actions-row">
              <input id="al-before" type="date" className="ep-input" max={latestClear} value={before} onChange={(e) => setBefore(e.target.value)} />
              <Button variant="danger" disabled={!before || before > latestClear || clear.isPending} onClick={handleClear}>
                Clear
              </Button>
            </div>
          </Field>
        </FormGrid>
        {save.isError && <Alert tone="critical">{(save.error as Error).message}</Alert>}
        {clear.isError && <Alert tone="critical">{(clear.error as Error).message}</Alert>}
      </div>
    </Card>
  );
}

export default function AdminLogsPage() {
  // ?q= opens the page already searched (the alert bell's "Agents uninstalled" link).
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<AdminAuditFilters>({ q: searchParams.get("q") ?? "", admin: "", category: "", result: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  // The bell's link again while this page is open.
  const linkedQ = searchParams.get("q");
  useEffect(() => {
    if (linkedQ !== null) {
      setFilters((f) => ({ ...f, q: linkedQ }));
      setPage(1);
    }
  }, [linkedQ]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { data, isLoading, error } = useAdminAuditLog(filters, page, pageSize);
  const { data: facets } = useAdminAuditFacets();

  const set = (patch: Partial<AdminAuditFilters>) => {
    setFilters({ ...filters, ...patch });
    setPage(1);
  };

  async function handleExport() {
    setExporting(true);
    try {
      const all = await api.get<{ items: AdminAuditEntry[] }>(`/admin/audit-log?${query(filters, 1, 5000)}`);
      downloadCsv(
        "admin-logs.csv",
        ["When", "Admin", "IP address", "Category", "Module", "What happened", "Result", "Details"],
        all.items.map((e) => [csvDate(e.at), e.adminEmail, e.ipAddress ?? "", e.category, e.module ?? "", e.summary, e.success ? "Success" : "Failed", (() => { const d = withoutIds(usefulDetail(e)); return d === undefined || d === null ? "" : JSON.stringify(d); })()]),
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Admin Logs"
        description="Every change made in the console, sign-ins and views of sensitive data, by administrator. Entries can't be edited or deleted one by one."
      />
      <div className="app-stack">
        <Card flush title="Activity" hint={data ? `${data.total} ${data.total === 1 ? "entry" : "entries"}` : undefined}>
          <Toolbar>
            <input type="search" className="ep-input" placeholder="Search what happened, admin or IP…" aria-label="Search" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
            <select className="ep-select" aria-label="Administrator" value={filters.admin} onChange={(e) => set({ admin: e.target.value })}>
              <option value="">Admin: All</option>
              {facets?.admins.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select className="ep-select" aria-label="Category" value={filters.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">Category: All</option>
              {facets?.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select className="ep-select" aria-label="Result" value={filters.result} onChange={(e) => set({ result: e.target.value })}>
              <option value="">Result: All</option>
              <option value="success">Succeeded</option>
              <option value="failed">Failed</option>
            </select>
            <input type="date" className="ep-input" aria-label="From date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
            <input type="date" className="ep-input" aria-label="To date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
            <Button icon={Download} disabled={exporting || !data || data.total === 0} onClick={handleExport}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </Toolbar>
          {isLoading ? (
            <div className="ep-cb">
              <Skeleton />
            </div>
          ) : error ? (
            <div className="ep-cb">
              <Alert tone="critical" title="Couldn't load admin logs">
                {(error as Error).message}
              </Alert>
            </div>
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={ScrollText} title="No entries">
              Admin activity is recorded from now on: sign-ins, changes and views of sensitive data.
            </EmptyState>
          ) : (
            <div className="app-table-wrap">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="app-vh">Expand</span>
                    </th>
                    <th scope="col">When</th>
                    <th scope="col">Admin</th>
                    <th scope="col">What happened</th>
                    <th scope="col">Category</th>
                    <th scope="col">Result</th>
                    <th scope="col">IP address</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((e) => {
                    const hasDetail = withoutIds(usefulDetail(e)) !== undefined;
                    const open = hasDetail && expanded === e.id;
                    return (
                      <Fragment key={e.id}>
                        <tr>
                          <td className="ep-cb">
                            {hasDetail && <IconButton icon={open ? ChevronDown : ChevronRight} label={open ? "Hide details" : "Show details"} onClick={() => setExpanded(open ? null : e.id)} />}
                          </td>
                          <td className="ep-num" style={{ whiteSpace: "nowrap" }}>
                            {formatDateTime(e.at)}
                          </td>
                          <td>{e.adminEmail}</td>
                          <td style={{ overflowWrap: "anywhere" }}>
                            {e.summary}
                            {e.module && <span className="app-row-sub">{e.module}</span>}
                          </td>
                          <td>{e.category}</td>
                          <td>{e.success ? <Badge tone="ok">Succeeded</Badge> : <Badge tone="crit">Failed</Badge>}</td>
                          <td className="ep-mono">{e.ipAddress ?? "—"}</td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={7} style={{ background: "var(--ep-surface-2)" }}>
                              <Detail e={e} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={data.total}
                noun="entries"
                onPageChange={setPage}
                onPageSizeChange={(n) => {
                  setPageSize(n);
                  setPage(1);
                }}
              />
            </div>
          )}
        </Card>
        <RetentionCard />
      </div>
    </>
  );
}

