#!/bin/sh
# Deploy / update on the server:  ./infra/deploy.sh
# Pulls the latest code, rebuilds images, applies database migrations, restarts services.
set -eu
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"

[ -f .env.prod ] || { echo "Missing .env.prod (copy .env.prod.example)"; exit 1; }

git pull --ff-only
$COMPOSE build
$COMPOSE up -d db
$COMPOSE run --rm migrate          # applies any new migrations before the new API starts
$COMPOSE up -d --remove-orphans
$COMPOSE ps
docker image prune -f >/dev/null
echo "Deployed. Logs: $COMPOSE logs -f api web"
