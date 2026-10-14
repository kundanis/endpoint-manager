# Endpoint Pro — Meridian design system

This is the design system for revamping the Endpoint One frontend in the **Meridian** direction: a light enterprise look that keeps crimson as the brand colour. It's written so that **Claude Code** (or any developer) can apply it to the existing codebase without guessing.

## What's inside

```
design-system/
├── CLAUDE.md                 ← rules Claude Code must follow (merge into the repo's root CLAUDE.md)
├── PROMPTS.md                ← ready-to-paste prompts, phase by phase
├── tokens/
│   ├── tokens.css            ← all design tokens as CSS variables (--ep-*) — load globally
│   ├── tokens.json           ← same tokens as data (for scripts, theming libraries, Figma)
│   └── tailwind.preset.js    ← only if the app uses Tailwind
├── css/
│   └── meridian.css          ← every component style (ep-* classes), framework-agnostic
├── docs/
│   ├── DESIGN_SYSTEM.md      ← principles, colour meaning, type, spacing, layout, charts, voice, a11y
│   ├── COMPONENTS.md         ← class contract + copy-paste markup for every component
│   ├── PAGE_PATTERNS.md      ← 5 page templates + which screen uses which
│   └── MIGRATION_PLAN.md     ← phased plan, legacy → new mapping, per-page checklist
└── reference/                ← open in a browser: the visual target
    ├── dashboard.html        ← redesigned dashboard (Pattern A)
    ├── endpoints-list.html   ← list page with filters, bulk actions, pagination (Pattern B)
    ├── form-page.html        ← create/edit form with validation (Pattern C)
    └── components.html       ← gallery of every component and token
```

## How to use it with Claude Code

1. Copy the folder into the root of your frontend repo as `design-system/`.
2. Add these lines to the repo's root `CLAUDE.md` (create the file if it doesn't exist):

   ```
   ## UI / design system
   All frontend work follows design-system/CLAUDE.md. Read it before any UI change.
   ```

3. Open Claude Code in the repo and paste the prompts from `PROMPTS.md` one phase at a time. Start with the audit, then foundations, shell, components and pages.
4. After each phase, open the app beside `reference/*.html` and compare.

## Key decisions (summary)

- Neutral white and grey surfaces, with crimson (#b3141b) only on the logo, the primary button and the active nav or tab. The red sidebar is gone.
- Severity has its own colours: Critical red, High orange, Medium amber, Low blue. It's never brand red, and never shown by colour alone.
- Inter for UI, JetBrains Mono for hostnames, IPs, CVEs and versions.
- KPIs show context (ratio, trend). Categories use ranked bars instead of donuts, and VLAN coverage is one table with stacked bars.
- Everything is namespaced (`ep-`, `--ep-`), so it can run next to the legacy CSS during a gradual migration.

## Notes

- The rows in the reference tables and the CVE severity counts are sample data. The fleet numbers come from the current dashboard.
- The shield logo is a placeholder. Replace the SVG in `.ep-brandrow` with the official mark.
- Fonts load from Google Fonts. If the app is deployed offline or on-premises, self-host Inter and JetBrains Mono.
