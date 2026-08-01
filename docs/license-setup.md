# Licensing module

Endpoint Manager enrollment is gated by a license activated against a separate, standalone
**License Server** (`packages/license-server`) — the vendor's own tool, with its own database
and admin console, entirely independent of any customer's Endpoint Manager deployment. This
mirrors a real vendor/customer relationship: one License Server serves many separate customer
installs, each of which activates exactly one license key.

For deploying the two as separate machines (the real vendor/customer topology), see
`docs/two-machine-deployment.md` — this doc covers the architecture and mechanics; that one
covers which package goes on which machine and in what order.

## Architecture

- `packages/license-shared` — the wire-protocol contract (`@license/shared`) shared by the
  License Server and every Endpoint Manager deployment that talks to it: `/activate`,
  `/revalidate`, `/unlock-request` request/response shapes. Deliberately separate from
  `@em/shared` to keep the two systems genuinely independent.
- `packages/license-server` — the standalone License Server (Express + Prisma + SQL Server,
  its own `LicenseServerDb`). Vendor admins manage `Entity` (customer orgs) and `LicenseKey`
  records here.
- `packages/license-console` — the vendor-only admin UI for the License Server (Entities,
  License Keys, Unlock Requests). Runs on port 5174 in dev.
- `packages/server` (Endpoint Manager) — holds a `LicenseServerConfig` row (singleton, which
  central License Server to talk to — admin-configured at runtime, not a deploy-time env var)
  and a `LicenseActivation` row (singleton, this deployment's current activation state),
  enforcing the latter on the agent-enrollment path.
- `packages/console` (Endpoint Manager) — a top-level **Licensing** nav item with two steps:
  **Licence API** (connect to the License Server) and, once connected, activating a key,
  viewing status, and sending unlock requests.

## The license key lifecycle

1. A vendor admin creates an `Entity` and issues it a `LicenseKey` (License Console → License
   Keys → Issue). A key specifies **max agents** (a fleet-wide cap, not per-agent),
   **validity** (1/2/3 years or perpetual), and **modules** (which of the six top-level console
   modules this key grants — see "Per-module licensing" below). The full plaintext key is shown
   exactly once at issuance — only its hash (`keyStringHash`) and last-4 (`keySuffix`) are
   stored after that.
2. The customer's Endpoint Manager admin first goes to Console → Licensing → **Licence API**
   and enters the License Server's address. This is only saved once `POST /server-config`
   confirms a live `GET {url}/health` succeeds — a wrong or unreachable address is caught here,
   not later at activation time (`licenseServerConfig.service.ts`).
3. With a connection established, the admin activates the key (Console → Licensing →
   Activate). This calls the License Server's public `POST /api/activate` with the key and a
   locally-generated `deploymentId`. Activation is **one-time-use**, enforced with an atomic
   compare-and-swap (`updateMany({ where: { status: "ISSUED" } })`, checking `count === 1`) so
   two concurrent activation attempts on the same key can never both succeed.
4. On success, the License Server locks the key to that `deploymentId` and returns a
   `bindingToken` — shown once, never stored in plaintext on the License Server (only its
   hash). Endpoint Manager stores both the key string and the bindingToken **encrypted**
   (`utils/fieldEncryption.ts`, the same AES-256-GCM layer used for `SoftwareLicense.licenseKey`
   etc.) since it must send both back verbatim on every future `/revalidate` call.
5. Endpoint Manager re-validates roughly once a day (`index.ts`'s `scheduleLicenseRevalidation`)
   against `/api/revalidate`. An explicit `REVOKED`/expired response fails closed immediately.
   A network error (License Server unreachable) fails **open** — enrollment keeps working on
   cached state for `LICENSE_OFFLINE_GRACE_DAYS` (default 14) measured from the last successful
   revalidation, then fails closed if the outage outlasts the grace window.
6. If a deployment loses its bindingToken (or is migrating to new hardware), it sends an
   **unlock request** (Console → Licensing → Request an unlock) — no proof of possession is
   required, since this IS the recovery path for a lost token. A vendor admin reviews and
   approves it manually in the License Console, which resets the key to `ISSUED` so it can be
   activated again (a fresh `bindingToken` is issued on that next activation).

## What gets enforced, and what doesn't

- Enforcement only gates **new agent enrollment** — an expired, revoked, or over-cap license
  never disrupts agents already enrolled.
- Controlled by `LICENSE_ENFORCEMENT_ENABLED` in `packages/server/.env` (default `false`).
  Keep it off while setting up a new environment; flip it on once a license has been activated.
- `NotLicensedError` (no activation, or explicitly revoked/expired) and `AgentCapExceededError`
  (fleet already at the license's agent cap) both surface as HTTP 403 from
  `POST /api/agent/enroll` — the first use of 403 in this codebase, reserved specifically for
  licensing denials (401 stays reserved for auth, 404/409/400 for their usual meanings).

## Per-module licensing

A `LicenseKey` (and the `LicenseActivation` it produces once activated) carries a `modules`
field — a JSON array stored in an `NVARCHAR` column (the same denormalized-array idiom already
used elsewhere in this codebase, e.g. `CommandJob.targetGroupIds`), holding a subset of the
fixed six-value `LICENSE_MODULES` enum (`@license/shared`):
`ENDPOINT_MANAGER`, `NETWORK_MANAGER`, `SOFTWARE_MANAGER`, `SECURITY_MANAGER`, `DATA_MANAGER`,
`USER_MANAGER` — one per top-level console nav group. The vendor picks the modules at issuance
time; whatever the key grants is exactly what the customer's Endpoint Manager gets back on
every `/activate` and `/revalidate` call, so a module added or removed by re-issuing/upgrading
a key takes effect on the deployment's next scheduled revalidation without a redeploy.

Enforcement is defense-in-depth, both layers reading from the same
`getEffectiveLicense()`/`isModuleLicensed()` helpers in `licenseActivation.service.ts` so they
can never disagree:

- **Backend** — `middleware/requireModule.ts` is mounted on every module-specific router in
  `app.ts` (e.g. `requireModule("NETWORK_MANAGER")` in front of `networkScanRouter`). An
  API call for a module not included in the current license gets HTTP 403 with
  `{ error, moduleKey }`, regardless of what the UI shows.
- **Console** — `navConfig.ts` tags each top-level nav entry with its `licenseModule`;
  `Layout.tsx` grays out and lock-icons any nav module not in `licenseStatus.modules`, and
  every corresponding route in `App.tsx` is wrapped in `<RequireModule module="...">`, which
  renders a "This module is locked" message instead of the page for direct URL navigation.

Both layers are gated behind `LICENSE_ENFORCEMENT_ENABLED` — with it off, nothing is locked
regardless of the `modules` array, matching the existing agent-cap enforcement convention.
Existing licenses issued before this feature shipped were backfilled (via the migration's
column default) to grant all six modules, so no previously-activated deployment lost access
to anything already in use.

## Running the License Server locally

```powershell
cd packages/license-server
npx prisma migrate dev --name init   # first time only
npm run db:seed                       # bootstraps the first LicenseAdmin from .env
npm run dev                           # listens on :4200 (plain HTTP in dev)

cd ../license-console
npm run dev                           # vendor admin UI on :5174, proxies /api -> :4200
```

Configure the Endpoint Manager side: log in to its console and go to Licensing →
Licence API, enter `http://localhost:4200`, and connect. `LICENSE_SERVER_URL` in
`packages/server/.env` is optional and only used as a local-dev convenience seed (read
once if no `LicenseServerConfig` row exists yet); a real deployment has nothing there
until the admin configures it through the UI. `LICENSE_OFFLINE_GRACE_DAYS` (default 14)
and `LICENSE_ENFORCEMENT_ENABLED` (flip to `true` after activating a real key) remain
plain env vars.

## A note on the two Prisma clients

`packages/license-server` generates its Prisma Client to a package-local path
(`generated/prisma`, set via the schema's `generator client { output = ... }`) instead of
the default. Without that, npm workspaces would hoist both `@em/server`'s and
`@license/server`'s identical `@prisma/client` dependency to the same root
`node_modules/@prisma/client`, and each package's `prisma generate` would silently overwrite
the other's generated client — wrong types, wrong embedded schema. `packages/server` keeps the
default (hoisted) output since nothing else in this monorepo shares that location with it.
