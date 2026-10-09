# Endpoint Pro — Docker deployment

One-command deployment of the **server + web console + SQL Server** as Linux containers. The
application is compiled to **V8 bytecode** with a startup integrity check (no readable JS in
the image). Built entirely from the repo — no Windows staging step.

## Quick start

```bash
cd docker
cp .env.example .env            # then edit the secrets in .env
docker compose up -d --build
```

Then open **http://<host>:4000** and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. First go to
**Enrollment Tokens → Server connection details** and set the addresses agents should use.

The server auto-creates the database, applies migrations, and seeds the first admin on start
(idempotent — safe to restart). Logs: `docker compose logs -f server`.

## What's in the image
- The compiled server (bytecode + integrity loader)
- The web console (served at `/`)
- The Outlook add-in static files

Mounted via volumes (persist across restarts):
- `uploads` → `/app/uploads`
- `./agent-installer` → `/app/agent-installer` — put built installers here (below)

## Important limitations (Linux image)
- **Remote agent install** and **server-side network scan** shell out to Windows
  PowerShell/WinRM and **do not work** here. Install agents by downloading the setup exe from
  **Console → Enrollment Tokens** and running it on the endpoint (or via your own tooling/GPO).
  Everything else — enrollment, check-in, commands, patching, DLP, vulnerabilities, Zero Trust,
  the agent-driven VLAN scan — works normally.
- **Networking:** a container sees its own interfaces, not the host's. Always set the LAN/WAN
  addresses explicitly in *Server connection details* (don't rely on auto-detect), and be aware
  the quarantine firewall-exception list is derived from those settings.

## TLS
The container serves plain **HTTP on 4000**. For HTTPS, either:
- put a reverse proxy / load balancer in front terminating TLS, or
- mount a PFX and set `TLS_PFX_PATH`, `TLS_PFX_PASSPHRASE`, `TLS_PORT` (add them to the `server`
  service env and publish the port). See `packages/server/.env.example`.

## Agent installers
Not baked into the image (they're platform binaries, gitignored). Build them and drop them in
`docker/agent-installer/`:
```bash
npm run package -w @em/agent          # produces EndpointProAgentSetup.exe + installer zip + manifest
```
Copy the resulting files into `docker/agent-installer/` (and `linux/` for the Linux agent).

## Production / external SQL
To use managed SQL (Azure SQL / RDS) instead of the bundled container: remove the `db` service,
point `DATABASE_URL` at your server, pre-create the database and a least-privilege login, and
leave `MASTER_DATABASE_URL` unset (the entrypoint then skips the CREATE DATABASE step).

## Commands
- `docker compose up -d --build` — build + run
- `docker compose logs -f server` — logs
- `docker compose down` — stop (keeps volumes)
- `docker compose down -v` — stop and delete data (DB + uploads)
- `docker compose run --rm server setup` — run the one-time init explicitly (refuses if already set up)
