import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Alerts, empty states and skeletons (COMPONENTS.md §15).

const ALERT_ICON: Record<AlertTone, LucideIcon> = {
  info: Info,
  warn: TriangleAlert,
  critical: CircleAlert,
  success: CircleCheck,
};

export type AlertTone = "info" | "warn" | "critical" | "success";

export function Alert({
  tone,
  title,
  children,
  action,
}: {
  tone: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  // e.g. a Retry button for a failed load.
  action?: ReactNode;
}) {
  const Icon = ALERT_ICON[tone];
  return (
    <div className={`ep-alert ep-alert-${tone}`} role={tone === "critical" ? "alert" : undefined}>
      <Icon size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
      <div style={{ flex: 1 }}>
        {title && <b>{title}</b>}
        {children}
      </div>
      {action}
    </div>
  );
}

// Every list or table needs one: say what's missing and name the next action.
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ep-empty">
      <div className="ep-eic">
        <Icon size={18} strokeWidth={1.7} className="ep-ic" aria-hidden />
      </div>
      <b>{title}</b>
      {children}
      {action}
    </div>
  );
}

const SKELETON_WIDTHS = ["40%", "85%", "70%", "55%"];

// Loading placeholder shaped like the final content; stack inside the card body.
export function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="app-skel-stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="ep-skel" style={{ width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] }} />
      ))}
    </div>
  );
}
