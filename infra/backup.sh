#!/bin/sh
# Daily backup of the database and uploaded receipts. Run from anywhere; cron example in DEPLOY.md.
#   Restore: see DEPLOY.md "Restore".
set -eu
cd "$(dirname "$0")/.."

DEST="${BACKUP_DIR:-/var/backups/branch-pulse}"
STAMP="$(date +%F_%H%M)"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
mkdir -p "$DEST"

# custom-format dump (compressed, restorable table by table)
$COMPOSE exec -T db pg_dump -U postgres -Fc branch_pulse > "$DEST/db-$STAMP.dump"

# receipts / photos live in the named volume <project>_uploads
docker run --rm -v branch-pulse_uploads:/data:ro -v "$DEST":/backup alpine \
  tar czf "/backup/uploads-$STAMP.tgz" -C /data .

# keep 35 days locally (HLD: daily snapshots retained 35 days); copy $DEST off the server too (rclone/rsync)
find "$DEST" -type f \( -name 'db-*.dump' -o -name 'uploads-*.tgz' \) -mtime +35 -delete
echo "backup written to $DEST ($STAMP)"
