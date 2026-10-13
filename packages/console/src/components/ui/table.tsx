import { ChevronLeft, ChevronRight, Columns3, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";

// Data-table furniture (COMPONENTS.md §13). The table itself is a plain
// <table className="ep-tbl"> inside <Card flush>, so columns stay fully under page control.

export function Toolbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="ep-toolbar">
      {children}
      {right && <div className="ep-r">{right}</div>}
    </div>
  );
}

export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="ep-input-icon">
      <Search size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
      <input type="search" className="ep-input" aria-label={props.placeholder} {...props} />
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="ep-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? "ep-on" : ""}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Shown only while at least one row is selected.
export function BulkBar({ count, children, onClear }: { count: number; children: ReactNode; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <div className="ep-bulk">
      <b>{count} selected</b>
      {children}
      <button type="button" className="ep-link app-link-btn" style={{ marginLeft: "auto" }} onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}

const PAGE_SIZES = [25, 50, 100];

// Page numbers to show: first, last, and a window around the current page, "…" for gaps.
function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

export function Pagination({
  page,
  pageSize,
  total,
  noun,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  // Plural noun for the summary line, e.g. "endpoints".
  noun: string;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="ep-pagination">
      Showing{" "}
      <b className="ep-num">
        {from}–{to}
      </b>{" "}
      of <span className="ep-num">{total}</span> {noun}
      {onPageSizeChange && (
        <select
          className="ep-select"
          style={{ width: "auto", height: 30, marginLeft: 8 }}
          value={pageSize}
          aria-label="Rows per page"
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} per page
            </option>
          ))}
        </select>
      )}
      <div className="ep-r">
        <button type="button" className="ep-page-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
        </button>
        {pageWindow(page, pageCount).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="app-page-gap" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`ep-page-btn ${p === page ? "ep-on" : ""}`}
              aria-current={p === page ? "page" : undefined}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className="ep-page-btn"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
        </button>
      </div>
    </div>
  );
}

// Show/hide optional table columns. Keep the identity column and the actions column out of
// `columns` so they can never be hidden.
export function ColumnPicker({
  columns,
  visible,
  onChange,
}: {
  columns: { key: string; label: string }[];
  visible: string[];
  onChange: (visible: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(key: string) {
    onChange(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]);
  }

  return (
    <div className="app-menu-wrap" ref={wrapRef}>
      <button type="button" className="ep-btn ep-btn-sm" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Columns3 size={15} strokeWidth={1.7} className="ep-ic" aria-hidden />
        Columns
      </button>
      {open && (
        <div className="ep-menu app-menu-pop app-column-menu">
          {columns.map((c) => (
            <label key={c.key} className="ep-check">
              <input type="checkbox" checked={visible.includes(c.key)} onChange={() => toggle(c.key)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Removable active-filter chips shown under a toolbar.
export function FilterChips({ chips, onClearAll }: { chips: { key: string; label: ReactNode; onRemove: () => void }[]; onClearAll?: () => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="app-chips">
      {chips.map((c) => (
        <span key={c.key} className="ep-tag app-chip">
          {c.label}
          <button type="button" aria-label="Remove filter" onClick={c.onRemove}>
            <X size={12} strokeWidth={2} aria-hidden />
          </button>
        </span>
      ))}
      {onClearAll && chips.length > 1 && (
        <button type="button" className="ep-link app-link-btn" onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}

// Client-side pagination state for an in-memory list. Clamps the page when the list shrinks
// (live updates, filter changes) so the view never lands on an empty page.
export function usePagedList<T>(items: T[], initialPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  return {
    page: current,
    pageSize,
    total: items.length,
    pageItems: items.slice((current - 1) * pageSize, current * pageSize),
    setPage,
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(1);
    },
  };
}
