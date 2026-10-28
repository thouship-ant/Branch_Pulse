#!/bin/sh
# Step 1 (on your dev machine): export the DEFAULT COMPANY (code CMP000) - its details, branches, users, masters and all
# its business data - plus its uploaded receipts, into ./dev-export/.
#   ./infra/export-dev-data.sh
# Other companies and the Super Admin are NOT exported. Copy dev-export/ to the server (scp, WinSCP ...) and run
# ./infra/import-dev-data.sh there (or just: psql -U postgres -d branch_pulse -v ON_ERROR_STOP=1 --single-transaction -f data.sql). Data only: the schema comes from the migrations, so run `migrate` on the server first.
set -eu
cd "$(dirname "$0")/.."

DEV_DB_CONTAINER="${DEV_DB_CONTAINER:-branch_pulse-postgres-1}"
DEV_DB_NAME="${DEV_DB_NAME:-branch_pulse}"
UPLOADS_DIR="${UPLOADS_DIR:-apps/api/uploads}"
COMPANY="${COMPANY_CODE:-CMP000}"
OUT=dev-export
SCRATCH=bp_export_scratch
mkdir -p "$OUT"

PG="docker exec -i $DEV_DB_CONTAINER"
dev() { $PG psql -U postgres -d "$DEV_DB_NAME" -qAt -v ON_ERROR_STOP=1 "$@"; }
scratch() { $PG psql -U postgres -d "$SCRATCH" -qAt -v ON_ERROR_STOP=1 "$@"; }

[ "$(dev -c "select count(*) from companies where code='$COMPANY'")" = "1" ] || { echo "Dev has no company with code $COMPANY"; exit 1; }

# 1. a throw-away copy of dev, so the live dev database is never touched
$PG psql -U postgres -d postgres -qc "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH" >/dev/null
$PG pg_dump -U postgres -d "$DEV_DB_NAME" --no-owner | $PG psql -U postgres -d "$SCRATCH" -q -o /dev/null -v ON_ERROR_STOP=1

# 2. cut the copy down to the default company: drop every other company, the Super Admin and the global SUPER_ADMIN role
#    (production already has those) together with everything that belongs to them
{
  echo "SET session_replication_role = replica;"
  cat infra/purge-rows.sql
  echo "SELECT pg_temp.bp_delete_company(\$c\$code <> '$COMPANY'\$c\$);"
  # rows that belong to no company: the Super Admin, the global SUPER_ADMIN role and their log entries
  echo "DELETE FROM public.users WHERE company_id IS NULL; DELETE FROM public.roles WHERE company_id IS NULL;"
  echo "DELETE FROM public.audit_logs WHERE company_id IS NULL; DELETE FROM public.notifications WHERE company_id IS NULL;"
  echo "SELECT pg_temp.bp_sweep();"
  # audit_logs.id is an auto-number that production already uses (1, 2, 3 ...): export the rows without it so production
  # numbers them itself (nothing refers to an audit row's id)
  echo "ALTER TABLE public.audit_logs DROP COLUMN id;"
} | $PG psql -U postgres -d "$SCRATCH" -q -o /dev/null -v ON_ERROR_STOP=1

echo "exporting: $(scratch -c "select count(*) from companies") company, $(scratch -c "select count(*) from locations") locations, $(scratch -c "select count(*) from users") users, $(scratch -c "select count(*) from expenses") expenses"

# 3. ONE self-contained SQL file (loads with plain psql, in one transaction): a prelude that replaces any earlier copy of
#    the company and maps permissions/units by code, then the data as INSERT statements, then a postlude. Permissions and
#    units are shared master data production already has (ids differ), so they are mapped, not copied. Sessions and
#    OTPs are not carried over. A user whose mobile/username is already taken is renumbered to the next free one.
COMPANY_ID=$(scratch -c "select id from companies where code='$COMPANY'")
LATEST_MIGRATION=$(dev -c "select max(migration_name) from _prisma_migrations where finished_at is not null")
MAPVALUES=$(dev -F'|' -c "select 'permissions', code, id from permissions union all select 'units', code, id from units" \
  | awk -F'|' '{ printf "%s('"'"'%s'"'"', '"'"'%s'"'"', '"'"'%s'"'"')", (NR>1?",\n":""), $1, $2, $3 }')
PURGE=$(cat infra/purge-rows.sql)
{
  awk -v code="$COMPANY" -v id="$COMPANY_ID" -v mig="$LATEST_MIGRATION" -v map="$MAPVALUES" -v purge="$PURGE" '{
    if ($0 == "__PURGE__") print purge; else if ($0 == "__MAP__;") print map ";";
    else { gsub(/__CODE__/, code); gsub(/__ID__/, id); gsub(/__MIGRATION__/, mig); print }
  }' infra/import-prelude.sql
  $PG pg_dump -U postgres -d "$SCRATCH" --data-only --no-owner --disable-triggers --column-inserts --rows-per-insert=200 \
    --exclude-table=_prisma_migrations --exclude-table-data=permissions --exclude-table-data=units \
    --exclude-table-data=sessions --exclude-table-data=otp_codes \
    | sed '/^[\]restrict /d;/^[\]unrestrict /d' \
    | sed '/^ALTER TABLE public\.users \(DISABLE\|ENABLE\) TRIGGER ALL;$/d' \
    | sed -E "s/setval\('([^']+)', ([0-9]+), (true|false)\)/setval('\1', greatest(\2, (SELECT last_value FROM \1)), \3)/"
  cat infra/import-postlude.sql
} > "$OUT/data.sql"   # a sequence only ever moves forward, so production codes already issued are never reused
rm -f "$OUT/company.txt" "$OUT/idmap.txt"
$PG psql -U postgres -d postgres -qc "DROP DATABASE $SCRATCH" >/dev/null

if [ -d "$UPLOADS_DIR" ]; then
  tar czf "$OUT/uploads.tgz" -C "$UPLOADS_DIR" .
else
  echo "no uploads folder at $UPLOADS_DIR - skipping receipts"
fi

echo "exported to $OUT/ ($(du -h "$OUT/data.sql" | cut -f1) of data)"
