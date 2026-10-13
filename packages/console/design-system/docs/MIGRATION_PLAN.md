# Meridian — migration plan for Claude Code

The work is split into phases, and each phase should be a separate pull request. Don't start a phase until the previous one renders correctly.

## Phase 0 — Audit (no code changes)

1. Identify the frontend stack: framework, templating, CSS approach (plain CSS, SCSS, Bootstrap, Tailwind, MUI and so on), chart library and icon set.
2. List every route or page and map it to a pattern using the screen map in PAGE_PATTERNS.md.
3. Find the shared layout (sidebar, header) and the shared widgets (cards, tables, buttons, badges, charts).
4. Write the findings to `design-system/AUDIT.md`: stack, page → pattern table, shared component list, and risks such as inline styles or a CSS framework that will fight the new styles.

## Phase 1 — Foundations

1. Copy `design-system/` into the repo (or keep it where it is) and load these globally, before any page CSS, on every page:
   - Google Fonts (Inter and JetBrains Mono), or self-hosted equivalents
   - `design-system/tokens/tokens.css`
   - `design-system/css/meridian.css`
2. If the app uses Tailwind, add `tokens/tailwind.preset.js` as a preset. Use `ep-*` colours (for example `bg-ep-surface`, `text-ep-ink-muted`).
3. If the app uses a component library (Bootstrap, MUI, Ant and so on), map its theme variables to the `--ep-*` tokens so existing widgets match: primary = `--ep-brand`, font = `--ep-font-sans`, border radius = 6px, body text = `--ep-ink`, page background = `--ep-bg`.
4. Install Lucide for the framework.
5. Set up the chart library defaults from DESIGN_SYSTEM.md §6.

To check this phase: the app still works and nothing has moved yet, but the fonts have changed.

## Phase 2 — App shell

1. Replace the red sidebar with `.ep-sb` (COMPONENTS.md §2). Keep the existing routes and the expand/collapse behaviour, and use the active-state rules from that section.
2. Replace the header with `.ep-tb` (§3): breadcrumb from the route, search, alerts and account menu (move "Log out" into the account menu).
3. Wrap page content in `.ep-pg` and convert each page title to `.ep-ph` (§4).
4. Below 960px the sidebar is hidden. Add a menu button (`menu` icon, `.ep-iconbtn`) at the start of `.ep-tb` that toggles the class `ep-open` on `.ep-sb` to show it as a drawer.

To check this phase, compare against the left 248px and the top 56px of `reference/dashboard.html`.

## Phase 3 — Shared components

Build or restyle each shared component once, then reuse it:

| Legacy element | Meridian replacement |
|---|---|
| Red sidebar, red active pill | `.ep-sb`, with `.ep-ni.ep-on` (pink tint plus a 3px brand bar) |
| Top-right "Log out" pill | Avatar menu in `.ep-tb` |
| Stat boxes (Total endpoints 292…) | `.ep-kpi` with ratio and trend |
| Card titles in UPPERCASE | `.ep-ch h3`, sentence case |
| Donut per category (device type, OS) | Ranked bars `.ep-bl` |
| Donut per VLAN (6 donuts) | One coverage table `.ep-cov` + `.ep-sbar` |
| "Other — 243 (83%)" slice | Neutral bar at the end, plus an `ep-b-med` "243 unclassified" badge |
| "No data yet." | `.ep-nodata` inline, or `.ep-empty` with an action |
| Plain tables | `.ep-tbl` inside `.ep-card` with a toolbar and pagination |
| Status text in colour | `.ep-badge` or `.ep-pill` via one mapping helper |
| Default form inputs | `.ep-field`, `.ep-label`, `.ep-input` / `.ep-select`, `.ep-help` and `.ep-error` |
| Browser `alert()` / `confirm()` | `.ep-toast`, or a `.ep-modal` confirm |

Build the components in this order: Button → Badge/Pill → Card → KPI tile → Table (toolbar, bulk bar, pagination) → Form controls → Alert/Empty/Skeleton → Menu/Modal → Charts.

## Phase 4 — Pages

Migrate in this order, because it covers the most-used screens first:

1. Dashboard
2. Endpoints
3. Vulnerabilities
4. Enrollment tokens
5. Network coverage
6. Everything else, module by module

For each page:

1. State its pattern.
2. Rebuild the layout with the pattern's skeleton.
3. Swap in the shared components.
4. Delete the page-specific legacy CSS.
5. Run the checklist below.

After all pages are done, remove the unused legacy CSS files and any dead colour variables.

## Per-page checklist (Definition of Done)

- [ ] It uses one pattern from PAGE_PATTERNS.md, with one `h1` and at most one primary button.
- [ ] Component code contains no hex, rgb or named colours (`grep -nE "#[0-9a-fA-F]{3,8}\b|rgb\(" <files>` shows nothing outside tokens).
- [ ] Brand red appears only on the logo, the primary button, the active nav or tab, and checkbox/switch fills.
- [ ] Every status has a word, and severity uses `ep-badge` with the fixed vocabulary.
- [ ] Numbers use `.ep-num`, and hostnames, IPs, CVEs and versions use `.ep-mono`.
- [ ] Titles and buttons are in sentence case, and buttons start with a verb.
- [ ] Empty, loading (skeleton) and error states exist for every card and table.
- [ ] Keyboard: everything can be reached with Tab, the focus ring is visible, Esc closes menus and modals, and icon buttons have `aria-label`.
- [ ] The page works at 1440px, 1280px and 960px wide.
- [ ] Behaviour hasn't changed: same routes, API calls, form field names and test IDs. Existing tests pass.
- [ ] It matches the reference file visually at 1440px.
