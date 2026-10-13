import type { CSSProperties, ReactNode } from "react";

// The one place backend status values map to Meridian components (COMPONENTS.md §6).
// Severity/result values render as a badge; live states render as a dotted pill.
// Status is never colour alone: every badge and pill carries its word.

export type BadgeTone = "crit" | "high" | "med" | "low" | "ok" | "neu";
export type PillTone = "ok" | "neutral" | "warn" | "critical";

const PILL_COLOR: Record<PillTone, string> = {
  ok: "var(--ep-ok)",
  neutral: "var(--ep-neutral)",
  warn: "var(--ep-warn-fill)",
  critical: "var(--ep-sev-critical)",
};

const BADGE_VALUES: Record<string, BadgeTone> = {
  critical: "crit",
  high: "high",
  medium: "med",
  moderate: "med",
  low: "low",
  clean: "ok",
  compliant: "ok",
  trusted: "ok",
  patched: "ok",
  "not assessed": "neu",
  unknown: "neu",
  "n/a": "neu",
  none: "neu",
};

const PILL_VALUES: Record<string, PillTone> = {
  online: "ok",
  managed: "ok",
  offline: "neutral",
  unmanaged: "warn",
  pending: "warn",
  warning: "warn",
  paused: "warn",
  "not trusted": "critical",
  failed: "critical",
  blocked: "critical",
  quarantined: "critical",
};

// Fixed vocabulary for display (DESIGN_SYSTEM.md: "Critical, High, Medium, Low; Online, Offline; ...").
function sentenceCase(value: string): string {
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normalize(value: string): string {
  return value.replace(/_/g, " ").trim().toLowerCase();
}

export type StatusDisplay = { kind: "badge"; tone: BadgeTone } | { kind: "pill"; tone: PillTone };

export function statusDisplay(value: string): StatusDisplay {
  const key = normalize(value);
  if (key in BADGE_VALUES) return { kind: "badge", tone: BADGE_VALUES[key] };
  if (key in PILL_VALUES) return { kind: "pill", tone: PILL_VALUES[key] };
  return { kind: "badge", tone: "neu" };
}

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`ep-badge ep-b-${tone}`}>{children}</span>;
}

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className="ep-pill" style={{ "--ep-c": PILL_COLOR[tone] } as CSSProperties}>
      {children}
    </span>
  );
}

// Renders any backend status/severity value with the right component and wording.
// Pass `label` to override the displayed word (e.g. a count) while keeping the mapping.
export function Status({ value, label }: { value: string; label?: ReactNode }) {
  const display = statusDisplay(value);
  const text = label ?? sentenceCase(value);
  return display.kind === "badge" ? <Badge tone={display.tone}>{text}</Badge> : <Pill tone={display.tone}>{text}</Pill>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="ep-tag">{children}</span>;
}

// Job/task lifecycle states (commands, package deployments, agent updates, patches).
// In-flight states are a warn pill; outcomes are badges.
const TASK_IN_FLIGHT = new Set(["PENDING", "DISPATCHED", "DOWNLOADING", "INSTALLING", "APPLYING", "RUNNING", "QUEUED"]);

export function TaskStatus({ status, count }: { status: string; count?: number }) {
  const key = status.toUpperCase();
  const word = sentenceCase(key);
  const text = count === undefined ? word : `${word} · ${count}`;
  if (TASK_IN_FLIGHT.has(key)) return <Pill tone="warn">{text}</Pill>;
  if (key === "SUCCESS" || key === "COMPLETED" || key === "INSTALLED") return <Badge tone="ok">{text}</Badge>;
  if (key === "FAILED" || key === "TIMEOUT" || key === "ERROR") return <Badge tone="crit">{text}</Badge>;
  return <Badge tone="neu">{text}</Badge>;
}

export function TaskCounts({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return <span className="app-muted">—</span>;
  return (
    <div className="app-badge-row">
      {entries.map(([status, count]) => (
        <TaskStatus key={status} status={status} count={count} />
      ))}
    </div>
  );
}
