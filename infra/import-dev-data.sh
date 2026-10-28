#!/bin/sh
# Step 2 (on the server, right after `run --rm migrate`): replace the production data with the dev export.
#   ./infra/import-dev-data.sh            # asks you to type the database name to confirm
#   CONFIRM=yes ./infra/import-dev-data.sh   # non-interactive
#
# DESTRUCTIVE: every table in production is emptied first, then filled from dev-export/data.sql.
# A full backup is written before anything changes. Run this once at go-live, never as part of deploy.sh.
set -eu
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
DUMP=dev-export/data.sql
[ -f .env.prod ] || { echo "Missing .env.prod"; exit 1; }
[ -f "$DUMP" ] || { echo "Missing $DUMP - run infra/export-dev-data.sh on the dev machine and copy dev-export/ here"; exit 1; }

PSQL="$COMPOSE exec -T db psql -U postgres -d branch_pulse -v ON_ERROR_STOP=1 -qAt"

# the schema must already be migrated
[ "$($PSQL -c "select count(*) from _prisma_migrations where finished_at is not null")" -gt 0 ] || { echo "Run migrate first"; exit 1; }

echo "Production now holds: $($PSQL -c "select count(*) from companies") companies, $($PSQL -c "select count(*) from users") users."
if [ "${CONFIRM:-}" != "yes" ]; then
  printf "This ERASES that data and loads the dev data. Type 'branch_pulse' to continue: "
  read -r answer
  [ "$answer" = "branch_pulse" ] || { echo "Cancelled."; exit 1; }
fi

# 1. safety net
BACKUP_DIR="${BACKUP_DIR:-/var/backups/branch-pulse}"
mkdir -p "$BACKUP_DIR"
SAFE="$BACKUP_DIR/before-dev-import-$(date +%F_%H%M).dump"
$COMPOSE exec -T db pg_dump -U postgres -Fc branch_pulse > "$SAFE"
echo "backup of current production data: $SAFE"

$COMPOSE stop api web

# production keeps its OWN Super Admin password (the one from .env.prod SEED_PASSWORD), not the dev one that is in the export
SUPER_HASH=$($PSQL -c "select password_hash from users where username='superadmin' and company_id is null")

# 2. empty every table except Prisma's own history, then load (triggers off so foreign keys can load in any order)
TABLES=$($PSQL -c "select string_agg(format('%I.%I', schemaname, tablename), ', ') from pg_tables where schemaname='public' and tablename <> '_prisma_migrations'")
$PSQL -c "TRUNCATE $TABLES RESTART IDENTITY CASCADE"
# one transaction: if any statement fails nothing is loaded
cat "$DUMP" | $COMPOSE exec -T db psql -U postgres -d branch_pulse -v ON_ERROR_STOP=1 --single-transaction -q -o /dev/null

if [ -n "$SUPER_HASH" ]; then
  $PSQL -c "update users set password_hash = \$h\$$SUPER_HASH\$h\$, failed_logins = 0, locked_until = null where username='superadmin' and company_id is null"
  echo "Super Admin keeps the production password"
else
  echo "No Super Admin existed in production: the dev one was loaded (password ChangeMe@123 unless you changed it) - change it now"
fi

# 3. receipts and photos
if [ -f dev-export/uploads.tgz ]; then
  docker run --rm -v branch-pulse_uploads:/data -v "$PWD/dev-export":/in alpine tar xzf /in/uploads.tgz -C /data
fi

echo "Loaded: $($PSQL -c "select count(*) from companies") companies, $($PSQL -c "select count(*) from users") users, $($PSQL -c "select count(*) from expenses") expenses."
$COMPOSE start api web
echo "Done. Rollback: pg_restore the backup above (see DEPLOY.md Restore)."
