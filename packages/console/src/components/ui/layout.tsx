import { Fragment, type CSSProperties, type ReactNode } from "react";
import { NavLink } from "react-router-dom";

// Page header (COMPONENTS.md §4): one h1 per page, a one-line description, and actions on the
// right — secondary actions first, at most one primary last.
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ep-ph">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ep-acts">{actions}</div>}
    </div>
  );
}

export interface TabItem {
  label: ReactNode;
  // Route tabs navigate; value tabs switch local state. Use one style per tab bar.
  to?: string;
  value?: string;
}

export function Tabs({ items, value, onChange }: { items: TabItem[]; value?: string; onChange?: (value: string) => void }) {
  return (
    <nav className="ep-tabs">
      {items.map((item) =>
        item.to ? (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "ep-on" : "")}>
            {item.label}
          </NavLink>
        ) : (
          <button
            key={item.value}
            type="button"
            className={item.value === value ? "ep-on" : ""}
            aria-pressed={item.value === value}
            onClick={() => item.value !== undefined && onChange?.(item.value)}
          >
            {item.label}
          </button>
        ),
      )}
    </nav>
  );
}

// Card (COMPONENTS.md §7). `flush` is for a card wrapping a full-bleed table/toolbar: the
// body isn't padded and the children sit directly under the header.
export function Card({
  title,
  hint,
  actions,
  flush,
  children,
  className,
  style,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const header = (title || actions) && (
    <div className="ep-ch" style={flush ? { paddingBottom: 14 } : undefined}>
      {title && <h3>{title}</h3>}
      {hint && <span className="ep-hint">· {hint}</span>}
      {actions && <div className="ep-r">{actions}</div>}
    </div>
  );
  return (
    <section className={`ep-card ${className ?? ""}`} style={flush ? { overflow: "hidden", ...style } : style}>
      {header}
      {flush ? children : <div className="ep-cb">{children}</div>}
    </section>
  );
}

// Grid rows (DESIGN_SYSTEM.md §5): "21" = 2/3 + 1/3, "12" = 1/3 + 2/3, "3" = thirds.
export function Row({ layout, children }: { layout: "21" | "12" | "3"; children: ReactNode }) {
  return <div className={`ep-row ep-r${layout}`}>{children}</div>;
}

// Key/value property list for detail pages (COMPONENTS.md §17).
export function KeyValueList({ items }: { items: { label: ReactNode; value: ReactNode; mono?: boolean }[] }) {
  return (
    <dl className="ep-kv">
      {items.map((item, i) => (
        <Fragment key={i}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? "ep-mono" : undefined}>{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
