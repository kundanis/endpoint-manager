#!/usr/bin/env bash
# Endpoint IQ - install or upgrade from a release bundle (no source code, no build).
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
# Upgrade options (install/upgrade only):
#   --backup-in-place  take the pre-upgrade database backup but leave it inside the database
#                      volume instead of copying it to /opt/endpoint-one/backups (about half
#                      the time on a large database or a slow disk)
#   --skip-backup      no pre-upgrade backup at all; asks you to type SKIP to confirm
#                      (non-interactive: CONFIRM_SKIP_BACKUP=yes)
#
# First install asks whether to set your own credentials (yes: you choose the SQL Server sa
# password, the application's SQL login and password, and the super admin email and password;
# no: default login names with strong random passwords, printed at the end). Upgrades never ask.
# Unattended: CUSTOM_CREDENTIALS=yes with SA_PASSWORD, APP_DB_USER, APP_DB_PASSWORD, ADMIN_EMAIL
# and ADMIN_PASSWORD in the environment (CUSTOM_CREDENTIALS=no, or no terminal = defaults).
#
# Env overrides: INSTALL_DIR (default /opt/endpoint-one), ADMIN_EMAIL (first install only),
#                APP_PORT (default 4000), ADVANCED_APP_CONTROL, THREAT_PROTECTION, AI_GUARD (true/false),
#                PRODUCT_EDITION (full / threat-protection; a first install takes the bundle's
#                EDITION file when not given).
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/endpoint-one}"
MODE="install"
[ "${1:-}" = "--rollback" ] && MODE="rollback"
BACKUP_MODE="copy" # copy | in-place | skip

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

# Restricted SQL login the server runs as (see docker-entrypoint.sh ensure_app_login, which
# creates it on every start). Installs from before it existed only have SA_PASSWORD: generate
# its password once, keeping .env private (umask 077 for anything this script creates).
# Its name is APP_DB_USER in .env (chosen at a first install), endpoint_app when not set.
app_db_user() { local u; u="$(env_get APP_DB_USER)"; echo "${u:-endpoint_app}"; }
ensure_app_db_password() {
  if [ -z "$(env_get APP_DB_PASSWORD)" ]; then
    echo "# Password of the restricted SQL login ($(app_db_user)) the server uses; sa is only used for migrations." >> "$INSTALL_DIR/.env"
    env_set APP_DB_PASSWORD "App1!$(openssl rand -hex 16)"
  fi
}

# Same login, created from the database container with sqlcmd - for --rollback, where the
# previous image's start-up doesn't know how to create it. No-op if the db isn't running.
ensure_app_login_in_db() {
  local db_name pw sql APP_DB_USER
  APP_DB_USER="$(app_db_user)"
  db_name="$(env_get DB_NAME)"; db_name="${db_name:-EndpointManagerDb}"
  pw="$(env_get APP_DB_PASSWORD)"
  [ -n "$pw" ] && [ -n "$(compose ps -q db 2>/dev/null)" ] || return 0
  sql="IF SUSER_ID(N'$APP_DB_USER') IS NULL CREATE LOGIN [$APP_DB_USER] WITH PASSWORD = N'$pw', DEFAULT_DATABASE = [$db_name], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF ELSE ALTER LOGIN [$APP_DB_USER] WITH PASSWORD = N'$pw'; USE [$db_name]; IF USER_ID(N'$APP_DB_USER') IS NULL CREATE USER [$APP_DB_USER] FOR LOGIN [$APP_DB_USER] ELSE ALTER USER [$APP_DB_USER] WITH LOGIN = [$APP_DB_USER]; ALTER ROLE db_datareader ADD MEMBER [$APP_DB_USER]; ALTER ROLE db_datawriter ADD MEMBER [$APP_DB_USER]; GRANT EXECUTE TO [$APP_DB_USER];"
  compose exec -T db sh -c "if [ -x /opt/mssql-tools18/bin/sqlcmd ]; then /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P \"\$MSSQL_SA_PASSWORD\" -No -b -Q \"$sql\"; else /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P \"\$MSSQL_SA_PASSWORD\" -b -Q \"$sql\"; fi" >/dev/null \
    || warn "Could not create the SQL login $APP_DB_USER - if the server fails to sign in to the database, see INSTALL.md 'Database login'."
}

# With a certificate installed the HTTP port serves agents only (browsers are redirected).
tls_enabled() { [ -n "$(env_get TLS_PFX_PATH)" ]; }

# Public IP of the admin's SSH session (empty when local, private or unknown). Used to let the
# installing admin reach the console, which otherwise only answers private networks.
detect_ssh_public_ip() {
  local ip
  ip="$(who -m 2>/dev/null | sed -n 's/.*(\([0-9a-fA-F.:]*\)).*/\1/p' | head -1)"
  case "$ip" in
    ''|10.*|192.168.*|127.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|::1|fe80:*|fc*|fd*) echo "" ;;
    *) echo "$ip" ;;
  esac
}

print_access() {
  local allowed_now
  allowed_now="$(env_get ADMIN_ALLOWED_NETWORKS)"
  echo
  if [ -n "$allowed_now" ]; then
    echo "  Admin console reachable from: private networks + ${allowed_now}"
  else
    echo "  Admin console reachable from PRIVATE NETWORKS ONLY - from the internet it shows {\"error\":\"Not found\"}."
  fi
  echo "  To allow another public IP:  sudo sed -i 's|^ADMIN_ALLOWED_NETWORKS=.*|ADMIN_ALLOWED_NETWORKS=<ip>[,<ip>]|' $INSTALL_DIR/.env"
  echo "                               cd $INSTALL_DIR && sudo docker compose up -d --force-recreate server"
}

# Requests the console page from this host (always allowed - private source address) to prove
# the server actually serves the web UI, not just /health.
check_console() {
  local url body
  if tls_enabled; then
    url="https://127.0.0.1:$(env_get HTTPS_PORT | grep . || echo 443)/"
  else
    url="http://127.0.0.1:$(env_get APP_PORT | grep . || echo 4000)/"
  fi
  body="$(curl -fsSk -m 10 "$url" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -qi '<!doctype html'; then
    echo "  Console page check: OK"
  else
    warn "The server is healthy but did not return the console page on $url - check: docker compose logs --tail 100 server"
  fi
}

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
  # Best effort only - never fail the install over a cosmetic lookup (minimal images lack hostname).
  [ -n "$ip" ] || ip="$( (hostname -I 2>/dev/null || true) | awk '{print $1}')"
  [ -n "$ip" ] || ip="<server-ip>"
  if tls_enabled; then
    local hp; hp="$(env_get HTTPS_PORT)"; hp="${hp:-443}"
    echo "  Console:  https://<certificate name>$( [ "$hp" = "443" ] || echo ":$hp" )/"
    echo "  Agents:   http://${ip}:${port}  (agents only - browsers opening it are sent to HTTPS)"
  else
    echo "  Console:  http://${ip}:${port}"
  fi
  echo "  Version:  $(env_get APP_VERSION)"
  echo "  Manage:   cd $INSTALL_DIR && docker compose ps | logs -f server | restart"
}

# --- First-install credentials ----------------------------------------------------------------
# Each check prints why a value can't be used (nothing = fine). The SQL rules are what both SQL
# Server's password policy and the container start-up accept (the values go into connection
# strings and T-SQL unquoted, hence the short symbol list).
sql_password_problem() { # <password> <login name>
  local p="$1" login="$2" kinds=0
  printf '%s' "$p" | LC_ALL=C grep -Eq '^[A-Za-z0-9!_.-]{12,128}$' \
    || { echo "use 12-128 characters: letters, digits and ! _ . - only"; return 0; }
  printf '%s' "$p" | LC_ALL=C grep -q '[A-Z]' && kinds=$((kinds + 1))
  printf '%s' "$p" | LC_ALL=C grep -q '[a-z]' && kinds=$((kinds + 1))
  printf '%s' "$p" | LC_ALL=C grep -q '[0-9]' && kinds=$((kinds + 1))
  printf '%s' "$p" | LC_ALL=C grep -q '[!_.-]' && kinds=$((kinds + 1))
  [ "$kinds" -ge 3 ] || { echo "use at least three of: capital letters, small letters, digits, symbols (! _ . -)"; return 0; }
  if [ "${#login}" -ge 3 ] && printf '%s' "$p" | grep -qiF -- "$login"; then
    echo "the password must not contain the login name ($login)"
  fi
  return 0
}
app_login_problem() {
  printf '%s' "$1" | LC_ALL=C grep -Eq '^[A-Za-z_][A-Za-z0-9_]{2,63}$' \
    || { echo "use 3-64 characters: letters, digits and _, starting with a letter or _"; return 0; }
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    sa|dbo|guest|public|sys|sysadmin|information_schema) echo "'$1' is reserved by SQL Server - choose another name" ;;
  esac
  return 0
}
admin_email_problem() {
  printf '%s' "$1" | LC_ALL=C grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' \
    || echo "enter a valid email address, e.g. it.admin@company.com"
  return 0
}
admin_password_problem() {
  local p="$1"
  { [ "${#p}" -ge 12 ] && [ "${#p}" -le 72 ]; } || { echo "use 12-72 characters"; return 0; }
  case "$p" in *"'"*) echo "the ' character can't be used"; return 0 ;; esac
  case "$p" in *[[:space:]]*) echo "spaces can't be used"; return 0 ;; esac
  case "$(printf '%s' "$p" | tr '[:upper:]' '[:lower:]')" in
    changeme|ch4ngeme_admin!) echo "this is a known example password - choose your own" ;;
  esac
  return 0
}

tty_ask() { # <prompt> -> the reply on stdout
  local reply=""
  printf '%s' "$1" > /dev/tty
  IFS= read -r reply < /dev/tty || reply=""
  printf '%s' "$reply"
}
# Asks until the value passes <check> (extra args go to the check); secrets are hidden and asked twice.
tty_value() { # <label> <secret 0|1> <default or ""> <check> [check args...]
  local label="$1" secret="$2" def="$3" check="$4" v v2 problem
  shift 4
  while :; do
    if [ "$secret" = "1" ]; then
      printf '  %s: ' "$label" > /dev/tty; IFS= read -rs v < /dev/tty || v=""; printf '\n' > /dev/tty
    else
      v="$(tty_ask "  $label${def:+ [$def]}: ")"; [ -n "$v" ] || v="$def"
    fi
    problem="$("$check" "$v" "$@")"
    if [ -n "$problem" ]; then printf '    Not accepted: %s\n' "$problem" > /dev/tty; continue; fi
    if [ "$secret" = "1" ]; then
      printf '  %s (again): ' "$label" > /dev/tty; IFS= read -rs v2 < /dev/tty || v2=""; printf '\n' > /dev/tty
      [ "$v" = "$v2" ] || { printf '    The two entries differ - try again.\n' > /dev/tty; continue; }
    fi
    printf '%s' "$v"
    return 0
  done
}

# Sets CUSTOM_CREDENTIALS (1/0) and, when 1, CRED_SA_PASSWORD, CRED_APP_DB_USER,
# CRED_APP_DB_PASSWORD, CRED_ADMIN_EMAIL and CRED_ADMIN_PASSWORD.
choose_first_install_credentials() {
  local answer problem from_env=0
  answer="$(printf '%s' "${CUSTOM_CREDENTIALS:-}" | tr '[:upper:]' '[:lower:]')"
  CUSTOM_CREDENTIALS=0
  if [ -n "$answer" ]; then
    from_env=1
  elif (: < /dev/tty) 2>/dev/null; then
    {
      echo
      echo "This is a new setup. Do you want to set your own credentials?"
      echo "  yes - you choose the SQL Server (sa) password, the application's SQL login and its"
      echo "        password, and the portal super admin email and password"
      echo "  no  - default names (sa, endpoint_app, ${ADMIN_EMAIL:-admin@endpointone.local}) with strong"
      echo "        random passwords, saved in $INSTALL_DIR/.env and shown when setup finishes"
    } > /dev/tty
    while :; do
      answer="$(tty_ask "Set your own credentials? (yes/no): " | tr '[:upper:]' '[:lower:]')"
      case "$answer" in yes|y|no|n) break ;; *) echo "  Please answer yes or no." > /dev/tty ;; esac
    done
  else
    answer="no" # unattended run without CUSTOM_CREDENTIALS: defaults
  fi
  case "$answer" in
    yes|y) ;;
    no|n) return 0 ;;
    *) die "CUSTOM_CREDENTIALS must be yes or no, got '$answer'." ;;
  esac
  CUSTOM_CREDENTIALS=1

  if [ "$from_env" -eq 1 ]; then
    # Unattended: every value comes from the environment and must pass the same checks.
    CRED_SA_PASSWORD="${SA_PASSWORD:-}"; CRED_APP_DB_USER="${APP_DB_USER:-endpoint_app}"
    CRED_APP_DB_PASSWORD="${APP_DB_PASSWORD:-}"; CRED_ADMIN_EMAIL="${ADMIN_EMAIL:-}"; CRED_ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
    problem="$(sql_password_problem "$CRED_SA_PASSWORD" sa)"; [ -z "$problem" ] || die "SA_PASSWORD: $problem"
    problem="$(app_login_problem "$CRED_APP_DB_USER")"; [ -z "$problem" ] || die "APP_DB_USER: $problem"
    problem="$(sql_password_problem "$CRED_APP_DB_PASSWORD" "$CRED_APP_DB_USER")"; [ -z "$problem" ] || die "APP_DB_PASSWORD: $problem"
    [ "$CRED_APP_DB_PASSWORD" != "$CRED_SA_PASSWORD" ] || die "APP_DB_PASSWORD must differ from SA_PASSWORD."
    problem="$(admin_email_problem "$CRED_ADMIN_EMAIL")"; [ -z "$problem" ] || die "ADMIN_EMAIL: $problem"
    problem="$(admin_password_problem "$CRED_ADMIN_PASSWORD")"; [ -z "$problem" ] || die "ADMIN_PASSWORD: $problem"
    return 0
  fi

  {
    echo
    echo "SQL Server (runs inside Docker; never exposed outside this server)"
    echo "  SQL passwords: 12+ characters - letters, digits and ! _ . - only - with at least three of"
    echo "  capital letters / small letters / digits / symbols."
  } > /dev/tty
  CRED_SA_PASSWORD="$(tty_value "sa (SQL administrator) password" 1 "" sql_password_problem sa)"
  CRED_APP_DB_USER="$(tty_value "Application SQL login name" 0 "endpoint_app" app_login_problem)"
  while :; do
    CRED_APP_DB_PASSWORD="$(tty_value "Password for $CRED_APP_DB_USER" 1 "" sql_password_problem "$CRED_APP_DB_USER")"
    [ "$CRED_APP_DB_PASSWORD" != "$CRED_SA_PASSWORD" ] && break
    echo "    Not accepted: use a different password from the sa password." > /dev/tty
  done
  {
    echo
    echo "Portal super admin (the first console account; it creates the other admins)"
    echo "  Password: 12-72 characters, no spaces and no ' character."
  } > /dev/tty
  CRED_ADMIN_EMAIL="$(tty_value "Super admin email" 0 "${ADMIN_EMAIL:-}" admin_email_problem)"
  CRED_ADMIN_PASSWORD="$(tty_value "Super admin password" 1 "" admin_password_problem)"
  echo > /dev/tty
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
  # The compose file now points the server at the restricted SQL login; an older image can't
  # create it itself, so make sure it exists before starting it.
  ensure_app_db_password
  ensure_app_login_in_db
  compose up -d
  wait_healthy
  log "Rolled back to $prev"
  print_url
  check_console
  exit 0
fi

# --- Install an HTTPS certificate -------------------------------------------------------------
#   sudo bash deploy.sh --install-cert <certificate.pem> <private-key.pem> [chain.pem]
# Converts the PEM pair to the PFX the server loads, after checking that it parses, matches its
# key and hasn't expired; then restarts the server with HTTPS on HTTPS_PORT (default 443).
# Plain HTTP stays on 4000 for agents. Re-run with a renewed certificate to replace it.
if [ "${1:-}" = "--install-cert" ]; then
  cert="${2:-}"; key="${3:-}"; chain="${4:-}"
  usage="Usage: sudo bash deploy.sh --install-cert <certificate.pem> <private-key.pem> [chain.pem]"
  [ -f "$INSTALL_DIR/.env" ] || die "No installation in $INSTALL_DIR - install Endpoint IQ first."
  [ -n "$cert" ] && [ -f "$cert" ] || die "Certificate file not found. $usage"
  [ -n "$key" ] && [ -f "$key" ] || die "Private key file not found. $usage"
  [ -z "$chain" ] || [ -f "$chain" ] || die "Chain file not found: $chain"
  command -v openssl >/dev/null 2>&1 || die "openssl is required (install the openssl package)."

  log "Checking the certificate"
  openssl x509 -in "$cert" -noout >/dev/null 2>&1 \
    || die "$cert is not a PEM certificate. If it's DER/.cer, convert it: openssl x509 -inform der -in $cert -out cert.pem"
  openssl pkey -in "$key" -passin pass: -noout >/dev/null 2>&1 \
    || die "Can't read $key - it must be an unencrypted PEM private key. If it has a passphrase: openssl pkey -in $key -out key-nopass.pem"
  cert_pub="$(openssl x509 -in "$cert" -noout -pubkey | openssl sha256)"
  key_pub="$(openssl pkey -in "$key" -passin pass: -pubout | openssl sha256)"
  [ "$cert_pub" = "$key_pub" ] || die "The certificate and the private key don't belong together."
  openssl x509 -in "$cert" -noout -checkend 0 >/dev/null 2>&1 || die "The certificate has expired."
  openssl x509 -in "$cert" -noout -subject -issuer -enddate | sed 's/^/  /'
  names="$(openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null | tail -n +2 | tr -d ' ' || true)"
  [ -n "$names" ] && echo "  Names: $names"
  openssl x509 -in "$cert" -noout -checkend 2592000 >/dev/null 2>&1 || warn "The certificate expires within 30 days."

  certs_dir="$INSTALL_DIR/certs"
  mkdir -p "$certs_dir" && chmod 700 "$certs_dir"
  pass="$(openssl rand -hex 24)"
  chain_args=()
  if [ -n "$chain" ]; then
    install -m 0644 "$chain" "$certs_dir/chain.pem"
    chain_args=(-certfile "$chain")
  fi
  # Write to a temp file first so a failed export never replaces a working certificate.
  openssl pkcs12 -export -out "$certs_dir/server.pfx.new" -inkey "$key" -in "$cert" ${chain_args[@]+"${chain_args[@]}"} \
    -passin pass: -passout "pass:$pass" || die "Creating the PFX failed."
  chmod 600 "$certs_dir/server.pfx.new"
  mv -f "$certs_dir/server.pfx.new" "$certs_dir/server.pfx"

  env_set TLS_PFX_PATH "/app/certs/server.pfx"
  env_set TLS_PFX_PASSPHRASE "$pass"
  if [ -n "$chain" ]; then env_set TLS_CA_CHAIN_PATH "/app/certs/chain.pem"; else env_set TLS_CA_CHAIN_PATH ""; fi
  grep -qE '^HTTPS_PORT=' "$INSTALL_DIR/.env" || env_set HTTPS_PORT "443"

  log "Restarting the server with HTTPS"
  compose up -d --force-recreate server
  wait_healthy
  https_port="$(env_get HTTPS_PORT)"; https_port="${https_port:-443}"
  if curl -fsSk -m 10 "https://127.0.0.1:${https_port}/" 2>/dev/null | grep -qi '<!doctype html'; then
    echo "  HTTPS check: OK"
  else
    warn "The server restarted but https://127.0.0.1:${https_port}/ did not answer - check: docker compose logs --tail 100 server"
  fi
  log "HTTPS is enabled"
  echo "  Console:  https://<one of the certificate's names>$( [ "$https_port" = "443" ] || echo ":$https_port" )/"
  echo "  Next:     point that DNS name at this server, allow TCP ${https_port} in the firewall/security group,"
  echo "            and add https://<name>$( [ "$https_port" = "443" ] || echo ":$https_port" ) under Enrollment tokens -> Server connection details."
  echo "  Agents already installed keep using http://<server>:4000 - nothing to change on endpoints."
  echo "  Browsers opening http://<server>:4000 are now redirected to HTTPS; that port serves agents only."
  exit 0
fi

# --- Install / upgrade options ----------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --backup-in-place) BACKUP_MODE="in-place" ;;
    --skip-backup) BACKUP_MODE="skip" ;;
    *) die "Unknown option '$arg'. Use: sudo bash deploy.sh [--backup-in-place | --skip-backup], --rollback, or --install-cert" ;;
  esac
done

# --- Bundle checks ----------------------------------------------------------------------------
RELEASE_VERSION="$(tr -d '[:space:]' < "$BUNDLE_DIR/VERSION" 2>/dev/null || true)"
[ -n "$RELEASE_VERSION" ] || die "VERSION file missing - run deploy.sh from inside the extracted release bundle."
SERVER_IMAGE_TAR="$BUNDLE_DIR/images/endpoint-one-server-$RELEASE_VERSION.tar"
[ -f "$SERVER_IMAGE_TAR" ] || die "Missing $SERVER_IMAGE_TAR"
# Which product this bundle installs by default: "full" (Endpoint IQ) or "threat-protection" (the
# separate Endpoint IQ Threat Protection edition). Same image; only the server setting differs.
BUNDLE_EDITION="$(tr -d '[:space:]' < "$BUNDLE_DIR/EDITION" 2>/dev/null || true)"
[ "$BUNDLE_EDITION" = "threat-protection" ] || BUNDLE_EDITION="full"

arch="$(uname -m)"
[ "$arch" = "x86_64" ] || die "An x86_64 server is required (SQL Server has no ARM image); this host is $arch."
mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
[ "$mem_kb" -ge 3800000 ] || warn "Less than 4 GB RAM - SQL Server needs about 2 GB. 8 GB is recommended."

if command -v sha256sum >/dev/null 2>&1 && [ -f "$BUNDLE_DIR/SHA256SUMS" ]; then
  log "Verifying bundle checksums"
  (cd "$BUNDLE_DIR" && sha256sum -c --quiet SHA256SUMS) || die "Checksum mismatch - the bundle is corrupt or was modified."
fi

# --- First-install credentials: asked up front, before the long steps ------------------------
CUSTOM_CREDENTIALS_CHOSEN=0
if [ ! -f "$INSTALL_DIR/.env" ]; then
  choose_first_install_credentials
  CUSTOM_CREDENTIALS_CHOSEN="$CUSTOM_CREDENTIALS"
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
mkdir -p "$INSTALL_DIR/agent-installer" "$INSTALL_DIR/backups" "$INSTALL_DIR/certs"
chmod 700 "$INSTALL_DIR/certs"

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
  if [ "$db_exists" -eq 1 ] && [ "$BACKUP_MODE" = "skip" ]; then
    warn "--skip-backup: the database will NOT be backed up before upgrading to $RELEASE_VERSION."
    warn "If the upgrade fails while changing the database, rollback cannot restore your data."
    if [ "${CONFIRM_SKIP_BACKUP:-}" = "yes" ]; then
      echo "Confirmed by CONFIRM_SKIP_BACKUP=yes."
    elif (: < /dev/tty) 2>/dev/null; then # a terminal we can actually open (not just the device file)
      printf 'Type SKIP to continue without a backup (anything else aborts): ' > /dev/tty
      read -r answer < /dev/tty || answer=""
      [ "$answer" = "SKIP" ] || die "Aborted - nothing was changed. Run without --skip-backup to back up first."
    else
      die "--skip-backup needs confirmation: type SKIP when asked, or set CONFIRM_SKIP_BACKUP=yes."
    fi
    db_exists=0 # nothing to back up from here on
    echo "Skipping the pre-upgrade database backup."
  fi
  if [ "$db_exists" -eq 1 ]; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    bak="pre-upgrade-${PREVIOUS}-${stamp}.bak"
    echo "Backing up database [$db_name] before upgrading (this can take several minutes on a large database)..."
    # sqlcmd prints its errors on stdout: keep the output and show it if the backup fails. The
    # older tools path is only used when tools18 isn't in the image.
    backup_sql="BACKUP DATABASE [$db_name] TO DISK='/var/opt/mssql/backup/$bak' WITH INIT"
    if ! backup_out="$(compose exec -T db sh -c "mkdir -p /var/opt/mssql/backup && if [ -x /opt/mssql-tools18/bin/sqlcmd ]; then /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P \"\$MSSQL_SA_PASSWORD\" -No -b -Q \"$backup_sql\"; else /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P \"\$MSSQL_SA_PASSWORD\" -b -Q \"$backup_sql\"; fi" 2>&1)"; then
      printf '%s\n' "$backup_out" >&2
      echo "Free space in the database volume:" >&2
      compose exec -T db df -h /var/opt/mssql >&2 || true
      die "Pre-upgrade database backup failed (reason above) - upgrade aborted, nothing was changed."
    fi
    if [ "$BACKUP_MODE" = "in-place" ]; then
      echo "Backup kept inside the database volume: /var/opt/mssql/backup/$bak (db container)"
      echo "  Copy it off the server later with: cd $INSTALL_DIR && sudo docker compose cp db:/var/opt/mssql/backup/$bak backups/"
    else
      echo "Copying the backup to $INSTALL_DIR/backups (no progress shown; large databases take a while)..."
      compose cp "db:/var/opt/mssql/backup/$bak" "$INSTALL_DIR/backups/$bak" \
        || die "Copying the backup out of the database container failed - upgrade aborted, nothing was changed. The backup is still at /var/opt/mssql/backup/$bak in the db container."
      echo "Backup saved: $INSTALL_DIR/backups/$bak"
    fi
  fi
fi

log "Installing files to $INSTALL_DIR"
install -m 0644 "$BUNDLE_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
install -m 0644 "$BUNDLE_DIR/INSTALL.md" "$INSTALL_DIR/INSTALL.md"
install -m 0644 "$BUNDLE_DIR/VERSION" "$INSTALL_DIR/VERSION"
install -m 0755 "$BUNDLE_DIR/deploy.sh" "$INSTALL_DIR/deploy.sh"
if ls "$BUNDLE_DIR"/agent-installer/* >/dev/null 2>&1; then
  # -R: the Linux and macOS agents live in linux/ and macos/ sub-folders.
  cp -Rf "$BUNDLE_DIR"/agent-installer/* "$INSTALL_DIR/agent-installer/"
  echo "Agent installers updated."
fi

if [ "$FIRST_INSTALL" -eq 1 ]; then
  log "Generating secrets in $INSTALL_DIR/.env"
  rand() { openssl rand -base64 "$1" | tr -d '\n'; }
  if [ "$CUSTOM_CREDENTIALS_CHOSEN" -eq 1 ]; then
    sa_password="$CRED_SA_PASSWORD"
    app_db_user="$CRED_APP_DB_USER"
    app_db_password="$CRED_APP_DB_PASSWORD"
    admin_email="$CRED_ADMIN_EMAIL"
    # Single quotes: docker compose then reads the value literally (no $ expansion or # comments).
    admin_password_line="ADMIN_PASSWORD='$CRED_ADMIN_PASSWORD'"
  else
    sa_password="Sa1!$(openssl rand -hex 12)"
    app_db_user="endpoint_app"
    app_db_password="App1!$(openssl rand -hex 16)"
    admin_email="${ADMIN_EMAIL:-admin@endpointone.local}"
    admin_password_line="ADMIN_PASSWORD=Adm1!$(openssl rand -hex 8)"
  fi
  # The admin console only answers private networks plus ADMIN_ALLOWED_NETWORKS. Default to
  # the public IP this SSH session comes from, so the installing admin can open it right away.
  allowed="${ADMIN_ALLOWED_NETWORKS:-$(detect_ssh_public_ip)}"
  (
    umask 077
    cat > "$INSTALL_DIR/.env" <<EOF
# Endpoint IQ - generated by deploy.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keep private and BACKED UP.
SA_PASSWORD=${sa_password}
# Restricted SQL login the server uses (read/write/execute on its database only); sa is only used for migrations.
APP_DB_USER=${app_db_user}
APP_DB_PASSWORD=${app_db_password}
JWT_SECRET=$(rand 48)
# Losing FIELD_ENCRYPTION_KEY makes encrypted fields in the database permanently unreadable.
FIELD_ENCRYPTION_KEY=$(rand 32)
ADMIN_EMAIL=${admin_email}
${admin_password_line}
DB_NAME=EndpointManagerDb
APP_PORT=${APP_PORT:-4000}
LICENSE_ENFORCEMENT_ENABLED=false
# Public IPs/CIDRs allowed to open the admin console (comma-separated). Private networks always are.
ADMIN_ALLOWED_NETWORKS=${allowed}
# Advanced application control (Windows AppLocker: DLL, PowerShell and batch blocking, Allow exceptions).
ADVANCED_APP_CONTROL=${ADVANCED_APP_CONTROL:-false}
# Product edition: full (Endpoint IQ) or threat-protection (Endpoint IQ Threat Protection).
PRODUCT_EDITION=${PRODUCT_EDITION:-$BUNDLE_EDITION}
# Threat Protection (Microsoft Defender management) while licence enforcement is off.
THREAT_PROTECTION=${THREAT_PROTECTION:-false}
# AI Guard (generative-AI discovery and control) while licence enforcement is off.
AI_GUARD=${AI_GUARD:-false}
APP_VERSION=${RELEASE_VERSION}
EOF
  )
fi
chmod 600 "$INSTALL_DIR/.env"
ensure_app_db_password
if [ "$FIRST_INSTALL" -eq 0 ] && [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE_VERSION" ]; then
  env_set PREVIOUS_APP_VERSION "$PREVIOUS"
fi
env_set APP_VERSION "$RELEASE_VERSION"

# Installs from before ADMIN_ALLOWED_NETWORKS existed have no such line: add it, with the
# installing admin's public IP, so the console isn't silently hidden after the upgrade. An
# existing line (even empty) is the admin's own choice and is never touched.
if ! grep -qE '^ADMIN_ALLOWED_NETWORKS=' "$INSTALL_DIR/.env"; then
  printf '# Public IPs/CIDRs allowed to open the admin console (comma-separated). Private networks always are.\n' >> "$INSTALL_DIR/.env"
  env_set ADMIN_ALLOWED_NETWORKS "${ADMIN_ALLOWED_NETWORKS:-$(detect_ssh_public_ip)}"
fi

# Advanced application control is an optional extra: run deploy.sh with ADVANCED_APP_CONTROL=true
# (or false) to switch it on (or off) for an existing install too. Without that, .env is left as is.
if [ -n "${ADVANCED_APP_CONTROL:-}" ] && [ "$FIRST_INSTALL" -eq 0 ]; then
  env_set ADVANCED_APP_CONTROL "$ADVANCED_APP_CONTROL"
fi
# Same for Threat Protection and the product edition: only changed on an existing install when
# given (e.g. sudo PRODUCT_EDITION=full bash deploy.sh to move a Threat Protection install to
# full Endpoint IQ - data and agents stay).
if [ -n "${THREAT_PROTECTION:-}" ] && [ "$FIRST_INSTALL" -eq 0 ]; then
  env_set THREAT_PROTECTION "$THREAT_PROTECTION"
fi
if [ -n "${AI_GUARD:-}" ] && [ "$FIRST_INSTALL" -eq 0 ]; then
  env_set AI_GUARD "$AI_GUARD"
fi
if [ -n "${PRODUCT_EDITION:-}" ] && [ "$FIRST_INSTALL" -eq 0 ]; then
  case "$PRODUCT_EDITION" in
    full|threat-protection) env_set PRODUCT_EDITION "$PRODUCT_EDITION" ;;
    *) die "PRODUCT_EDITION must be full or threat-protection, got '$PRODUCT_EDITION'." ;;
  esac
fi

# Guard against the configured version drifting from the bundle (e.g. a variable clobbered by
# an OS file) - compose would otherwise fail later with a confusing "No such image".
written_version="$(env_get APP_VERSION)"
[ "$written_version" = "$RELEASE_VERSION" ] \
  || die "Internal error: .env has APP_VERSION=$written_version but this bundle is $RELEASE_VERSION."

# --- Images -----------------------------------------------------------------------------------
log "Loading the Endpoint IQ image ($RELEASE_VERSION)"
docker load -i "$SERVER_IMAGE_TAR"
docker image inspect "endpoint-one-server:$RELEASE_VERSION" >/dev/null 2>&1 \
  || die "The bundle's image did not load as endpoint-one-server:$RELEASE_VERSION - the bundle may be corrupt."
if [ -f "$BUNDLE_DIR/images/mssql-server.tar" ]; then
  log "Loading the bundled SQL Server image (offline bundle)"
  docker load -i "$BUNDLE_DIR/images/mssql-server.tar"
fi

# --- Start ------------------------------------------------------------------------------------
log "Starting Endpoint IQ"
compose up -d
wait_healthy

log "Endpoint IQ $RELEASE_VERSION is running"
print_url
check_console
if [ "$FIRST_INSTALL" -eq 1 ]; then
  echo
  if [ "$CUSTOM_CREDENTIALS_CHOSEN" -eq 1 ]; then
    echo "  Super admin:  $(env_get ADMIN_EMAIL)  (the password you entered)"
    echo "  SQL logins:   sa and $(app_db_user)  (the passwords you entered)"
  else
    echo "  First administrator (also in $INSTALL_DIR/.env - change the password after signing in):"
    echo "    email:    $(env_get ADMIN_EMAIL)"
    echo "    password: $(env_get ADMIN_PASSWORD)"
  fi
  echo "  All credentials are kept in $INSTALL_DIR/.env (readable by root only)."
  echo
  echo "  BACK UP $INSTALL_DIR/.env now (FIELD_ENCRYPTION_KEY cannot be recovered)."
fi
print_access
if ! ls "$INSTALL_DIR"/agent-installer/EndpointProAgentSetup.exe >/dev/null 2>&1; then
  warn "No agent installer in $INSTALL_DIR/agent-installer - 'Download agent installer' will report it missing."
fi
