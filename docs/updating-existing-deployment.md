# Updating an existing customer install

This is for a customer who **already has Endpoint Manager running** and needs the
latest server/console/agent-installer code and any new database migrations — without
re-provisioning the database, re-seeding the admin account, or touching their existing
`.env` (secrets, DB connection, license activation) or `app\uploads`.

If this is instead a **brand-new** customer with nothing installed yet, use
`docs/fresh-deployment.md` — do not use this package for that, it deliberately has no
database-provisioning or admin-seeding step at all.

## 1. Build the update package (on the dev/build machine, once per release)

```powershell
cd packages\server
npm run package:update    # runs scripts\package-server-update.ps1
```

Produces `packages\server\dist-installer\EndpointManagerServerUpdate.zip` — new compiled
server, compiled console, the current set of Prisma migrations, resolved runtime
dependencies, the latest agent installer exe, a portable `node.exe`, and `update.ps1`/
`Update.bat`. Copy this zip to the customer's machine.

(`npm run package` — no `:update` — still builds the full fresh-install package,
`EndpointManagerServerInstaller.zip`, unchanged. Both share the exact same build step, so
running one right after the other does not rebuild from scratch twice for no reason —
but each also works standalone if you only need one of them.)

## 2. Run the update at the customer site

Unzip it anywhere (it does **not** need to sit next to the existing install — it can be
extracted to a temp folder like `C:\EndpointManagerUpdate`). Then run **`Update.bat`**
(elevates via UAC, then prompts for the existing install's path) or, from an admin
PowerShell prompt:

```powershell
.\update.ps1 -TargetDir "C:\EndpointManagerServer"
```

`-TargetDir` is the existing install's root — the folder that already contains `app\`,
`node\`, and `Start-Server.bat` from when it was first set up.

What it does, in order:

1. **Stops the service safely.** Disables the `EndpointManagerServer` Scheduled Task
   *before* stopping it — disabling first is required, because stopping it alone
   (`schtasks /end`) does not stop `RestartOnFailure` from immediately respawning the
   *old* process mid-update (a real gotcha already hit once on a live customer machine).
   If no Scheduled Task is found (e.g. this site has been running via manual
   `Start-Server.bat` double-clicks), it asks you to confirm the process is stopped
   before continuing.
2. **Backs up the current app code** by moving (not deleting) `app\dist`,
   `app\console-dist`, `app\prisma`, and `app\node_modules` into a timestamped folder
   under `app\..\_update-backups\<timestamp>\`. Nothing is lost — rollback is just moving
   these back.
3. **Copies in the new code** — `dist\`, `console-dist\`, `prisma\` (including any new
   migrations), `node_modules\`, the updated agent installer exe, and a fresh portable
   `node.exe`. **`app\.env` and `app\uploads` are never touched** — existing secrets, DB
   connection string, license activation, and uploaded deployment packages all survive
   exactly as they were.
4. **Applies any new database migrations** (`prisma migrate deploy` against the
   *existing* database) — additive only, this never resets, drops, or re-seeds anything.
   If this step fails, the script stops immediately, tells you exactly where the backup
   from step 2 is, and does **not** restart the service with a half-updated/mismatched
   state.
5. **Restarts the service** (re-enables + runs the Scheduled Task) and checks `/health`
   — reads `PORT`/`TLS_PFX_PATH` from the existing `.env` so this works whether the site
   runs plain HTTP or HTTPS with a self-signed cert.

On success it prints where the pre-update backup lives — safe to delete once you've
confirmed everything works, but worth keeping until then.

## 3. If something goes wrong

The script never deletes anything — a failed `prisma migrate deploy` step leaves the
*old* `dist`/`console-dist`/`prisma`/`node_modules` sitting untouched in the timestamped
backup folder it printed. To roll back manually:

```powershell
# from the existing install's root, e.g. C:\EndpointManagerServer
Remove-Item app\dist, app\console-dist, app\prisma, app\node_modules -Recurse -Force
Move-Item _update-backups\<timestamp>\dist app\dist
Move-Item _update-backups\<timestamp>\console-dist app\console-dist
Move-Item _update-backups\<timestamp>\prisma app\prisma
Move-Item _update-backups\<timestamp>\node_modules app\node_modules
schtasks /change /tn EndpointManagerServer /enable
schtasks /run /tn EndpointManagerServer
```

The database itself is never rolled back automatically by this package (an applied
migration generally isn't safe to blindly reverse) — if a migration failure needs actual
DB-level recovery, that's a case-by-case call, not something to script generically.

## What this package deliberately does not do

- Provision a database or SQL login — it assumes one already exists and works (that's
  what `EndpointManagerServerInstaller.zip` + `setup.ps1` did the first time).
- Seed or reset the admin account — the existing admin(s) are untouched.
- Touch license activation, `.env`, or `app\uploads` in any way.
- Re-register the Scheduled Task if none exists — it tells you it's missing and how to
  register one (using the fresh-install package's `setup.ps1 -SkipDbProvision`, which
  only registers the task and does not re-provision or re-seed anything), rather than
  silently creating one with guessed settings.
