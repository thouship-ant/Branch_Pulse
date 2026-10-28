#!/bin/sh
# Step 2 (on the server, right after `run --rm migrate`): load the default company (CMP000) exported from dev.
#   ./infra/import-dev-data.sh               # asks you to type the database name to confirm
#   CONFIRM=yes ./infra/import-dev-data.sh   # non-interactive
#   ALSO_REMOVE="CMP002 CMP003" ./infra/import-dev-data.sh   # also delete these (test) companies
#
# Replaces ONLY the default company (found by code or id). The Super Admin and every other company in production are
# left untouched. A user whose mobile number is already taken is renumbered to the next free one. A backup is written first.
# dev-export/data.sql is self-contained, so this wrapper is optional:
#   docker compose ... exec -T db psql -U postgres -d branch_pulse -v ON_ERROR_STOP=1 --single-transaction -q < dev-export/data.sql
set -eu
cd "$(dirname "$0")/.."

COMPANY="${COMPANY_CODE:-CMP000}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml --env-file .env.prod}"
DATA=dev-export/data.sql
[ -f .env.prod ] || { echo "Missing .env.prod"; exit 1; }
[ -f "$DATA" ] || { echo "Missing $DATA - run infra/export-dev-data.sh on the dev machine and copy dev-export/ here"; exit 1; }

PSQL="$COMPOSE exec -T db psql -U postgres -d branch_pulse -v ON_ERROR_STOP=1 -qAt"

echo "Production companies: $($PSQL -c "select coalesce(string_agg(code, ', ' order by code), 'none') from companies")"
if [ "${CONFIRM:-}" != "yes" ]; then
  printf "This REPLACES company %s in production with the dev data (other companies and the Super Admin stay). Type 'branch_pulse' to continue: " "$COMPANY"
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

# 2. one transaction: if anything fails nothing changes
ALSO=""
for c in ${ALSO_REMOVE:-}; do ALSO="${ALSO:+$ALSO,}'$c'"; done
if $COMPOSE exec -T db psql -U postgres -d branch_pulse -v ON_ERROR_STOP=1 --single-transaction -q ${ALSO:+-v also_remove="$ALSO"} < "$DATA" >/dev/null; then :; else
  echo "Import FAILED - nothing was changed. Restarting the app."; $COMPOSE start api web; exit 1
fi

# 3. receipts and photos
if [ -f dev-export/uploads.tgz ]; then
  docker run --rm -v branch-pulse_uploads:/data -v "$PWD/dev-export":/in alpine tar xzf /in/uploads.tgz -C /data
fi

echo "Loaded $COMPANY: $($PSQL -c "select count(*) from locations l join companies c on c.id=l.company_id where c.code='$COMPANY'") locations, $($PSQL -c "select count(*) from users u join companies c on c.id=u.company_id where c.code='$COMPANY'") users, $($PSQL -c "select count(*) from expenses e join locations l on l.id=e.location_id join companies c on c.id=l.company_id where c.code='$COMPANY'") expenses."
$COMPOSE start api web
echo "Done. Rollback: pg_restore the backup above (see DEPLOY.md Restore)."
