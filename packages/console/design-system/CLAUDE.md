# Endpoint Pro — UI rules for Claude Code (Meridian design system)

You are revamping the Endpoint Pro frontend to the **Meridian** design system in `design-system/`. These rules take priority over existing styles in the codebase.

## Read first, in this order

1. `design-system/docs/DESIGN_SYSTEM.md`: principles, colour meaning, type, spacing, layout.
2. `design-system/docs/COMPONENTS.md`: the class contract and copy-paste markup for every component.
3. `design-system/docs/PAGE_PATTERNS.md`: which template each screen uses.
4. `design-system/docs/MIGRATION_PLAN.md`: the order of work and the checklist for each page.
5. To see the target, open the files in `design-system/reference/`: `dashboard.html`, `endpoints-list.html`, `form-page.html` and `components.html`. Match them visually.

## Non-negotiable rules

1. **Tokens only.** Every colour, radius, shadow and font comes from `tokens/tokens.css` as `var(--ep-*)`. Never write a hex, rgb() or named colour in component code. If a value is missing, add a token to `tokens.css` and `tokens.json` instead of hard-coding it.
2. **Use the `ep-` classes from `css/meridian.css`** with the exact markup in COMPONENTS.md. Don't invent parallel classes for something that already exists. In a component framework (React, Vue, Angular, Blazor, Razor and so on), build thin wrappers that output this markup and these classes.
3. **Red is the brand, not a status.** `--ep-brand` (#b3141b) appears only on the logo, the one primary button per view, the active nav marker and the active tab underline. Severity uses `--ep-sev-*`. Never colour a large surface (sidebar, header, card) with brand red.
4. **Status is never colour alone.** Every badge, pill or chart segment has a text label or count next to it. Use the fixed words: Critical, High, Medium, Low; Online, Offline; Managed, Unmanaged; Trusted, Not trusted, Not assessed; Compliant, Clean.
5. **Title Case for headings and the sidebar menu** (product decision, 2026-11): page titles, card and section titles, tab names, dialog titles, subheadings and sidebar items capitalise every word except a, an, the, and, or, nor, but, of, in, on, to, by, for, at, as, via, per, vs, unless the word is first or last ("Enrollment Tokens", "Allow Everything Installed in Program Files"). Acronyms and product spellings keep theirs (USB, DLP, macOS). Names from data (policy names, hostnames) are never re-cased. **Sentence case** for everything else: buttons, form labels, menu actions, alert and empty-state titles, table column headers and body text. Uppercase is allowed only via `.ep-ov` (nav section header) and table column headers in `.ep-cov`.
6. **Numbers** use tabular figures (`.ep-num`) and show context: "74 · 25%", "195 of 320 seen". Hostnames, IPs, CVE IDs, hashes and versions use `.ep-mono`.
7. **Charts:** donuts only for 2–3 part ratios. Use ranked horizontal bars for categories and stacked bars (`.ep-sbar`) for coverage. Never draw one donut per item (for example, one per VLAN). Series colours: `--ep-chart-1` … `--ep-chart-6` in order. Semantic charts use `--ep-ok`, `--ep-warn-fill`, `--ep-sev-critical` and `--ep-neutral`.
8. **Every list or table has an empty state** (`.ep-empty`) that names the next action, and a loading state (`.ep-skel`). Never leave a blank card or show "No data yet." on its own.
9. **Accessibility:** keep visible focus (`:focus-visible` ring is in the CSS); icon-only buttons need `aria-label`; form inputs need a `<label>`; text contrast is already ≥ 4.5:1 in the tokens, so don't lighten text below `--ep-ink-subtle`.
10. **Icons:** use Lucide (`lucide`, `lucide-react` or the matching package for your framework) at 16px, stroke 1.7. The mapping is in COMPONENTS.md → Icons. Don't mix icon sets.
11. **Don't change behaviour.** This is a visual revamp: keep routes, API calls, form field names, IDs used by tests, and permissions logic exactly as they are.

## How to work

- Do one page or shared component per change. After each change, list the files you touched and anything you couldn't map to a pattern.
- Before editing a page, say which pattern from PAGE_PATTERNS.md it maps to.
- When the legacy UI shows data the reference doesn't cover, compose it from existing components. Don't create a new visual style.
- Remove legacy CSS only after every page that used it has been migrated (see MIGRATION_PLAN.md, phase 4).
- Run the per-page checklist in MIGRATION_PLAN.md before calling a page done.
