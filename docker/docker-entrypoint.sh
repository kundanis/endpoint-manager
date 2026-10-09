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
#   DATABASE_URL         - app connection (the target database).
#   MASTER_DATABASE_URL  - optional; same server, database=master. When set with DB_NAME, the
#                          target database is created if missing. Leave unset for external/managed
#                          SQL where the DB is pre-created.
#   DB_NAME              - target database name (for the CREATE DATABASE check).
set -e
cd /app

PRISMA="./node_modules/.bin/prisma"

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
  "$PRISMA" migrate deploy --schema prisma/schema.prisma
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
    seed_if_needed
    echo "[server] starting..."
    exec node dist/bootstrap.cjs
    ;;
  setup)
    ensure_database
    migrate
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
