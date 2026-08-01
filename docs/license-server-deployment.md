# Deploying the License Server (Machine B)

This is the vendor's own central server — installed **once**, ever, not per customer.
Every customer's Endpoint Manager deployment (Machine A) activates against this same
instance. It packages exactly `packages/license-server` + `packages/license-console`
(+ `packages/license-shared`) — never `packages/server`/`console`/`agent`.

## 1. Prerequisites

- A Windows Server (or Windows 10/11) machine, with:
  - Node.js is **not** required — the deployment package embeds a portable `node.exe`.
  - SQL Server installed and reachable.
- Inbound reachability from every Machine A that will activate against it.

## 2. Build the deployment package (once per release, on the dev/build machine)

```powershell
cd packages\license-server
npm run package    # runs scripts\package-license-server.ps1
```

Produces `packages\license-server\dist-installer\LicenseServerInstaller.zip`. Copy this
to Machine B.

## 3. First-run setup on Machine B

Unzip wherever you want it to live, then run **`Setup.bat`** (elevates via UAC
automatically) or, from an admin PowerShell prompt:

```powershell
.\setup.ps1 -SqlServerInstance "<this-machine's-actual-hostname>" -LicenseAdminEmail "vendor@yourcompany.example"
```

Any parameter left off is prompted for interactively (the admin password prompts as a
masked `SecureString`). What it does:

1. Provisions a dedicated SQL Server login + `LicenseServerDb` (+ a `_shadow` database
   Prisma's schema requires) — least-privilege, scoped to `db_owner` on that one database
   only, never `sa`. Pass `-SkipDbProvision -DatabaseUrl "..." -ShadowDatabaseUrl "..."`
   instead if the database already exists. Connection strings default to
   `trustServerCertificate=true` — a brand-new SQL Server install only has its own
   auto-generated self-signed certificate, which nothing trusts by default, so strict
   validation (`false`) fails with *"certificate chain... terminated in a root
   certificate which is not trusted."* Pass `-TrustServerCertificate:$false` once a real
   certificate is installed and you want strict validation — see `docs/tls-setup.md`.
2. Generates `JWT_SECRET`, writes `app\.env`.
3. Generates the Prisma Client and applies all migrations (`prisma generate` then
   `migrate deploy`), then seeds the first `LicenseAdmin`.
4. Registers a `LicenseServer` Scheduled Task (boot trigger, `SYSTEM` principal,
   auto-restart on failure — same pattern as the agent's own installer) and starts it.

On success it prints the console URL and, if you didn't pass `-LicenseAdminPassword`, a
generated one — shown exactly once. Save it now.

## 4. Onboard a new customer entity

Log in to the console (`http://<machine-b>:4200/` by default). Go to **Entities**,
create one for the customer. Go to **License Keys**, issue one (agent cap, validity —
1/2/3 years or perpetual — and which modules the customer has purchased; see
`docs/license-setup.md`'s "Per-module licensing" section). The full key is shown exactly
once — copy it now. Give the customer:

- This server's URL (or its public hostname if you're terminating TLS in front of it).
- The license key.

They enter both in their own Endpoint Manager console (Licensing → Licence API to
connect, then Activate). See `docs/license-setup.md` for the full activation mechanics
and `docs/two-machine-deployment.md` for the two-machine map.

## 5. TLS

The server runs plain HTTP by default. For production, terminate TLS at a reverse proxy
(nginx/IIS/Caddy) in front of it, or set `TLS_PFX_PATH`/`TLS_PFX_PASSPHRASE` in `.env` —
see `docs/tls-setup.md`.

## Troubleshooting

**`P1011: Error opening a TLS connection... certificate chain... terminated in a root
certificate which is not trusted`** — same fix as Machine A: edit `app\.env`, change
`trustServerCertificate=false` to `true` on both `DATABASE_URL` and `SHADOW_DATABASE_URL`,
then finish setup manually:
```powershell
cd app
..\node\node.exe node_modules\prisma\build\index.js generate --schema prisma\schema.prisma
..\node\node.exe node_modules\prisma\build\index.js migrate deploy --schema prisma\schema.prisma
..\node\node.exe node_modules\tsx\dist\cli.mjs prisma\seed.ts
```

## What this package deliberately does not automate

Same as Machine A's package: SQL Server installation/TDE, and real CA certificate
acquisition — both administrative decisions, not scripted here.
