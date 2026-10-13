// Chart colours per design-system/docs/DESIGN_SYSTEM.md §6. Recharts accepts CSS variables
// directly as fill/stroke values, so these resolve against design-system/tokens/tokens.css.

// Categorical series, always used in this order.
export const CHART_SERIES = [1, 2, 3, 4, 5, 6].map((i) => `var(--ep-chart-${i})`);

// Semantic series: these meanings always get these colours, never a categorical one.
export const CHART_SEMANTIC = {
  ok: "var(--ep-ok)", // managed / online / clean / trusted
  warn: "var(--ep-warn-fill)", // unmanaged / warning
  critical: "var(--ep-sev-critical)", // vulnerable / not trusted
  neutral: "var(--ep-neutral)", // offline / not assessed / long-tail "Other"
} as const;

export const CHART_GRID = "var(--ep-border)";
export const CHART_AXIS_TEXT = "var(--ep-ink-subtle)";
export const CHART_SURFACE = "var(--ep-surface)";
