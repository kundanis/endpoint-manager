import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

// Form building blocks (COMPONENTS.md §14). Inputs use the plain ep-input / ep-select /
// ep-textarea classes directly; these wrappers handle the label, help and error wiring.

export function Field({
  label,
  htmlFor,
  required,
  help,
  error,
  span2,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  required?: boolean;
  help?: ReactNode;
  error?: ReactNode;
  span2?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`ep-field ${span2 ? "ep-span2" : ""}`}>
      <label className="ep-label" htmlFor={htmlFor}>
        {label}
        {required && <span className="ep-req">*</span>}
      </label>
      {children}
      {help && !error && <span className="ep-help">{help}</span>}
      {error && (
        <span className="ep-error" id={`${htmlFor}-err`}>
          <TriangleAlert size={14} strokeWidth={1.7} className="ep-ic" aria-hidden />
          {error}
        </span>
      )}
    </div>
  );
}

// A titled block inside a form card, with a one-line explanation and a 2-column grid.
export function FormSection({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="ep-section">
      <h4>{title}</h4>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="ep-form-grid">{children}</div>;
}

export function FormFooter({ children }: { children: ReactNode }) {
  return <div className="ep-formfoot">{children}</div>;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`ep-switch ${checked ? "ep-on" : ""}`} style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>
      <input type="checkbox" className="app-vh" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden />
      {label}
    </label>
  );
}

export function Check({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="ep-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}
