# Endpoint IQ — server installation guide

This bundle installs the Endpoint IQ server (web console, agent API, Outlook add-in) and its
SQL Server database as Docker containers. It contains a prebuilt image only; nothing is
compiled on the server.

## 1. Server requirements

| | Minimum | Recommended |
|---|---|---|
| CPU architecture | **x86_64** (SQL Server has no ARM build) | — |
| vCPU / RAM | 2 vCPU / 4 GB | 2–4 vCPU / 8 GB |
| Disk | 30 GB | 50 GB+ (database, backups, uploads) |
| OS | Ubuntu 22.04/24.04, Amazon Linux 2023, RHEL/Rocky/Alma 9, Debian 12 | Ubuntu 24.04 LTS |
| Access | root / sudo, internet (to install Docker and pull SQL Server) | Static IP or DNS name |

On AWS: an x86 instance such as `t3.large` or `m6i.large` (not Graviton `t4g`/`m7g`), with an
Elastic IP.

**Firewall / security group, inbound:**
- TCP **4000**: web console and agents, from admin and endpoint networks
- TCP **22**: SSH, from the administrators' IP only
- Do **not** expose 1433 (SQL Server is internal to Docker)

## 2. Install

Copy the bundle to the server (for example `scp endpoint-one-<version>.tar.gz user@server:~`), then:

```bash
tar -xzf endpoint-one-<version>.tar.gz
cd endpoint-one-<version>
sudo bash deploy.sh
```

The script:
1. checks the bundle's checksums;
2. installs Docker if it's missing;
3. installs everything to `/opt/endpoint-one` and generates secrets in `/opt/endpoint-one/.env`;
4. loads the image and starts the server and SQL Server;
5. waits until the server is healthy (the first start creates the database, which takes 1–3 minutes);
6. prints the console URL and the **first administrator login**.

To choose the admin email: `sudo ADMIN_EMAIL=it@customer.com bash deploy.sh` (first install only).

**Right after installing:**
- Save the printed admin password, sign in, and change it.
- **Back up `/opt/endpoint-one/.env`** somewhere safe (a password manager or vault). It holds the
  database password and `FIELD_ENCRYPTION_KEY`. If you lose that key, the encrypted data in the
  database can never be read again.

## 3. First-time configuration (web console)

**Who can open the console:** for security, the admin console only answers **private networks**
(10.x, 172.16–31.x, 192.168.x) plus the public IPs listed in `ADMIN_ALLOWED_NETWORKS`. Anyone
else gets `{"error":"Not found"}`. Agents and the Outlook add-in work from anywhere.
- A fresh install automatically allows the public IP you ran `deploy.sh` from (your SSH session),
  and prints it at the end.
- To allow other offices or admins: edit `/opt/endpoint-one/.env`, e.g.
  `ADMIN_ALLOWED_NETWORKS=203.0.113.7,198.51.100.0/24`, then run
  `cd /opt/endpoint-one && sudo docker compose up -d`.
- Quick access without changing anything: an SSH tunnel,
  `ssh -L 4000:localhost:4000 user@<server-ip>`, then browse to `http://localhost:4000`.

Open `http://<server-ip>:4000` and sign in.

1. **Licensing → Licence API**: enter the License Server URL, select **Connect**, enter the
   licence key and select **Activate**.
2. **Endpoint Hub → Enrollment tokens → Server connection details**: set the address agents use
   to reach this server, for example `http://<server-ip>:4000` (LAN) and/or a public URL or DNS
   name. Do this **before** downloading any installer, because installers carry these
   addresses.
3. **Administrators**: add the other administrators and their module access.
4. Optional: once the licence is active, set `LICENSE_ENFORCEMENT_ENABLED=true` in
   `/opt/endpoint-one/.env`, then run `cd /opt/endpoint-one && sudo docker compose up -d`.

## 4. Roll out agents

1. **Endpoint Hub → Enrollment tokens → Create token** (optionally choose a target group).
2. Select **Download setup for this token** to get a ready-to-run installer.
3. Run it as administrator on each Windows endpoint (or deploy it with GPO, Intune or SCCM).
4. Endpoints appear under **Endpoint Hub → Endpoints** within a minute.

**Mac and Linux:** on the same page, **Install on Mac or Linux** downloads the tarball and shows
the exact Terminal command (server addresses and, right after creating a token, the token are
filled in). Copy the tarball to the machine and run that command; it needs `sudo`. The macOS
agent needs macOS 12 or later and bundles its own Node.js. Uninstall with
`sudo /Library/EndpointProAgent/uninstall.sh`.

Remote "Install on endpoint" from the console and the server-side network scan need a Windows
server, so they aren't available in this Linux deployment. Use the setup file; the
agent-driven VLAN scan (Network Insight) works normally.

## 5. Upgrade to a new version

Copy the new bundle to the server and run its `deploy.sh`, exactly as for an install:

```bash
tar -xzf endpoint-one-<new-version>.tar.gz
cd endpoint-one-<new-version>
sudo bash deploy.sh
```

The script keeps `.env` and all data, **backs up the database first** (to
`/opt/endpoint-one/backups/`), loads the new image and restarts. Database migrations run
automatically. Agents update themselves from the new installer files (if the bundle includes
a newer agent) via **Endpoint Hub → Agent updates**.

On a large database or a slow disk the backup takes a while. Two options change it:

| Command | Backup | When to use it |
| --- | --- | --- |
| `sudo bash deploy.sh` | Taken and copied to `/opt/endpoint-one/backups/` | Default; safest |
| `sudo bash deploy.sh --backup-in-place` | Taken, but left inside the database volume (`/var/opt/mssql/backup/` in the `db` container) | Roughly half the time; copy it off later if you want to keep it |
| `sudo bash deploy.sh --skip-backup` | None. You must type `SKIP` to confirm (`CONFIRM_SKIP_BACKUP=yes` when not interactive) | Only when you already have a recent backup; rollback cannot restore data |

## 6. Rollback

```bash
cd /opt/endpoint-one && sudo bash deploy.sh --rollback
```

This switches back to the previous version's image. If the newer version already changed the
database (migrations), also restore the pre-upgrade backup. (With `--backup-in-place` the file is
already inside the container: skip the `docker compose cp` line and use its name in the restore.)

```bash
cd /opt/endpoint-one
sudo docker compose stop server
sudo docker compose cp backups/<pre-upgrade-file>.bak db:/var/opt/mssql/backup/restore.bak
sudo docker compose exec db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$(grep ^SA_PASSWORD= .env | cut -d= -f2-)" -No \
  -Q "ALTER DATABASE [EndpointManagerDb] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; RESTORE DATABASE [EndpointManagerDb] FROM DISK='/var/opt/mssql/backup/restore.bak' WITH REPLACE; ALTER DATABASE [EndpointManagerDb] SET MULTI_USER;"
sudo docker compose start server
```

## 7. Day-to-day operations

All commands run from `/opt/endpoint-one` with `sudo`:

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Server logs | `docker compose logs -f server` |
| Restart | `docker compose restart server` |
| Stop / start | `docker compose stop` / `docker compose start` |
| Manual DB backup | `docker compose exec db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$(grep ^SA_PASSWORD= .env \| cut -d= -f2-)" -No -Q "BACKUP DATABASE [EndpointManagerDb] TO DISK='/var/opt/mssql/backup/manual.bak' WITH INIT"` then `docker compose cp db:/var/opt/mssql/backup/manual.bak backups/` |

**Advanced application control (optional extra).** Off unless your supplier switched it on.
It adds DLL blocking, PowerShell and batch script blocking (also from an open Command Prompt
and scheduled tasks) and Allow exceptions, using Windows AppLocker. To switch it on: set
`ADVANCED_APP_CONTROL=true` in `.env` and run `sudo docker compose up -d`, or install/upgrade
with `sudo ADVANCED_APP_CONTROL=true ./deploy.sh`. Set it back to `false` to switch it off;
agents then remove every AppLocker rule they added.

Never run `docker compose down -v`: `-v` deletes the database and uploads.

**Backups:** schedule the manual backup above (cron), copy `backups/` and `.env` off the server,
or take regular disk snapshots (on AWS: EBS snapshots via Data Lifecycle Manager).

## 8. HTTPS with your own certificate (recommended)

You need the certificate and its private key as PEM files (text files starting with
`-----BEGIN CERTIFICATE-----` and `-----BEGIN PRIVATE KEY-----`), plus the CA's intermediate
chain file if your provider gave you one.

1. **DNS:** point the certificate's name (e.g. `endpoint.yourcompany.com`) at the server's IP.
2. **Firewall / security group:** allow inbound TCP **443**.
3. **Copy the files to the server:**
   `scp cert.pem key.pem chain.pem user@<server-ip>:~`
4. **Install:**
   ```bash
   cd /opt/endpoint-one
   sudo bash deploy.sh --install-cert ~/cert.pem ~/key.pem ~/chain.pem   # chain is optional
   ```
   The script checks that the certificate is valid, matches the key and hasn't expired, converts
   it to the format the server uses, restarts the server and confirms that HTTPS answers. It
   prints the certificate's names and expiry date.
5. **Open** `https://endpoint.yourcompany.com` and sign in.
6. **Agents:** in **Endpoint Hub → Enrollment tokens → Server connection details**, add
   `https://endpoint.yourcompany.com` as the Web URL. New installers will use it, and existing
   agents pick up the list on their next check-in. Plain HTTP on port 4000 keeps working, so
   endpoints already installed continue reporting with no change.

**Renewal:** run the same `--install-cert` command with the renewed files. The old certificate
stays in place until the new one has been validated and converted.

**Notes:**
- HTTPS also applies `ADMIN_ALLOWED_NETWORKS`: the console still only answers allowed networks.
- Login cookies are marked `Secure` automatically on HTTPS.
- To use a port other than 443, set `HTTPS_PORT=8443` in `.env`, then run `sudo docker compose up -d`.
- If the key has a passphrase, remove it first with `openssl pkey -in key.pem -out key-nopass.pem`.
- If the certificate is DER/.cer, convert it first with
  `openssl x509 -inform der -in cert.cer -out cert.pem`.
- To use a load balancer instead (an AWS ALB with ACM), forward to port 4000 and don't install a
  certificate on the server.

### Behind Cloudflare (orange-cloud proxy)

Simplest is **DNS only** (grey cloud): browsers and agents reach the server directly and use the
certificate installed above. If you keep the Cloudflare proxy on:

1. **DNS:** exactly one record for the name, an **A** record with the server's IP. Remove any
   other A or AAAA record for it: Cloudflare tries every origin listed, and an unreachable one
   makes every page wait about 20 seconds before it loads (or fail with error 522).
2. **SSL/TLS mode:** **Full (strict)**. Cloudflare then talks to the server over HTTPS and checks
   the certificate installed with `--install-cert`.
3. **Tell the server about the proxy.** Without this, every visitor looks like a Cloudflare
   address, so `ADMIN_ALLOWED_NETWORKS` can't tell admins from anyone else:
   ```bash
   cd /opt/endpoint-one
   sudo sed -i '/^TRUSTED_PROXY=/d' .env && echo 'TRUSTED_PROXY=cloudflare' | sudo tee -a .env
   sudo docker compose up -d
   ```
   The server then uses the visitor address Cloudflare reports, but only for requests that really
   come from Cloudflare's address ranges. A request sent straight to the server's IP can't fake it.
4. **`ADMIN_ALLOWED_NETWORKS`** must list your admins' real public IPs again (never Cloudflare's
   ranges or `0.0.0.0/0`).

Agents can keep using `http://<server-ip>:4000`; they don't need to go through Cloudflare.

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| `deploy.sh` says unhealthy | `docker compose logs --tail 200 server`. The usual causes are too little RAM for SQL Server, or the disk is full. |
| Console not reachable | Security group / firewall allows TCP 4000; `docker compose ps` shows `server` as healthy. |
| Browser shows `{"error":"Not found"}` | Your public IP isn't in `ADMIN_ALLOWED_NETWORKS` (see section 3). The server log shows "Blocked request from a public address" with your IP. |
| "Installer not available" in the console | The bundle had no agent installer: copy `EndpointProAgentSetup.exe`, `EndpointProAgentInstaller.zip` and `agent-manifest.json` into `/opt/endpoint-one/agent-installer/` (no restart needed). The macOS agent goes in `agent-installer/macos/` (`EndpointProAgentMac.tar.gz`, `agent-manifest.json`), the Linux one in `agent-installer/linux/`. |
| Endpoint installed but not listed | On the endpoint: `Test-NetConnection <server-ip> -Port 4000`; check that Server connection details holds an address the endpoint can reach. |
| Database exceeds 10 GB | SQL Server Express limit: set `MSSQL_PID=Standard` in `.env` (requires a licence), then run `docker compose up -d`. |
