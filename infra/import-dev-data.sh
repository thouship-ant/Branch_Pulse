#!/bin/sh
# Step 2 (on the server, right after `run --rm migrate`): load the default company (CMP000) exported from dev.
#   ./infra/import-dev-data.sh               # asks you to type the database name to confirm
#   CONFIRM=yes ./infra/import-dev-data.sh   # non-interactive
#
# Replaces ONLY the default company (its details, branches, users and data). The Super Admin and every other company in
# production are left untouched. A full backup is written first. Run it at go-live, never as part of deploy.sh.
set -eu
cd "$(dirname "$0")/.."

COMPANY="${COMPANY_CODE:-CMP000}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml --env-file .env.prod}"
DATA=dev-export/data.sql
MAP=dev-export/idmap.txt
[ -f .env.prod ] || { echo "Missing .env.prod"; exit 1; }
[ -f "$DATA" ] && [ -f "$MAP" ] || { echo "Missing $DATA / $MAP - run infra/export-dev-data.sh on the dev machine and copy dev-export/ here"; exit 1; }

PSQL="$COMPOSE exec -T db psql -U postgres -d branch_pulse -v ON_ERROR_STOP=1 -qAt"

# the schema must already be migrated
[ "$($PSQL -c "select count(*) from _prisma_migrations where finished_at is not null")" -gt 0 ] || { echo "Run migrate first"; exit 1; }

echo "Production companies: $($PSQL -c "select coalesce(string_agg(code, ', ' order by code), 'none') from companies")"
if [ "${CONFIRM:-}" != "yes" ]; then
  printf "This REPLACES company %s in production with the dev data (other companies and the Super Admin stay). Type 'branch_pulse' to continue: " "$COMPANY"
  read -r answer
  [ "$answer" = "branch_pulse" ] || { echo "Cancelled."; exit 1; }
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 1. permissions and units are shared master data with different ids in each database: map dev id -> production id by code
$PSQL -c "select 'permissions:'||code||'|'||id from permissions union all select 'units:'||code||'|'||id from units" | sort -t'|' -k1,1 > "$TMP/prod.map"
sort -t'|' -k1,1 "$MAP" > "$TMP/dev.map"
join -t'|' -j1 "$TMP/dev.map" "$TMP/prod.map" > "$TMP/joined.map"
if [ "$(wc -l < "$TMP/joined.map")" -ne "$(wc -l < "$TMP/dev.map")" ]; then
  echo "Production is missing permissions/units that dev has (migrations differ). Missing:"
  cut -d'|' -f1 "$TMP/dev.map" | sort > "$TMP/a"; cut -d'|' -f1 "$TMP/joined.map" | sort > "$TMP/b"; comm -23 "$TMP/a" "$TMP/b" | head
  exit 1
fi
awk -F'|' '{ print "s/" $2 "/" $3 "/g" }' "$TMP/joined.map" > "$TMP/map.sed"
sed -f "$TMP/map.sed" "$DATA" > "$TMP/data.sql"

# 2. safety net
BACKUP_DIR="${BACKUP_DIR:-/var/backups/branch-pulse}"
mkdir -p "$BACKUP_DIR"
SAFE="$BACKUP_DIR/before-dev-import-$(date +%F_%H%M).dump"
$COMPOSE exec -T db pg_dump -U postgres -Fc branch_pulse > "$SAFE"
echo "backup of current production data: $SAFE"

$COMPOSE stop api web

# 3. one transaction: remove the old copy of the company (if any), then load the new one. If anything fails nothing changes.
{
  echo "SET session_replication_role = replica;"
  cat infra/purge-rows.sql
  echo "SELECT pg_temp.bp_delete_company(\$c\$code = '$COMPANY'\$c\$);"
  echo "SELECT pg_temp.bp_sweep();"
  cat "$TMP/data.sql"
} | $COMPOSE exec -T db psql -U postgres -d branch_pulse -v ON_ERROR_STOP=1 --single-transaction -q -o /dev/null \
  || { echo "Import FAILED - nothing was changed. Restarting the app."; $COMPOSE start api web; exit 1; }

# 4. receipts and photos
if [ -f dev-export/uploads.tgz ]; then
  docker run --rm -v branch-pulse_uploads:/data -v "$PWD/dev-export":/in alpine tar xzf /in/uploads.tgz -C /data
fi

echo "Loaded $COMPANY: $($PSQL -c "select count(*) from locations l join companies c on c.id=l.company_id where c.code='$COMPANY'") locations, $($PSQL -c "select count(*) from users u join companies c on c.id=u.company_id where c.code='$COMPANY'") users, $($PSQL -c "select count(*) from expenses e join locations l on l.id=e.location_id join companies c on c.id=l.company_id where c.code='$COMPANY'") expenses."
$COMPOSE start api web
echo "Done. Rollback: pg_restore the backup above (see DEPLOY.md Restore)."
