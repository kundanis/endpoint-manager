#!/usr/bin/env bash
# Endpoint One - install or upgrade from a release bundle (no source code, no build).
#
#   tar -xzf endpoint-one-<version>.tar.gz
#   cd endpoint-one-<version>
#   sudo bash deploy.sh
#
# First run  : installs Docker if missing, installs to /opt/endpoint-one, generates secrets in
#              /opt/endpoint-one/.env (prints the first admin login once), loads the image and
#              starts the server + SQL Server.
# Upgrade    : run the same command from a newer bundle. Keeps .env and all data, backs the
#              database up first, loads the new image, restarts, migrates automatically.
# Rollback   : cd /opt/endpoint-one && sudo bash deploy.sh --rollback
#
# Env overrides: INSTALL_DIR (default /opt/endpoint-one), ADMIN_EMAIL (first install only),
#                APP_PORT (default 4000).
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/endpoint-one}"
MODE="install"
[ "${1:-}" = "--rollback" ] && MODE="rollback"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root: sudo bash deploy.sh"

# --- Helpers ----------------------------------------------------------------------------------
env_get() { [ -f "$INSTALL_DIR/.env" ] && grep -E "^$1=" "$INSTALL_DIR/.env" | tail -1 | cut -d= -f2- || true; }
env_set() {
  if grep -qE "^$1=" "$INSTALL_DIR/.env"; then
    sed -i "s|^$1=.*|$1=$2|" "$INSTALL_DIR/.env"
  else
    printf '%s=%s\n' "$1" "$2" >> "$INSTALL_DIR/.env"
  fi
}
compose() { (cd "$INSTALL_DIR" && docker compose "$@"); }

wait_healthy() {
  log "Waiting for the server to become healthy (first start creates and migrates the database)"
  local status="starting"
  for _ in $(seq 1 72); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q server)" 2>/dev/null || echo starting)"
    [ "$status" = "healthy" ] && return 0
    if [ "$status" = "unhealthy" ]; then break; fi
    sleep 5
  done
  compose logs --tail 100 server || true
  die "Server did not become healthy (status: $status). Logs above. To go back: cd $INSTALL_DIR && sudo bash deploy.sh --rollback"
}

print_url() {
  local token ip port
  port="$(env_get APP_PORT)"; port="${port:-4000}"
  # EC2 public IP via IMDSv2 when available; otherwise the first local address.
  token="$(curl -fs -m 2 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)"
  ip="$(curl -fs -m 2 -H "X-aws-ec2-metadata-token: ${token}" http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
  [ -n "$ip" ] || ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "  Console:  http://${ip}:${port}"
  echo "  Version:  $(env_get APP_VERSION)"
  echo "  Manage:   cd $INSTALL_DIR && docker compose ps | logs -f server | restart"
}

# --- Rollback ---------------------------------------------------------------------------------
if [ "$MODE" = "rollback" ]; then
  [ -f "$INSTALL_DIR/.env" ] || die "No installation found in $INSTALL_DIR."
  prev="$(env_get PREVIOUS_APP_VERSION)"
  [ -n "$prev" ] || die "No previous version recorded - nothing to roll back to."
  docker image inspect "endpoint-one-server:$prev" >/dev/null 2>&1 \
    || die "Image endpoint-one-server:$prev is no longer loaded. Load it from its bundle first."
  cur="$(env_get APP_VERSION)"
  log "Rolling back $cur -> $prev"
  echo "NOTE: if $cur already migrated the database, restore the pre-upgrade backup taken by"
  echo "      deploy.sh (in $INSTALL_DIR/backups) - see INSTALL.md 'Rollback'."
  env_set APP_VERSION "$prev"
  env_set PREVIOUS_APP_VERSION "$cur"
  compose up -d
  wait_healthy
  log "Rolled back to $prev"
  print_url
  exit 0
fi

# --- Bundle checks ----------------------------------------------------------------------------
RELEASE_VERSION="$(tr -d '[:space:]' < "$BUNDLE_DIR/VERSION" 2>/dev/null || true)"
[ -n "$RELEASE_VERSION" ] || die "VERSION file missing - run deploy.sh from inside the extracted release bundle."
SERVER_IMAGE_TAR="$BUNDLE_DIR/images/endpoint-one-server-$RELEASE_VERSION.tar"
[ -f "$SERVER_IMAGE_TAR" ] || die "Missing $SERVER_IMAGE_TAR"

arch="$(uname -m)"
[ "$arch" = "x86_64" ] || die "An x86_64 server is required (SQL Server has no ARM image); this host is $arch."
mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
[ "$mem_kb" -ge 3800000 ] || warn "Less than 4 GB RAM - SQL Server needs about 2 GB. 8 GB is recommended."

if command -v sha256sum >/dev/null 2>&1 && [ -f "$BUNDLE_DIR/SHA256SUMS" ]; then
  log "Verifying bundle checksums"
  (cd "$BUNDLE_DIR" && sha256sum -c --quiet SHA256SUMS) || die "Checksum mismatch - the bundle is corrupt or was modified."
fi

# --- Docker -----------------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker (needs internet access)"
  # Read the distro id in a subshell: sourcing /etc/os-release here would overwrite this
  # script's variables (it defines VERSION, e.g. "2023" on Amazon Linux 2023).
  os_id="$( (. /etc/os-release 2>/dev/null && echo "${ID:-}") || true)"
  case "$os_id" in
    amzn)
      dnf install -y docker
      mkdir -p /usr/local/lib/docker/cli-plugins
      curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
      chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
      ;;
    ubuntu|debian|centos|rhel|rocky|almalinux|fedora)
      curl -fsSL https://get.docker.com | sh
      ;;
    *)
      die "Unsupported OS '${os_id:-unknown}'. Install Docker Engine + the compose plugin, then re-run."
      ;;
  esac
  systemctl enable --now docker
fi
docker compose version >/dev/null 2>&1 || die "The docker compose plugin is missing."
systemctl is-active --quiet docker 2>/dev/null || systemctl start docker 2>/dev/null || true

# --- Install files ----------------------------------------------------------------------------
FIRST_INSTALL=0
[ -f "$INSTALL_DIR/.env" ] || FIRST_INSTALL=1
mkdir -p "$INSTALL_DIR/agent-installer" "$INSTALL_DIR/backups"

PREVIOUS="$(env_get APP_VERSION)"
if [ "$FIRST_INSTALL" -eq 0 ] && [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE_VERSION" ]; then
  log "Upgrading $PREVIOUS -> $RELEASE_VERSION"
  db_name="$(env_get DB_NAME)"; db_name="${db_name:-EndpointManagerDb}"
  sqlcmd_q() {  # run a query in the db container (tools18 first, then the older path)
    compose exec -T db sh -c "/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P \"\$MSSQL_SA_PASSWORD\" -No -h -1 -W -b -Q \"$1\" 2>/dev/null || /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P \"\$MSSQL_SA_PASSWORD\" -h -1 -W -b -Q \"$1\""
  }
  db_exists=0
  if [ -n "$(compose ps -q db 2>/dev/null)" ]      && sqlcmd_q "SET NOCOUNT ON; SELECT CASE WHEN DB_ID('$db_name') IS NULL THEN 0 ELSE 1 END" 2>/dev/null | grep -q '^1'; then
    db_exists=1
  fi
  if [ "$db_exists" -eq 0 ]; then
    echo "No existing database [$db_name] yet (previous start never completed) - nothing to back up."
  fi
  if [ "$db_exists" -eq 1 ]; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    bak="pre-upgrade-${PREVIOUS}-${stamp}.bak"
    echo "Backing up database [$db_name] before upgrading..."
    if compose exec -T db sh -c "mkdir -p /var/opt/mssql/backup && (/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P \"\$MSSQL_SA_PASSWORD\" -No -b -Q \"BACKUP DATABASE [$db_name] TO DISK='/var/opt/mssql/backup/$bak' WITH INIT\" || /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P \"\$MSSQL_SA_PASSWORD\" -b -Q \"BACKUP DATABASE [$db_name] TO DISK='/var/opt/mssql/backup/$bak' WITH INIT\")" >/dev/null \
       && compose cp "db:/var/opt/mssql/backup/$bak" "$INSTALL_DIR/backups/$bak"; then
      echo "Backup saved: $INSTALL_DIR/backups/$bak"
    else
      die "Pre-upgrade database backup failed - upgrade aborted, nothing was changed."
    fi
  fi
fi

log "Installing files to $INSTALL_DIR"
install -m 0644 "$BUNDLE_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
install -m 0644 "$BUNDLE_DIR/INSTALL.md" "$INSTALL_DIR/INSTALL.md"
install -m 0644 "$BUNDLE_DIR/VERSION" "$INSTALL_DIR/VERSION"
install -m 0755 "$BUNDLE_DIR/deploy.sh" "$INSTALL_DIR/deploy.sh"
if ls "$BUNDLE_DIR"/agent-installer/* >/dev/null 2>&1; then
  cp -f "$BUNDLE_DIR"/agent-installer/* "$INSTALL_DIR/agent-installer/"
  echo "Agent installers updated."
fi

if [ "$FIRST_INSTALL" -eq 1 ]; then
  log "Generating secrets in $INSTALL_DIR/.env"
  rand() { openssl rand -base64 "$1" | tr -d '\n'; }
  sa_password="Sa1!$(openssl rand -hex 12)"
  admin_password="Adm1!$(openssl rand -hex 8)"
  admin_email="${ADMIN_EMAIL:-admin@endpointone.local}"
  # The admin console only answers private networks plus ADMIN_ALLOWED_NETWORKS. Default to
  # the public IP this SSH session comes from, so the installing admin can open it right away.
  allowed="${ADMIN_ALLOWED_NETWORKS:-}"
  if [ -z "$allowed" ]; then
    ssh_ip="$(who -m 2>/dev/null | sed -n 's/.*(\([0-9a-fA-F.:]*\)).*/\1/p' | head -1)"
    case "$ssh_ip" in
      ''|10.*|192.168.*|127.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) ;;
      *) allowed="$ssh_ip" ;;
    esac
  fi
  (
    umask 077
    cat > "$INSTALL_DIR/.env" <<EOF
# Endpoint One - generated by deploy.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keep private and BACKED UP.
SA_PASSWORD=${sa_password}
JWT_SECRET=$(rand 48)
# Losing FIELD_ENCRYPTION_KEY makes encrypted fields in the database permanently unreadable.
FIELD_ENCRYPTION_KEY=$(rand 32)
ADMIN_EMAIL=${admin_email}
ADMIN_PASSWORD=${admin_password}
DB_NAME=EndpointManagerDb
APP_PORT=${APP_PORT:-4000}
LICENSE_ENFORCEMENT_ENABLED=false
# Public IPs/CIDRs allowed to open the admin console (comma-separated). Private networks always are.
ADMIN_ALLOWED_NETWORKS=${allowed}
APP_VERSION=${RELEASE_VERSION}
EOF
  )
fi
chmod 600 "$INSTALL_DIR/.env"
if [ "$FIRST_INSTALL" -eq 0 ] && [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE_VERSION" ]; then
  env_set PREVIOUS_APP_VERSION "$PREVIOUS"
fi
env_set APP_VERSION "$RELEASE_VERSION"

# --- Images -----------------------------------------------------------------------------------
log "Loading the Endpoint One image ($RELEASE_VERSION)"
docker load -i "$SERVER_IMAGE_TAR"
if [ -f "$BUNDLE_DIR/images/mssql-server.tar" ]; then
  log "Loading the bundled SQL Server image (offline bundle)"
  docker load -i "$BUNDLE_DIR/images/mssql-server.tar"
fi

# --- Start ------------------------------------------------------------------------------------
log "Starting Endpoint One"
compose up -d
wait_healthy

log "Endpoint One $RELEASE_VERSION is running"
print_url
if [ "$FIRST_INSTALL" -eq 1 ]; then
  echo
  echo "  First administrator (also in $INSTALL_DIR/.env - change the password after signing in):"
  echo "    email:    $(env_get ADMIN_EMAIL)"
  echo "    password: $(env_get ADMIN_PASSWORD)"
  echo
  echo "  BACK UP $INSTALL_DIR/.env now (FIELD_ENCRYPTION_KEY cannot be recovered)."
  allowed_now="$(env_get ADMIN_ALLOWED_NETWORKS)"
  echo
  if [ -n "$allowed_now" ]; then
    echo "  Admin console reachable from: private networks + ${allowed_now}"
  else
    echo "  Admin console reachable from private networks only. To allow your office's public IP:"
    echo "    set ADMIN_ALLOWED_NETWORKS=<ip> in $INSTALL_DIR/.env, then: cd $INSTALL_DIR && sudo docker compose up -d"
  fi
fi
if ! ls "$INSTALL_DIR"/agent-installer/EndpointProAgentSetup.exe >/dev/null 2>&1; then
  warn "No agent installer in $INSTALL_DIR/agent-installer - 'Download agent installer' will report it missing."
fi
