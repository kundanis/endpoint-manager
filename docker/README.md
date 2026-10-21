# Endpoint IQ — Docker deployment

One-command deployment of the **server + web console + SQL Server** as Linux containers. The
application is compiled to **V8 bytecode** with a startup integrity check (no readable JS in
the image). Built entirely from the repo — no Windows staging step.

## Customer deployments (no source code on the server)

For customer servers, ship a **release bundle** instead of the repo:

```powershell
# on your build machine (Windows, Docker Desktop):
powershell -ExecutionPolicy Bypass -File docker
elease.ps1 -Version 1.0.0          # online customers
powershell -ExecutionPolicy Bypass -File docker
elease.ps1 -Version 1.0.0 -Offline # + SQL Server image
```

The output is `release/endpoint-one-<version>.tar.gz`: the prebuilt image (V8 bytecode), the customer
`docker-compose.yml`, `deploy.sh` (install/upgrade/rollback, never builds) and `INSTALL.md`. It
contains no source code. On the customer server: extract it and run `sudo bash deploy.sh`; it
installs to `/opt/endpoint-one`. The full customer guide is `docker/customer/INSTALL.md`, which ships
inside the bundle.

## Deploy on AWS EC2 (recommended path)

**1. Launch an instance**
- **x86_64 only** (SQL Server has no ARM image): `t3.large` (2 vCPU, 8 GB) recommended;
  `t3.medium` (4 GB) is the minimum. Not Graviton (`t4g`, `m7g`).
- Amazon Linux 2023 or Ubuntu 22.04/24.04, 30 GB gp3 disk.
- **Security group inbound:** TCP **4000** (console + agents) from your office/agent networks,
  TCP 22 (SSH) from your IP only. Do **not** open 1433 (SQL Server stays internal).
- Give it an **Elastic IP** so the address agents use never changes.

**2. Deploy**
```bash
sudo dnf install -y git    # Amazon Linux (Ubuntu: sudo apt-get install -y git)
git clone https://github.com/kundanis/endpoint-one.git
cd endpoint-one/docker
./deploy-ec2.sh
```
The script installs Docker, writes `docker/.env` with generated secrets (it prints the first
admin login once — save it), builds the image, starts the server + SQL Server and waits until
healthy. It's safe to re-run; it never overwrites an existing `.env` or database.

**3. First sign-in**
Open `http://<elastic-ip>:4000`, sign in, then **Endpoint Hub → Enrollment tokens → Server
connection details** and set the address agents use, e.g. `http://<elastic-ip>:4000` (and a
DNS name if you have one). Do this **before** downloading installers — they embed it.

**4. Agent installers**
Build on a Windows machine (`npm run package -w @em/agent`) and copy
`EndpointProAgentSetup.exe`, `EndpointProAgentInstaller.zip` and `agent-manifest.json` into
`docker/agent-installer/` on the instance (e.g. with `scp`). Picked up immediately, no restart.

**Small instance? Ship a prebuilt image instead of building on EC2**
```bash
# on a machine with Docker (x86_64):
docker build -f docker/Dockerfile -t endpoint-one-server:latest .
docker save endpoint-one-server:latest | gzip > endpoint-one-server.tar.gz
scp endpoint-one-server.tar.gz ec2-user@<elastic-ip>:~
# on the instance:
docker load -i ~/endpoint-one-server.tar.gz
cd endpoint-one/docker && ./deploy-ec2.sh --no-build
```

**Updating**
```bash
cd endpoint-one && git pull
cd docker && docker compose up -d --build     # or load a new image and: docker compose up -d
```
Migrations run automatically on start; data in the volumes is kept.

**Backups** — everything stateful is in Docker volumes plus `docker/.env`:
- `docker/.env` — keep a copy somewhere safe; `FIELD_ENCRYPTION_KEY` is required to read
  encrypted fields, and losing it makes them unrecoverable.
- Database: `docker compose exec db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SA_PASSWORD" -No -Q "BACKUP DATABASE [EndpointManagerDb] TO DISK='/var/opt/mssql/backup.bak'"`,
  then copy it out with `docker compose cp db:/var/opt/mssql/backup.bak .` (or snapshot the EBS volume).

**HTTPS** — put an AWS Application Load Balancer (ACM certificate) in front, forwarding to port
4000, and set the agents' address to the `https://` DNS name. See *TLS* below for the
in-container alternative.

## Quick start (any Linux host with Docker)

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
npm run package -w @em/agent          # on Windows: produces EndpointProAgentSetup.exe + installer zip + manifest
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
