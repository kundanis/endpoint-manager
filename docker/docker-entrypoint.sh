#!/bin/sh
# Container entrypoint.
#
#   start  (default) - make the database ready (wait for SQL, create the DB if missing, apply
#                      migrations, seed the admin + baseline data ONCE if not already seeded),
#                      then run the server behind the bytecode integrity check. Safe to restart.
#   setup            - the one-time make-ready steps only, then exit (for running as a separate
#                      job before `start`). Refuses to re-seed if an administrator already exists.
#   <anything else>  - exec it (debugging).
#
# Env:
#   DATABASE_URL         - app connection (the target database). With the bundled SQL Server this
#                          is the restricted login APP_DB_USER, not sa.
#   MIGRATE_DATABASE_URL - optional; a privileged (sa / db_owner) connection to the target database,
#                          used ONLY for migrations and for creating APP_DB_USER. Unset = migrate
#                          with DATABASE_URL (external/managed SQL, as before).
#   MASTER_DATABASE_URL  - optional; same server, database=master. When set with DB_NAME, the
#                          target database is created if missing. Leave unset for external/managed
#                          SQL where the DB is pre-created.
#   DB_NAME              - target database name (for the CREATE DATABASE check).
#   APP_DB_USER / APP_DB_PASSWORD - the restricted login DATABASE_URL uses; created (or its
#                          password re-synced) on every start when MIGRATE_DATABASE_URL and
#                          MASTER_DATABASE_URL are set: db_datareader + db_datawriter + EXECUTE on
#                          the app database only, no server roles.
#
# Started as root only to hand the writable data folders (uploads) to the unprivileged
# 'node' user and stage the TLS certificate for it; `start`/`setup` then re-run as 'node'.
set -e
cd /app

PRISMA="./node_modules/.bin/prisma"
APP_RUN_USER="node"

# --- Root phase: fix ownership, then drop privileges ------------------------------------------
# Volumes created by older releases (which ran as root) are root-owned; chown them once. The
# certificate folder is a read-only bind mount whose files are root-only (chmod 600), so the
# PFX/chain are copied to a container-private folder owned by 'node' instead.
if [ "$(id -u)" = "0" ] && [ -z "${EM_PRIVILEGES_DROPPED:-}" ]; then
  case "${1:-start}" in
    start|setup)
      run_uid="$(id -u "$APP_RUN_USER")"
      run_gid="$(id -g "$APP_RUN_USER")"
      for dir in /app/uploads; do
        mkdir -p "$dir"
        # The folder's own owner says whether it was ever handed over: everything written
        # after that is created by 'node', so the (slow, on a big volume) chown -R runs once.
        if [ "$(stat -c %u "$dir")" != "$run_uid" ]; then
          echo "[init] giving $dir to $APP_RUN_USER..."
          chown -R "$run_uid:$run_gid" "$dir"
        fi
      done
      tls_dir="/run/endpoint-one-tls"
      if [ -n "${TLS_PFX_PATH:-}" ] && [ -f "$TLS_PFX_PATH" ]; then
        mkdir -p "$tls_dir" && chmod 700 "$tls_dir"
        install -m 0600 -o "$run_uid" -g "$run_gid" "$TLS_PFX_PATH" "$tls_dir/server.pfx"
        TLS_PFX_PATH="$tls_dir/server.pfx"; export TLS_PFX_PATH
        if [ -n "${TLS_CA_CHAIN_PATH:-}" ] && [ -f "$TLS_CA_CHAIN_PATH" ]; then
          install -m 0600 -o "$run_uid" -g "$run_gid" "$TLS_CA_CHAIN_PATH" "$tls_dir/chain.pem"
          TLS_CA_CHAIN_PATH="$tls_dir/chain.pem"; export TLS_CA_CHAIN_PATH
        fi
        chown "$run_uid:$run_gid" "$tls_dir"
      fi
      export EM_PRIVILEGES_DROPPED=1 HOME="/home/$APP_RUN_USER"
      exec setpriv --reuid="$run_uid" --regid="$run_gid" --init-groups -- /usr/local/bin/docker-entrypoint.sh "$@"
      ;;
  esac
fi

wait_for_sql() {
  url="$1"
  echo "[db] waiting for SQL Server..."
  i=0
  until echo "SELECT 1;" | "$PRISMA" db execute --url "$url" --stdin >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then
      echo "[db] ERROR: SQL Server not reachable after ~2 minutes." >&2
      exit 1
    fi
    sleep 2
  done
  echo "[db] SQL Server is up."
}

ensure_database() {
  if [ -n "$MASTER_DATABASE_URL" ] && [ -n "$DB_NAME" ]; then
    wait_for_sql "$MASTER_DATABASE_URL"
    echo "[db] creating database [$DB_NAME] if it does not exist..."
    echo "IF DB_ID('$DB_NAME') IS NULL CREATE DATABASE [$DB_NAME];" | "$PRISMA" db execute --url "$MASTER_DATABASE_URL" --stdin
  else
    # External/managed SQL: assume the DB already exists; just wait for it.
    wait_for_sql "$DATABASE_URL"
  fi
}

migrate() {
  echo "[db] applying migrations..."
  # schema.prisma reads DATABASE_URL - point it at the privileged connection for this step only.
  DATABASE_URL="${MIGRATE_DATABASE_URL:-$DATABASE_URL}" "$PRISMA" migrate deploy --schema prisma/schema.prisma
}

# Creates (or re-syncs the password of) the restricted login the server runs as. Idempotent:
# safe on every start, on a fresh install and on an upgrade from a release that used sa.
ensure_app_login() {
  if [ -z "${MIGRATE_DATABASE_URL:-}" ] || [ -z "${MASTER_DATABASE_URL:-}" ] || [ -z "${APP_DB_USER:-}" ]; then
    return 0
  fi
  # Both values go into T-SQL and the connection string: allow only characters that are safe
  # in either without quoting (deploy.sh generates letters, digits and '!').
  printf '%s' "$APP_DB_USER" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,63}$' \
    || { echo "[db] ERROR: APP_DB_USER must be letters, digits and _." >&2; exit 1; }
  printf '%s' "${APP_DB_PASSWORD:-}" | grep -Eq '^[A-Za-z0-9!_.-]{12,128}$' \
    || { echo "[db] ERROR: APP_DB_PASSWORD must be 12-128 characters: letters, digits or ! _ . -" >&2; exit 1; }
  echo "[db] ensuring restricted login [$APP_DB_USER] (read/write/execute on [$DB_NAME] only)..."
  cat <<SQL | "$PRISMA" db execute --url "$MASTER_DATABASE_URL" --stdin
IF SUSER_ID(N'$APP_DB_USER') IS NULL
  CREATE LOGIN [$APP_DB_USER] WITH PASSWORD = N'$APP_DB_PASSWORD', DEFAULT_DATABASE = [$DB_NAME], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF
ELSE
  ALTER LOGIN [$APP_DB_USER] WITH PASSWORD = N'$APP_DB_PASSWORD';
ALTER LOGIN [$APP_DB_USER] ENABLE;
SQL
  cat <<SQL | "$PRISMA" db execute --url "$MIGRATE_DATABASE_URL" --stdin
IF USER_ID(N'$APP_DB_USER') IS NULL
  CREATE USER [$APP_DB_USER] FOR LOGIN [$APP_DB_USER]
ELSE
  ALTER USER [$APP_DB_USER] WITH LOGIN = [$APP_DB_USER];
ALTER ROLE db_datareader ADD MEMBER [$APP_DB_USER];
ALTER ROLE db_datawriter ADD MEMBER [$APP_DB_USER];
GRANT EXECUTE TO [$APP_DB_USER];
IF IS_ROLEMEMBER(N'db_owner', N'$APP_DB_USER') = 1
  ALTER ROLE db_owner DROP MEMBER [$APP_DB_USER];
SQL
}

# The server process needs none of the privileged credentials - keep them out of its
# environment (/proc/<pid>/environ) once the database is ready.
drop_privileged_env() {
  unset MIGRATE_DATABASE_URL MASTER_DATABASE_URL SA_PASSWORD APP_DB_PASSWORD ADMIN_PASSWORD
}

admin_count() {
  node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.adminUser.count().then(n=>{process.stdout.write(String(n));return p.\$disconnect();}).catch(e=>{console.error(e.message);process.exit(2);})"
}

seed_if_needed() {
  n="$(admin_count)"
  if [ -n "$n" ] && [ "$n" -gt 0 ] 2>/dev/null; then
    echo "[setup] already initialized ($n administrator account(s)); skipping seed."
  else
    echo "[setup] seeding administrator account and baseline data..."
    node dist/seed-run.cjs
  fi
}

case "${1:-start}" in
  start)
    ensure_database
    migrate
    ensure_app_login
    seed_if_needed
    drop_privileged_env
    echo "[server] starting..."
    exec node dist/bootstrap.cjs
    ;;
  setup)
    ensure_database
    migrate
    ensure_app_login
    n="$(admin_count)"
    if [ -n "$n" ] && [ "$n" -gt 0 ] 2>/dev/null; then
      echo "[setup] ERROR: already set up ($n administrator account(s)); refusing to re-run." >&2
      exit 3
    fi
    node dist/seed-run.cjs
    echo "[setup] done."
    ;;
  *)
    exec "$@"
    ;;
esac
