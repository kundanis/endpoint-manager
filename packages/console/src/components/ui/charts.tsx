import { useState, type ReactNode } from "react";

// Charts per DESIGN_SYSTEM.md §6 / COMPONENTS.md §9–12. Colours are always CSS token
// references (see chartTheme.ts). Every chart carries its numbers in text, so the legend or
// labels are the accessible equivalent.

export interface ChartDatum {
  label: string;
  value: number;
  color: string;
  // Optional drill-down (e.g. navigate to the filtered list).
  onSelect?: () => void;
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

const DONUT_R = 57;
const DONUT_C = 2 * Math.PI * DONUT_R;

// Donut with centre total and legend — only for 2–3 part ratios (online/offline, clean/vulnerable).
export function Donut({ data, centerLabel }: { data: ChartDatum[]; centerLabel: string }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  let start = 0;
  return (
    <div className="ep-dn">
      <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden="true" style={{ flex: "none" }}>
        <circle cx="64" cy="64" r={DONUT_R} fill="none" style={{ stroke: "var(--ep-surface-2)" }} strokeWidth="14" />
        {total > 0 &&
          data.map((d) => {
            const len = (d.value / total) * DONUT_C;
            // The 2px gap between segments; a single full segment needs none.
            const dash = d.value === total ? len : Math.max(len - 2, 0);
            const offset = -start;
            start += len;
            if (d.value === 0) return null;
            return (
              <circle
                key={d.label}
                cx="64"
                cy="64"
                r={DONUT_R}
                fill="none"
                style={{ stroke: d.color, cursor: d.onSelect ? "pointer" : undefined }}
                strokeWidth="14"
                strokeDasharray={`${dash} ${DONUT_C}`}
                strokeDashoffset={offset}
                transform="rotate(-90 64 64)"
                onClick={d.onSelect}
              />
            );
          })}
        <text x="50%" y="66" textAnchor="middle" style={{ fill: "var(--ep-ink)", font: "600 24px var(--ep-font-sans)" }}>
          {total}
        </text>
        <text x="50%" y="84" textAnchor="middle" style={{ fill: "var(--ep-ink-subtle)", font: "500 11px var(--ep-font-sans)" }}>
          {centerLabel}
        </text>
      </svg>
      <div className="ep-lg">
        {data.map((d) => {
          const content = (
            <>
              <i className="ep-sw" style={{ background: d.color }} />
              {d.label}
              <b>{d.value}</b>
              <em>{percent(d.value, total)}%</em>
            </>
          );
          return d.onSelect ? (
            <div key={d.label} role="link" tabIndex={0} className="app-chart-link" onClick={d.onSelect} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), d.onSelect!())}>
              {content}
            </div>
          ) : (
            <div key={d.label}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}

// Ranked horizontal bars for categories. Sorted largest first; at most `limit` rows, with the
// rest behind "Show all". Pass a long-tail/unknown bucket as `tail` so it always sits last.
export function RankedBars({
  data,
  total,
  limit = 5,
  tail,
}: {
  data: ChartDatum[];
  // Denominator for the % column; defaults to the sum of data + tail.
  total?: number;
  limit?: number;
  tail?: ChartDatum;
}) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const denominator = total ?? sorted.reduce((s, d) => s + d.value, 0) + (tail?.value ?? 0);
  const visible = showAll ? sorted : sorted.slice(0, limit);
  const hidden = sorted.length - visible.length;
  const rows = tail && tail.value > 0 ? [...visible, tail] : visible;

  return (
    <div className="ep-bl">
      {rows.map((d) => {
        const pct = percent(d.value, denominator);
        const label = d.onSelect ? (
          <button type="button" className="ep-k app-chart-link app-link-btn app-truncate" title={d.label} onClick={d.onSelect}>
            {d.label}
          </button>
        ) : (
          <span className="ep-k app-truncate" title={d.label}>
            {d.label}
          </span>
        );
        return (
          <div key={d.label} className="ep-it">
            {label}
            <span className="ep-vv">
              <b>{d.value}</b> · {pct}%
            </span>
            <div className="ep-track">
              <i style={{ width: `${pct}%`, background: d.color }} />
            </div>
          </div>
        );
      })}
      {hidden > 0 && (
        <div className="app-bl-more">
          +{hidden} more ·{" "}
          <button type="button" className="ep-link app-link-btn" onClick={() => setShowAll(true)}>
            Show all
          </button>
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="ep-legend">
      {items.map((item) => (
        <span key={item.label}>
          <i className="ep-sw" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export interface CoverageRow {
  key: string;
  name: ReactNode;
  // Second line under the name: host count, subnet, or "not scanned".
  sub?: ReactNode;
  // Stacked bar segments; widths are computed against `total`.
  segments: { value: number; color: string }[];
  managed: number;
  total: number;
  // Shown instead of the bar when there's nothing to draw yet.
  noData?: ReactNode;
  onSelect?: () => void;
}

// Part-of-whole across many groups (e.g. agent coverage per VLAN) — one table, not N donuts.
export function CoverageTable({ rows, nameHeader, managedHeader = "Managed" }: { rows: CoverageRow[]; nameHeader: string; managedHeader?: string }) {
  return (
    <table className="ep-cov">
      <thead>
        <tr>
          <th scope="col">{nameHeader}</th>
          <th scope="col">Coverage</th>
          <th scope="col" style={{ textAlign: "right" }}>
            {managedHeader}
          </th>
          <th scope="col" style={{ textAlign: "right" }}>
            %
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const pct = percent(r.managed, r.total);
          const hasData = !r.noData && r.total > 0;
          return (
            <tr key={r.key} className={r.onSelect ? "app-clickable" : undefined} onClick={r.onSelect}>
              <td className="ep-n" style={{ width: 190 }}>
                {r.name}
                {r.sub && <small>{r.sub}</small>}
              </td>
              <td>
                {hasData ? (
                  <div className="ep-sbar">
                    {r.segments.map((s, i) => (
                      <i key={i} style={{ width: `${(s.value / r.total) * 100}%`, background: s.color }} />
                    ))}
                  </div>
                ) : (
                  <span className="ep-nodata">{r.noData ?? "No data yet"}</span>
                )}
              </td>
              <td className="ep-t" style={{ width: 80 }}>
                {hasData ? `${r.managed} / ${r.total}` : "—"}
              </td>
              <td className="ep-p" style={{ color: !hasData ? "var(--ep-ink-subtle)" : pct >= 50 ? "var(--ep-ok)" : "var(--ep-sev-medium)" }}>
                {hasData ? `${pct}%` : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
