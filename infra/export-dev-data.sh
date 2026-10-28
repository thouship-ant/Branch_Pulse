#!/bin/sh
# Step 1 (on your dev machine): export ALL data from the dev PostgreSQL, plus the uploaded receipts, into ./dev-export/.
#   ./infra/export-dev-data.sh
# Then copy the folder to the server (scp, WinSCP, a USB stick ...) and run ./infra/import-dev-data.sh there.
# Data only: the schema comes from the migrations, so run `migrate` on the server first.
set -eu
cd "$(dirname "$0")/.."

DEV_DB_CONTAINER="${DEV_DB_CONTAINER:-branch_pulse-postgres-1}"
DEV_DB_NAME="${DEV_DB_NAME:-branch_pulse}"
UPLOADS_DIR="${UPLOADS_DIR:-apps/api/uploads}"
OUT=dev-export
mkdir -p "$OUT"

# plain SQL (INSERT statements + sequence values): portable between machines, loads with psql
docker exec "$DEV_DB_CONTAINER" pg_dump -U postgres -d "$DEV_DB_NAME" --data-only --no-owner --disable-triggers \
  --column-inserts --rows-per-insert=200 --exclude-table=_prisma_migrations | sed '/^[\\]restrict /d;/^[\\]unrestrict /d' > "$OUT/data.sql"

if [ -d "$UPLOADS_DIR" ]; then
  tar czf "$OUT/uploads.tgz" -C "$UPLOADS_DIR" .
else
  echo "no uploads folder at $UPLOADS_DIR - skipping receipts"
fi

echo "exported to $OUT/ ($(du -h "$OUT/data.sql" | cut -f1) of data)"
