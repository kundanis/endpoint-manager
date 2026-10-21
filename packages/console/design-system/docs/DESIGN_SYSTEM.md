# Meridian — design system specification

Meridian is the light enterprise look for Endpoint IQ. It keeps the brand crimson as an identity colour but uses it sparingly, on calm white surfaces. Everything here is implemented in `tokens/tokens.css` and `css/meridian.css`.

## 1. Principles

1. **Calm by default, loud only for risk.** The resting UI is white and grey. Colour appears only when it means something: brand on the one primary action, severity colours on problems.
2. **Numbers with context.** Every metric shows a ratio, a comparison or a trend. "74" on its own means nothing; "74 · 25% · +9 since yesterday" does.
3. **Every screen leads to an action.** Empty, warning and error states name the next step ("Schedule scan", "Enroll →").
4. **Dense but legible.** It's an operations tool: 13–14px text, 34px controls, tables first. Clarity comes from alignment and hierarchy, not from extra space.
5. **One way to do each thing.** One button style per role, one badge per severity, one chart type per data shape.

## 2. Colour

Tokens are in `tokens/tokens.css` (`--ep-*`). All text and background pairs below pass WCAG AA (4.5:1). `--ep-border-strong` and `--ep-neutral` pass 3:1 for controls and chart fills.

**Surfaces & text**

| Token | Value | Use for |
|---|---|---|
| `--ep-bg` | `#f4f5f7` | App canvas behind cards. |
| `--ep-surface` | `#ffffff` | Cards, panels, table body. |
| `--ep-surface-2` | `#f1f3f6` | Table headers, hover rows, inset wells, track of bars. |
| `--ep-border` | `#e3e6eb` | Card outlines, table row dividers (decorative hairline). |
| `--ep-border-strong` | `#8a93a2` | Input and control borders; 3:1 against surface. |
| `--ep-ink` | `#111827` | Primary text on surface and bg. |
| `--ep-ink-muted` | `#4b5565` | Secondary text, labels, axis text. |
| `--ep-ink-subtle` | `#646c7a` | Metadata and timestamps; still 4.5:1 on surface. |

**Navigation**

| Token | Value | Use for |
|---|---|---|
| `--ep-sidebar-bg` | `#ffffff` | Primary navigation rail. |
| `--ep-sidebar-ink` | `#1a2231` | Nav labels on sidebar-bg. |
| `--ep-sidebar-ink-muted` | `#5a6474` | Nav section headers and sub-items on sidebar-bg. |
| `--ep-sidebar-active-bg` | `#fbeced` | Background of the active nav item. |
| `--ep-sidebar-border` | `#e3e6eb` | Divider between sidebar and canvas. |

**Brand & interaction**

| Token | Value | Use for |
|---|---|---|
| `--ep-brand` | `#b3141b` | Primary action, active nav marker, logo. Use sparingly; never to mean severity. |
| `--ep-brand-ink` | `#ffffff` | Text and icons on brand. |
| `--ep-brand-soft` | `#fdeced` | Selected row, active tab underlay, subtle brand tint. |
| `--ep-accent` | `#0f6e8c` | Links, focus of attention in charts, informational highlights. |
| `--ep-focus` | `#1d5fd1` | Focus ring (2px) on every interactive element. |

**Status & severity**

| Token | Value | Use for |
|---|---|---|
| `--ep-sev-critical` | `#c01e24` | Critical severity, failures. Text and fills. |
| `--ep-sev-critical-soft` | `#fdecec` | Background of critical badges and banners. |
| `--ep-sev-high` | `#b04a06` | High severity. |
| `--ep-sev-high-soft` | `#fdf0e6` | Background of high badges. |
| `--ep-sev-medium` | `#8a6100` | Medium severity, warnings, unmanaged devices. |
| `--ep-sev-medium-soft` | `#fcf4dc` | Background of medium badges. |
| `--ep-warn-fill` | `#dfa112` | Fill for warning/unmanaged bars and rings, where sev-medium text colour would read muddy. Fills only. |
| `--ep-sev-low` | `#1f5fbf` | Low severity, informational. |
| `--ep-sev-low-soft` | `#e9f0fc` | Background of low badges. |
| `--ep-ok` | `#13784a` | Healthy, online, managed, compliant. |
| `--ep-ok-soft` | `#e5f4ec` | Background of healthy badges. |
| `--ep-neutral` | `#8d95a3` | Offline, not assessed, unknown. Fills only, not text. |

**Charts**

| Token | Value | Use for |
|---|---|---|
| `--ep-chart-1` | `#2563c9` | Categorical series 1. |
| `--ep-chart-2` | `#13784a` | Categorical series 2. |
| `--ep-chart-3` | `#c87708` | Categorical series 3. |
| `--ep-chart-4` | `#7a4bc8` | Categorical series 4. |
| `--ep-chart-5` | `#0f8fa3` | Categorical series 5. |
| `--ep-chart-6` | `#c2417a` | Categorical series 6. |
| `--ep-brand-hover` | `#9a1117` | Primary button hover. |
| `--ep-selected` | `#eef3fc` | Selected table rows and the bulk-action bar. |

### Colour rules

- **Brand red** goes on: the logo tile, the single primary button, the active sidebar marker (3px bar), the active tab underline, the active nav item's soft tint (`--ep-sidebar-active-bg`) and checkbox/switch fills. Nothing else.
- **Severity** text uses `--ep-sev-*` on `--ep-sev-*-soft` backgrounds (badges, alerts). Use `--ep-warn-fill` for amber bars and rings, because `--ep-sev-medium` is a text colour and looks muddy as a fill.
- **Healthy, online and managed** use `--ep-ok`. **Offline, unknown and not assessed** use `--ep-neutral` (fills only; the label next to it stays `--ep-ink-muted`).
- **Links and "View all"** use `--ep-accent` (teal), not brand red, so they're never mistaken for errors.
- **Selection** (checked rows, the bulk bar) uses `--ep-selected` (pale blue), never red or pink.

## 3. Typography

Fonts: **Inter** for UI, **JetBrains Mono** for machine identifiers. Load them from Google Fonts:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

If the app runs offline or on-premises, self-host the same two families (woff2) and keep the `--ep-font-*` stacks. Both stacks fall back to Segoe UI and Consolas.

| Class / token prefix | Size / line | Weight | Use for |
|---|---|---|---|
| `.ep-text-metric-xl` | 32px / 36px | 600 | Hero KPI value. Tabular figures. |
| `.ep-text-page-title` | 22px / 28px | 600 | One per page. |
| `.ep-text-card-title` | 14px / 20px | 600 | Card and panel headings. Sentence case, never all caps. |
| `.ep-text-body` | 14px / 20px | 400 | Default UI text. |
| `.ep-text-body-sm` | 13px / 18px | 400 | Table cells, legends, helper text. |
| `.ep-text-label` | 12px / 16px | 500 | KPI labels, form labels. |
| `.ep-text-overline` | 11px / 16px | 600 | Nav section headers only. |
| `.ep-text-mono-sm` | 12.5px / 18px | 400 | Hostnames, IPs, CVE IDs, hashes, agent versions. |

Rules: page titles are 22px/600, card titles 14px/600 and body text 14px/400. Table cells are 13px. Labels are 12–12.5px/500. Use 700 only in the wordmark. Turn on tabular numerals (`.ep-num`) wherever numbers line up in a column or update live.

## 4. Spacing, radius and elevation

The grid is 4px. Use only these steps:

| Token | Value | Use for |
|---|---|---|
| `--ep-space-1` | 4px | Icon-to-label gap. |
| `--ep-space-2` | 8px | Inline gaps, badge padding. |
| `--ep-space-3` | 12px | Control padding, row gap in lists. |
| `--ep-space-4` | 16px | Card gutter between cards. |
| `--ep-space-5` | 20px | Card inner padding. |
| `--ep-space-6` | 24px | Page side padding; section gap. |
| `--ep-space-8` | 32px | Gap between page sections. |
| `--ep-space-12` | 48px | Empty-state breathing room. |

| Token | Value | Use for |
|---|---|---|
| `--ep-radius-sm` | 4px | Badges, bars, checkboxes. |
| `--ep-radius-md` | 6px | Buttons, inputs, nav items. |
| `--ep-radius-lg` | 10px | Cards and panels. |
| `--ep-radius-pill` | 999px | Status pills and avatars. |

| Token | Value | Use for |
|---|---|---|
| `--ep-shadow-card` | `0 1px 2px #1118270f` | Resting cards. Dark theme relies on the border, not shadow. |
| `--ep-shadow-pop` | `0 12px 32px #1118271f` | Menus, popovers, command palette. |

Cards have a 1px `--ep-border` plus `--ep-shadow-card`. Menus, popovers and modals use `--ep-shadow-pop`. Don't add new shadows.

## 5. Layout

```
┌──────────── 248px ───────────┬──────────────────────────── fluid ────────────────────────────┐
│ .ep-sb  (sidebar)            │ .ep-tb  (56px top bar: breadcrumb · search · time · alerts)   │
│  logo + product name         ├───────────────────────────────────────────────────────────────┤
│  OPERATIONS                  │ .ep-pg  (24px padding, 16px gap between rows)                 │
│   nav items (.ep-ni)         │   .ep-ph   page header: title, subtitle, actions (right)      │
│   expanded module (.ep-sub)  │   .ep-tabs (optional)                                         │
│  ADMINISTRATION              │   .ep-kpis (5 tiles)                                          │
│   …                          │   .ep-row.ep-r21  (2/3 + 1/3)                                 │
│  user (.ep-sbfoot)           │   .ep-row.ep-r3   (thirds)                                    │
│                              │   full-width .ep-card with .ep-tbl                            │
└──────────────────────────────┴───────────────────────────────────────────────────────────────┘
```

- Grid helpers: `.ep-row` with `.ep-r21` (2fr 1fr), `.ep-r12` (1fr 2fr) or `.ep-r3` (thirds). The gap is always 16px.
- Breakpoints (already in CSS): ≤1280px puts KPIs in 3 columns and rows in 2 columns. ≤960px hides the sidebar and stacks everything into one column (add a menu button to open the sidebar as a drawer).
- Content is fluid. Don't centre it in a narrow container: this is a full-width operations console.

## 6. Data visualisation

| Data shape | Use | Don't use |
|---|---|---|
| 2–3 part ratio (online/offline, clean/vulnerable) | Donut, 112–128px, centre number + legend with count and % | Pie with more than 3 slices |
| Categories (device type, OS, top CVEs) | Ranked horizontal bars (`.ep-bl`) | Donut |
| Part-of-whole across many groups (VLAN coverage) | Table with stacked bars (`.ep-cov` + `.ep-sbar`) | One donut per group |
| Trend over time | Line or sparkline, 1.6px stroke, no fill | 3D or area charts with gradients |
| A single proportion inside a KPI | 6px bar (`.ep-kbar`) | Gauge |

- Order of series colours: `--ep-chart-1` (blue), `-2` (green), `-3` (amber), `-4` (violet), `-5` (teal), `-6` (magenta).
- Semantic series always use semantic tokens: managed/online/clean → `--ep-ok`, unmanaged/warning → `--ep-warn-fill`, vulnerable/not trusted → `--ep-sev-critical`, offline/not assessed → `--ep-neutral`.
- Gridlines use `--ep-border`, axis labels 12px `--ep-ink-subtle`, and there's no chart border. Tooltips use `--ep-surface` with `--ep-shadow-pop`.
- Put a long tail (for example 243 "Other" OS entries) in its own neutral bar and flag it with a badge. Don't let it dominate a donut.

Chart.js defaults (if the app uses Chart.js):

```js
const css = n => getComputedStyle(document.documentElement).getPropertyValue(`--ep-${n}`).trim();
Chart.defaults.font.family = css('font-sans');
Chart.defaults.font.size = 12;
Chart.defaults.color = css('ink-subtle');
Chart.defaults.borderColor = css('border');
Chart.defaults.plugins.legend.display = false;          // use the HTML legend (.ep-legend / .ep-lg)
Chart.defaults.elements.arc.borderWidth = 2;            // gap between donut segments
Chart.defaults.elements.arc.borderColor = css('surface');
Chart.defaults.elements.bar.borderRadius = 4;
Chart.defaults.elements.line.borderWidth = 1.6;
export const series = [1,2,3,4,5,6].map(i => css(`chart-${i}`));
```

ApexCharts or ECharts need the same values: font family, 12px labels in `ink-subtle`, gridlines in `border`, colours from the token list.

## 7. Content and voice

- Sentence case everywhere ("Agent coverage by VLAN", "Run network scan").
- Buttons start with a verb: Export, Enroll endpoint, Create token, Remove agent.
- Destructive confirmations name the object and the consequence: "Remove agent from 2 endpoints? They will stop reporting and lose their policies."
- Errors say how to fix them: "Enter a number between 1 and 1,000", not "Invalid value".
- Times are relative within 24 hours ("2 min ago", "3 h ago"); older ones are absolute ("19 Oct 2026, 18:00 IST").
- Don't use the words "Oops" or "Successfully", and don't end labels with exclamation marks.

## 8. Accessibility

- Text contrast is at least 4.5:1, and controls, focus rings and chart fills are at least 3:1. This is built into the tokens.
- A 2px `--ep-focus` ring shows on `:focus-visible` for every interactive element. Never remove it.
- Interactive elements are real `<button>` or `<a>` elements, or carry `role` and `tabindex`. Icon-only buttons have an `aria-label`.
- Tables use `<th scope="col">`, and checkboxes in rows have `aria-label="Select <hostname>"`.
- Charts include a text equivalent: the legend with counts is enough.
