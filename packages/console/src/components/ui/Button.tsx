import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "ep-btn-primary",
  secondary: "",
  ghost: "ep-btn-ghost",
  danger: "ep-btn-danger",
  "danger-solid": "ep-btn-danger-solid",
};

// Meridian button (COMPONENTS.md §5). One "primary" per view; "danger-solid" only as the
// confirm button inside a destructive modal. Defaults to type="button" so it never submits
// a surrounding form by accident.
export function Button({
  variant = "secondary",
  size,
  icon: Icon,
  className,
  type = "button",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm";
  icon?: LucideIcon;
}) {
  const classes = ["ep-btn", VARIANT_CLASS[variant], size === "sm" ? "ep-btn-sm" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {Icon && <Icon size={15} strokeWidth={1.7} className="ep-ic" aria-hidden />}
      {children}
    </button>
  );
}

// Icon-only button; aria-label is required because there is no visible text.
export function IconButton({
  icon: Icon,
  label,
  className,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { icon: LucideIcon; label: string }) {
  return (
    <button type={type} className={`ep-iconbtn ${className ?? ""}`} aria-label={label} title={label} {...rest}>
      <Icon size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
    </button>
  );
}
