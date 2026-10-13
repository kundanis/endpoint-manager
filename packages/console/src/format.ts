// Shared display formatting (DESIGN_SYSTEM.md §7: relative times within 24 hours, absolute
// dates beyond). Every page should format times and sizes through these, not ad hoc.

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDateTime(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// Time of day only, for values already scoped to one day ("today's first login").
export function formatTime(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// "just now", "4 min ago", "3 h ago" within a day; an absolute date-time after that.
export function formatRelative(iso: string | null | undefined, fallback = "never", now = Date.now()): string {
  if (!iso) return fallback;
  const diff = now - new Date(iso).getTime();
  if (diff < 0 || diff >= DAY_MS) return formatDateTime(iso, fallback);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

export function formatBytes(bytes: number | string | null | undefined, fallback = "—"): string {
  if (bytes === null || bytes === undefined || bytes === "") return fallback;
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(1)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
