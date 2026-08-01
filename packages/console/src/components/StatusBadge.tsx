import StatusIcon, { type StatusIconKind } from "./StatusIcon";

const KIND_TO_CLASS: Record<StatusIconKind, string> = {
  pass: "online",
  warn: "warn",
  fail: "danger",
  lock: "danger",
};

export default function StatusBadge({ kind, label }: { kind: StatusIconKind; label: string }) {
  return (
    <span className={`status-badge ${KIND_TO_CLASS[kind]}`}>
      <StatusIcon kind={kind} />
      {label}
    </span>
  );
}
