# Meridian migration — audit and progress

## Stack

- React 18 + Vite + TypeScript, React Router v6, TanStack Query. No component library, no Tailwind.
- Styling: one global stylesheet, `src/index.css`. No CSS modules.
- Charts: Recharts (dashboard donuts). Colours come from `src/chartTheme.ts`, which maps to `--ep-*` tokens.
- Icons: Lucide (`lucide-react`), 16px at stroke 1.7, with the class `ep-ic`.
- Fonts: Inter and JetBrains Mono, self-hosted via `@fontsource/*` because the console runs on-premises.
- Location: `design-system/` lives inside `packages/console/`, because the Docker build only copies `packages/`.

## How the CSS is loaded (`src/main.tsx`)

The order is fonts → `tokens/tokens.css` → `css/meridian.css` → `src/index.css`.

`src/index.css` holds two kinds of migration scaffolding:

- A variable bridge: legacy names such as `--accent` and `--online` resolve to `--ep-*` tokens.
- A legacy page bridge: it restores element defaults that the `.ep-app *` reset removes, scoped to `.ep-pg:where(:not(:has(.ep-ph)))`. A page leaves that scope automatically when it renders a Meridian page header (`.ep-ph`). After that, only `ep-*` styles apply to it.

## Phase status

| Phase | Status |
|---|---|
| 0 Audit | Done (this file) |
| 1 Foundations | Done: fonts, tokens, meridian.css, Lucide, chart palette, legacy classes re-themed to tokens |
| 2 App shell | Done: `.ep-sb` sidebar (Operations/Administration), `.ep-tb` top bar with breadcrumb and avatar menu (Log out moved there), `.ep-pg`, ≤960px drawer. Login page rebuilt as a Meridian card |
| 3 Shared components | Done: `src/components/ui/` (see below). All `window.confirm`/`alert`/`prompt` calls replaced with Meridian modals and toasts; `StatusBadge` now renders `ep-badge` |
| 4 Pages | In progress. Done: Dashboard. All other pages still render legacy markup through the bridge |

## Shared components (`src/components/ui`, import from `../components/ui`)

| Need | Component |
|---|---|
| Buttons | `Button` (variant: primary, secondary, ghost, danger, danger-solid; size sm; Lucide `icon`), `IconButton` (required `label`) |
| Status | `Status value=…` maps backend values via `statusDisplay()` to the fixed vocabulary; `Badge`, `Pill`, `Tag`. Legacy `StatusBadge kind/label` still works and renders `ep-badge` |
| Page structure | `PageHeader`, `Tabs` (route or state), `Card` (`flush` for tables), `Row` (21/12/3), `KeyValueList` |
| KPIs | `KpiStrip`, `Kpi` (suffix, footer, bar, `to`), `Delta` |
| Tables | `Toolbar`, `SearchInput`, `Segmented`, `BulkBar`, `Pagination`, `RowMenu`; the table itself is `<table className="ep-tbl">` |
| Forms | `Field`, `FormSection`, `FormGrid`, `FormFooter`, `Switch`, `Check` |
| Feedback | `Alert`, `EmptyState`, `Skeleton` |
| Charts | `Donut` (2–3 parts only), `RankedBars` (`tail` for long-tail "Other"), `CoverageTable`, `Legend` |
| Dialogs | `useConfirm()`, `usePrompt()` (with `validate`), `useToast()`; `<DialogProvider>` is mounted in `main.tsx` |

Shared components can be used inside legacy pages: the legacy bridge skips anything inside an `ep-*` component.

## Page → pattern map

| Route | Page | Pattern |
|---|---|---|
| /dashboard | DashboardPage | A (migrated) |
| /endpoints | AgentsPage | B |
| /endpoints/:id | AgentDetailPage | D |
| /enrollment-tokens | EnrollmentTokensPage | B + C |
| /commands | CommandsPage | B + C |
| /packages | PackagesPage | B + C |
| /agent-updates | AgentUpdatesPage | B (KPI strip) |
| /asset-settings | AssetSettingsPage | E |
| /network-scan | NetworkScanPage | A (landing) + B |
| /software-licenses | SoftwareLicensesPage | B |
| /vulnerabilities | VulnerabilitiesPage | B (severity KPI strip) |
| /patches | PatchesPage | B |
| /security-config | SecurityConfigPage | B + C |
| /zero-trust | ZeroTrustPage | A-lite |
| /edr | EdrPage (hidden from nav) | B |
| /data-discovery | DataDiscoveryPage | B |
| /dlp/* | DlpPage, DlpContentPoliciesPage, EmailAttachmentBlockPage | B with tabs; rules use C |
| /data-movement | DataMovementPage | B |
| /epm/* | EpmPage + 6 tab pages (App control, Web, PII, Command, IP, USB) | B with tabs; rules use C |
| /access-exceptions | AccessExceptionsPage | B |
| /user-productivity | UserProductivityPage | A |
| /licensing | LicenseActivationPage | C |
| /admin-users | AdminUsersPage | B + C |
| /login | LoginPage | Done (Meridian card) |

## Gaps and risks

- **Top-bar search** is left out because the console has no global or endpoint free-text search to connect it to. Add it when that search exists.
- **Notifications bell** is left out because there is no alerts feed.
- **Nav expand behaviour** keeps the existing multi-expand. COMPONENTS.md §2 asks for one module at a time; changing that is a behaviour decision.
- **Endpoint offline dot** changed from red to neutral grey, per the Meridian rule "offline = `--ep-neutral`". The old code had deliberately used red.
- **Legacy buttons** are now secondary (white) by default, and only `type="submit"` buttons stay brand red. This replaces the old look where every button was red.
- **Dashboard slots left out (no data in the API):** KPI trend deltas ("+6 enrolled this week", "+9 since yesterday"), open CVEs by severity, and the per-endpoint "Endpoints needing attention" table. Each needs a new field on `/admin/dashboard/summary`. Unmanaged devices (real data) fills the full-width table slot instead.
- Recharts was removed with the dashboard migration; the JS bundle went from about 930 kB to 620 kB. Pages still aren't code-split, so the large-chunk warning remains.
