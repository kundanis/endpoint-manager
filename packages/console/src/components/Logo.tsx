// Meridian brand tile (design-system/docs/COMPONENTS.md §2): a brand-red rounded square with
// a white shield-check mark. Placeholder until the official product mark is supplied.
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="7" style={{ fill: "var(--ep-brand)" }} />
      <path
        d="M14 6.5 8.5 8.6v4.2c0 3.5 2.3 6.3 5.5 7.7 3.2-1.4 5.5-4.2 5.5-7.7V8.6L14 6.5z"
        fill="none"
        style={{ stroke: "var(--ep-brand-ink)" }}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m11.6 13.6 1.7 1.7 3.2-3.6"
        fill="none"
        style={{ stroke: "var(--ep-brand-ink)" }}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
