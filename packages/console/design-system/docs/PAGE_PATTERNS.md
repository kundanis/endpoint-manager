# Meridian — page patterns

Every screen in Endpoint Pro uses one of five templates. Pick the template first, then fill it with components from COMPONENTS.md. The reference files in `reference/` are the visual targets.

## Pattern A — Overview dashboard (`reference/dashboard.html`)

The page is built in this order:

1. Page header: title, a live/updated line, Export and one primary action.
2. Optional tabs.
3. KPI strip: 3–5 `.ep-kpi` tiles. Each answers "how many, out of how many, getting better or worse?"
4. `.ep-row.ep-r21`: the main analysis card on the left (often a table with bars) and the composition or posture card on the right.
5. `.ep-row.ep-r3`: three supporting breakdowns (ranked bars or a small donut).
6. A full-width "needs attention" table showing the top 5 rows, with a link to the full list.

Use it for the main Dashboard and for module landing pages (Security Manager overview, Network Manager overview, Data Manager overview).

## Pattern B — List or index (`reference/endpoints-list.html`)

1. Page header: title, a one-line description, secondary actions (Export) and the primary create action.
2. One `.ep-card` that holds the toolbar (search, filters and a segmented quick filter), the bulk bar (only while rows are selected), `.ep-tbl` and pagination.
3. Empty state inside the card when there are no rows at all, and "No results" with a "Clear filters" link when filters return nothing.

Use it for Endpoints, Enrollment tokens, Commands, Packages, Agent updates, Vulnerabilities, Patches, Data discovery results, DLP incidents, Data movement, Access exceptions, Users and Administrators.

## Pattern C — Create or edit form (`reference/form-page.html`)

1. Page header: the title is a verb phrase ("Create enrollment token", "Edit policy"), with a description and no actions on the right.
2. A two-column layout, `grid-template-columns: minmax(0,1fr) 360px`:
   - Left: one `.ep-card` form, split into `.ep-section` blocks, each with an `h4`, a one-line explanation and an `.ep-form-grid`. It ends with `.ep-formfoot` (Cancel, then the primary action).
   - Right: context. An `.ep-alert` for risk notes, plus a summary or preview card (`.ep-kv`, `.ep-code`).
3. Below 960px the right column moves under the form.

Use it for Enrollment token create/edit, Packages upload, Security configuration policies, DLP rules, EPM rules, Asset settings, Licensing and Administrator invites.

## Pattern D — Detail page (compose from components)

1. Breadcrumb ending in the object name, for example `Endpoints › SXG-LT-0142`.
2. Page header: `h1` with the object name in `ep-mono` for hosts, then status pills and the key badge in the `p` line. Actions go on the right: secondary actions plus one primary, with destructive actions in a `⋯` menu.
3. `.ep-tabs`: Overview · Vulnerabilities · Software · Network · Activity.
4. The Overview tab uses `.ep-row.ep-r21`:
   - Left: cards with `.ep-kv` property lists (Device, Agent, Network).
   - Right: a posture card (severity counts, Zero Trust status) and recent activity.
5. Every other tab is Pattern B (a table) scoped to this object.

## Pattern E — Settings (compose from components)

The left column is a 220px vertical list of setting groups. Reuse the `.ep-sub` look inside an `.ep-card`. The right column is Pattern C sections that save per section, each with its own `.ep-formfoot`. Use it for Asset settings and organisation settings.

## Screen map (current navigation → pattern)

| Module | Screen | Pattern |
|---|---|---|
| — | Dashboard | A |
| Endpoint Manager | Endpoints | B (→ D for one endpoint) |
| | Enrollment tokens | B, plus C for create/edit |
| | Commands | B (commands history), plus a C-style modal or page to run a command |
| | Packages | B, plus C to upload |
| | Agent updates | B (versions and rollout status: KPI strip above the table) |
| | Asset settings | E |
| Network Manager | (landing) | A: coverage by VLAN, unmanaged devices |
| | Scans / devices | B |
| Software Manager | (landing / inventory) | B |
| Security Manager | Vulnerabilities | B with severity KPI strip on top |
| | Patches | B |
| | Security configuration | B (policies) plus C (edit policy) |
| | Zero Trust | A-lite (KPI strip + table) |
| Data Manager | Data discovery, DLP, Data movement, EPM, Access exceptions | B; rules use C |
| User Manager | User productivity | A (KPIs + charts) |
| Licensing | — | C (read-only `.ep-kv` + a usage KPI strip) |
| Administrators | — | B, plus C for invite/edit |

## Rules for all patterns

- One `h1` per page and at most one primary button in the page header.
- A bare number is never a page's only content. Pair it with a ratio, a trend or an action.
- Sections stack with the 16px `.ep-pg` gap. Don't add extra margins or divider lines between cards.
- Tables always sit inside a card, flush to its edges.
- Loading uses skeletons inside the final layout. Errors use an `.ep-alert-critical` at the top of the affected card with a Retry button.
