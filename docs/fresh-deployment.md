# Deploying to a brand-new entity

This is the full path from "empty Windows server" to "fleet of enrolled agents" for a
new customer entity. It packages exactly `packages/server` + `packages/console` +
`packages/agent` (+ `packages/shared`) — the customer-facing product. The License
Server (`packages/license-server` + `packages/license-console`) is **not** part of
this package; it stays centrally hosted by the vendor, one instance serving every
customer entity.

## 1. Prerequisites at the new site

- A Windows Server (or Windows 10/11) machine to host the product, with:
  - Node.js is **not** required — the deployment package embeds a portable `node.exe`.
  - SQL Server installed and reachable (a local default instance is simplest).
- Network reachability from this machine out to the vendor's central License Server
  (for license activation and daily re-validation), and inbound reachability from every
  endpoint that will run the agent.

## 2. Build the deployment package (done once per release, on the dev/build machine)

```powershell
cd packages\server
npm run package    # runs scripts\package-server.ps1
```

Produces `packages\server\dist-installer\EndpointManagerServerInstaller.zip` — a
self-contained folder (compiled server, compiled console served as static files by
that same server, a portable Node runtime, and the setup scripts below). Copy this zip
to the new site.

## 3. First-run setup at the new site

Unzip it wherever you want the product to live (e.g. `C:\EndpointManager`), then run
**`Setup.bat`** (elevates via UAC automatically) or, from an admin PowerShell prompt:

```powershell
.\setup.ps1 `
  -SqlServerInstance "<this-machine's-actual-hostname>" `
  -AdminEmail "admin@customer.example"
```

Any parameter left off is prompted for interactively (the admin password prompts as a
masked `SecureString`, or pass one built with `ConvertTo-SecureString ... -AsPlainText -Force`
for scripted/unattended runs). What it does, in order:

1. Provisions a dedicated SQL Server login + `EndpointManagerDb` (+ a `_shadow`
   database Prisma's schema requires) — least-privilege, scoped to `db_owner` on that
   one database only, never `sa`. Pass `-SkipDbProvision -DatabaseUrl "..." -ShadowDatabaseUrl "..."`
   instead if the database already exists. Connection strings default to
   `trustServerCertificate=true` — a brand-new SQL Server install only has its own
   auto-generated self-signed certificate, which nothing trusts by default, so strict
   validation (`false`) fails with *"certificate chain... terminated in a root
   certificate which is not trusted"*. The connection is still encrypted either way; pass
   `-TrustServerCertificate:$false` once a real (or properly-trusted) certificate is
   installed on the SQL Server and you want strict validation too — see `docs/tls-setup.md`.
2. Generates `JWT_SECRET` and `FIELD_ENCRYPTION_KEY` (AES-256-GCM key for the columns
   listed in `utils/fieldEncryption.ts` — losing this key after go-live makes every
   value it encrypted permanently unrecoverable; back it up once it's live).
3. Writes `app\.env` from all of the above, with `LICENSE_ENFORCEMENT_ENABLED=false` and
   **no License Server address at all** — both are deliberately left for the entity
   admin to configure from inside the console after their first login (see step 4), not
   baked into a deploy-time file.
4. Applies all database migrations (`prisma migrate deploy`) and seeds the first admin
   user (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) — same idempotent seed used in dev, safe to
   re-run.
5. Registers a `EndpointManagerServer` Scheduled Task (boot trigger, `SYSTEM` principal,
   auto-restart on failure — same pattern as the agent's own installer, no third-party
   service wrapper) and starts it immediately.

On success it prints the console URL and, if you didn't pass `-AdminPassword`, a
generated one — shown exactly once, same discipline as every other one-time secret in
this product (enrollment tokens, license keys). Save it now.

## 4. Connect to the License Server, then activate

Open the console (`http://<this-server>:4000/` by default, or your configured
`-Port`) and log in with the admin credentials from step 3. Go to **Licensing → Licence
API** and enter the vendor's central License Server address (URL or IP) — this is only
saved once a real connection to it is confirmed (a live reachability check, not just
format validation), so a typo or an unreachable address is caught immediately rather
than failing later at activation time.

Once connected, the **Activate a license key** form becomes available. You need a
license key issued by the vendor for this entity first — from the vendor's License
Console (`packages/license-console`), an admin there creates an `Entity` for this
customer and issues a `LicenseKey` (agent cap, validity, and licensed modules). Enter it
here to activate;
this locks the key to this deployment and the License Server returns a one-time
`bindingToken` that gets stored (encrypted) alongside it — the same key can never be
activated anywhere else afterward (see `docs/license-setup.md` for the full mechanics).

Once activated, flip `LICENSE_ENFORCEMENT_ENABLED=true` in `app\.env` and restart the
`EndpointManagerServer` task (`schtasks /end /tn EndpointManagerServer` then
`schtasks /run /tn EndpointManagerServer`) so new-agent enrollment is actually gated by
it — existing enrollment (there is none yet, at a fresh site) is never disrupted either
way, only *new* enrollment is gated.

## 5. TLS (recommended before enrolling real endpoints)

The server runs plain HTTP by default. For production, either terminate TLS at a
reverse proxy (nginx/IIS/Caddy) in front of it, or set `TLS_PFX_PATH`/
`TLS_PFX_PASSPHRASE` in `.env` — see `docs/tls-setup.md` for the exact self-signed-cert
recipe (dev/test) or how to point at a real CA certificate (production). If you use a
self-signed cert, the agent installer's `-ServerUrl` still just points at `https://...`;
each endpoint's agent trusts that one specific certificate via `UEM_SERVER_CA_PATH`
(see the same doc).

## 6. Create an enrollment token and install agents

The deployment package (`EndpointManagerServerInstaller.zip`, built via
`npm run package -w @em/server`) already bundles a ready-to-download agent installer at
`app\agent-installer\EndpointProAgentSetup.exe` — no separate build/copy step needed for
a fresh setup from that package.

(If you're updating an existing install that predates this, or building from source
without the packaged zip, build and place it manually instead:
`cd packages\agent && npm run package`, then copy the resulting
`dist-installer\EndpointProAgentSetup.exe` into `packages\server\agent-installer\` — or
wherever `AGENT_INSTALLER_DIR` points, see `.env.example`. One-time step either way; the
same installer is reused for every future token/endpoint.)

In the console, go to **Console → Endpoint Manager → Enrollment Tokens**:

1. Click **Download agent installer** once (or reuse a copy you already have) and place
   it on the target machine.
2. Create a token (label, expiry, uses-remaining, and optionally a **target group** — any
   endpoint that enrolls with this token is automatically added to that group, no manual
   post-enrollment assignment needed).
3. Confirm/edit the **Server URL** field (pre-filled from the console's own address — in a
   single-server deployment this is already correct) and click **Download setup script**.
4. Place the setup script next to the installer on the target machine and double-click it
   — it installs and enrolls the agent with no further input.

The manual path still works too: run `EndpointProAgentSetup.exe` directly (it prompts for
a server URL and token interactively), or `EndpointProAgentSetup.exe <serverUrl> <token>`
non-interactively for a scripted rollout — neither the exe nor `install.ps1` has a
baked-in default server, so there's no risk of accidentally enrolling a new entity's
endpoints against the wrong server.

## Troubleshooting

**`P1011: Error opening a TLS connection... certificate chain... terminated in a root
certificate which is not trusted`** — `setup.ps1` was run with `-TrustServerCertificate:$false`
(or an older build before that default existed) against a SQL Server with no trusted
certificate installed. Fix: edit `app\.env`, change `trustServerCertificate=false` to
`trustServerCertificate=true` on both `DATABASE_URL` and `SHADOW_DATABASE_URL`, then
finish setup manually from where it stopped:
```powershell
cd app
..\node\node.exe node_modules\prisma\build\index.js generate --schema prisma\schema.prisma
..\node\node.exe node_modules\prisma\build\index.js migrate deploy --schema prisma\schema.prisma
..\node\node.exe node_modules\tsx\dist\cli.mjs prisma\seed.ts
```
Then start the server (`Start-Server.bat`) or register the Scheduled Task by re-running
`Setup.bat`/`setup.ps1` with `-SkipDbProvision -DatabaseUrl "..." -ShadowDatabaseUrl "..."`
pasted from the now-fixed `.env`.

## Updating this install later

Once a site is live, use `docs/updating-existing-deployment.md`
(`npm run package:update -w @em/server` → `EndpointManagerServerUpdate.zip`) instead of
re-running this fresh-install package — it ships new code + migrations only, and never
touches the existing database, `.env`, or `app\uploads`.

## What this package deliberately does not automate

- SQL Server installation itself, or TDE (transparent data encryption) setup — both
  administrative decisions for the customer's own DBA, not scripted here (this
  codebase has never scripted TDE — it was set up manually for this project's own dev
  database and is documented as an operator responsibility, not a code path).
- TLS certificate acquisition/renewal for a real public CA cert.
- A reverse proxy in front of the server — only needed if you want TLS termination
  outside the app itself, or need to host the console on a different origin/domain than
  the API (the console's own `fetch` calls are same-origin `/api/...` by design, see
  `packages/console/src/api/client.ts`).
