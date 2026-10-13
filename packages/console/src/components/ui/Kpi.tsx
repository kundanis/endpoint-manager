import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// KPI tile (COMPONENTS.md §8). Every tile answers "how many, out of how many, getting better
// or worse?" — give it `suffix` (ratio/%) and a `footer` or `bar` for context.

export interface KpiBarSegment {
  value: number;
  color: string;
}

export function KpiStrip({ children }: { children: ReactNode }) {
  return <div className="ep-kpis">{children}</div>;
}

export function Kpi({
  icon: Icon,
  label,
  value,
  suffix,
  valueTone,
  footer,
  bar,
  to,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  value: ReactNode;
  suffix?: ReactNode;
  // Colour the value only for risk counts and warnings.
  valueTone?: "critical" | "warning";
  footer?: ReactNode;
  bar?: KpiBarSegment[];
  // A tile that links goes to the filtered list.
  to?: string;
}) {
  const total = bar?.reduce((sum, s) => sum + s.value, 0) ?? 0;
  const valueColor =
    valueTone === "critical" ? "var(--ep-sev-critical)" : valueTone === "warning" ? "var(--ep-sev-medium)" : undefined;
  const body = (
    <>
      <div className="ep-lb">
        {Icon && <Icon size={14} strokeWidth={1.7} className="ep-ic" aria-hidden />}
        {label}
      </div>
      <div className="ep-v">
        <span style={valueColor ? { color: valueColor } : undefined}>{value}</span>
        {suffix !== undefined && <small>{suffix}</small>}
      </div>
      {bar && total > 0 && (
        <div className="ep-kbar">
          {bar.map((s, i) => (
            <i key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
          ))}
        </div>
      )}
      {footer && <div className="ep-ft">{footer}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="ep-card ep-kpi app-kpi-link">
      {body}
    </Link>
  ) : (
    <div className="ep-card ep-kpi">{body}</div>
  );
}

// Trend chip: the colour says good/bad, the arrow says up/down.
export function Delta({ value, good }: { value: number; good: boolean }) {
  const Arrow = value >= 0 ? ChevronUp : ChevronDown;
  return (
    <span className={`ep-delta ${good ? "ep-up-good" : "ep-up-bad"}`}>
      <Arrow size={12} strokeWidth={2} className="ep-ic" aria-hidden />
      {Math.abs(value)}
    </span>
  );
}
