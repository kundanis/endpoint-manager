import { Check, Lock, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Badge, type BadgeTone } from "./ui";

// Legacy call-site API (kind + label) rendered as a Meridian ep-badge. New code should prefer
// <Status value=...> from ./ui, which maps backend values to the fixed vocabulary itself.
export type StatusBadgeKind = "pass" | "warn" | "fail" | "lock";

const KIND: Record<StatusBadgeKind, { tone: BadgeTone; icon: LucideIcon }> = {
  pass: { tone: "ok", icon: Check },
  warn: { tone: "med", icon: TriangleAlert },
  fail: { tone: "crit", icon: X },
  lock: { tone: "crit", icon: Lock },
};

export default function StatusBadge({ kind, label }: { kind: StatusBadgeKind; label: string }) {
  const { tone, icon: Icon } = KIND[kind];
  return (
    <Badge tone={tone}>
      <Icon size={12} strokeWidth={2} aria-hidden />
      {label}
    </Badge>
  );
}
