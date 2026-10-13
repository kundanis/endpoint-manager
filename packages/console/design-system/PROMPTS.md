# Prompts for Claude Code

Paste these into Claude Code from the root of the frontend repo, one at a time. Review and commit after each. Each prompt assumes `design-system/` is in the repo root.

---

### 0 · Audit (read-only)

```
Read design-system/CLAUDE.md and every file in design-system/docs/. Don't change any code yet.
Audit the frontend: framework, templating, CSS approach, chart library, icon set, the shared layout files,
and every route/page. Map each page to a pattern from design-system/docs/PAGE_PATTERNS.md.
Write the result to design-system/AUDIT.md (stack, page→pattern table, shared components to build,
risks). Then summarise it for me and propose the Phase 1 changes.
```

### 1 · Foundations

```
Do Phase 1 of design-system/docs/MIGRATION_PLAN.md.
Load the fonts, design-system/tokens/tokens.css and design-system/css/meridian.css globally, before page CSS.
Map our component library / CSS framework theme to the --ep-* tokens, install Lucide, and set chart defaults
per DESIGN_SYSTEM.md §6. Don't change any page layouts yet. Show me the diff summary and anything you couldn't map.
```

### 2 · App shell

```
Do Phase 2 of the migration plan. Rebuild the sidebar, top bar and page wrapper exactly as in
design-system/docs/COMPONENTS.md §1–4, matching design-system/reference/dashboard.html.
Keep every existing route, permission check and the logout action (move it into the avatar menu).
Use our real navigation data; active states follow COMPONENTS.md §2. Add the ≤960px drawer.
```

### 3 · Shared components

```
Do Phase 3. Create (or restyle) reusable components for: Button, Badge, Pill, Card, KPI tile, Data table
(toolbar, bulk bar, pagination), form fields, Alert, Empty state, Skeleton, Menu, Modal, Donut, Ranked bars,
Coverage table. Each must render the exact markup and ep- classes in COMPONENTS.md. Add one status-mapping helper
(COMPONENTS.md §6) and replace ad-hoc status colouring with it. Replace browser alert()/confirm() with Toast/Modal.
List each component with its file path when done.
```

### 4 · Dashboard

```
Migrate the Dashboard page to Pattern A using design-system/reference/dashboard.html as the visual target.
Use our real API data. Replace the five donuts and the six VLAN donuts as described in MIGRATION_PLAN.md
(Phase 3 table). Where the reference shows data we don't have yet (trend deltas, CVE severity counts, attention
table), leave that slot out cleanly and list it for me. Don't invent data. Run the per-page checklist and report.
```

### 5 · Each further page

```
Migrate <PAGE NAME / ROUTE> to the Meridian design system.
1) Tell me which pattern from PAGE_PATTERNS.md it uses. 2) Rebuild it with the shared components.
3) Keep behaviour identical (routes, API calls, field names, test IDs). 4) Remove page-specific legacy CSS.
5) Run the per-page checklist in MIGRATION_PLAN.md and report each item.
```

### 6 · Cleanup

```
All pages are migrated. Find legacy CSS, colour variables, icon imports and components that are no longer used,
and remove them. Search for hard-coded colours outside design-system/tokens and fix them. Run the build and tests
and report anything left.
```

### Spot fixes

```
This screen doesn't follow design-system/CLAUDE.md: <describe or paste screenshot>.
Fix it using only existing ep- components and tokens. Explain which rule it broke.
```
