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
| 3 Shared components | Not started |
| 4 Pages | Not started (every page still renders legacy markup through the bridge) |

## Page → pattern map

| Route | Page | Pattern |
|---|---|---|
| /dashboard | DashboardPage | A |
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
- `window.confirm`/`alert` usage (about 21 call sites) still needs replacing with `.ep-modal` and `.ep-toast` in phase 3.
- The JS bundle is about 930 kB. The large-chunk warning predates this work (Recharts and pages aren't code-split).
