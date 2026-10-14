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
VERSION="$(tr -d '[:space:]' < "$BUNDLE_DIR/VERSION" 2>/dev/null || true)"
[ -n "$VERSION" ] || die "VERSION file missing - run deploy.sh from inside the extracted release bundle."
SERVER_IMAGE_TAR="$BUNDLE_DIR/images/endpoint-one-server-$VERSION.tar"
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
  . /etc/os-release 2>/dev/null || true
  case "${ID:-}" in
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
      die "Unsupported OS '${ID:-unknown}'. Install Docker Engine + the compose plugin, then re-run."
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
if [ "$FIRST_INSTALL" -eq 0 ] && [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$VERSION" ]; then
  log "Upgrading $PREVIOUS -> $VERSION"
  if [ -n "$(compose ps -q db 2>/dev/null)" ]; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    bak="pre-upgrade-${PREVIOUS}-${stamp}.bak"
    db_name="$(env_get DB_NAME)"; db_name="${db_name:-EndpointManagerDb}"
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
APP_VERSION=${VERSION}
EOF
  )
fi
chmod 600 "$INSTALL_DIR/.env"
if [ "$FIRST_INSTALL" -eq 0 ] && [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$VERSION" ]; then
  env_set PREVIOUS_APP_VERSION "$PREVIOUS"
fi
env_set APP_VERSION "$VERSION"

# --- Images -----------------------------------------------------------------------------------
log "Loading the Endpoint One image ($VERSION)"
docker load -i "$SERVER_IMAGE_TAR"
if [ -f "$BUNDLE_DIR/images/mssql-server.tar" ]; then
  log "Loading the bundled SQL Server image (offline bundle)"
  docker load -i "$BUNDLE_DIR/images/mssql-server.tar"
fi

# --- Start ------------------------------------------------------------------------------------
log "Starting Endpoint One"
compose up -d
wait_healthy

log "Endpoint One $VERSION is running"
print_url
if [ "$FIRST_INSTALL" -eq 1 ]; then
  echo
  echo "  First administrator (also in $INSTALL_DIR/.env - change the password after signing in):"
  echo "    email:    $(env_get ADMIN_EMAIL)"
  echo "    password: $(env_get ADMIN_PASSWORD)"
  echo
  echo "  BACK UP $INSTALL_DIR/.env now (FIELD_ENCRYPTION_KEY cannot be recovered)."
fi
if ! ls "$INSTALL_DIR"/agent-installer/EndpointProAgentSetup.exe >/dev/null 2>&1; then
  warn "No agent installer in $INSTALL_DIR/agent-installer - 'Download agent installer' will report it missing."
fi
