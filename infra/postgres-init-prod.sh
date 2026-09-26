#!/bin/sh
# Runs once, when the production Postgres volume is first created.
# Creates the non-owner application role so row-level security applies to the API (see infra/postgres-init.sql for dev).
set -e
psql -v ON_ERROR_STOP=1 -v app_pw="$APP_RW_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE app_rw LOGIN PASSWORD :'app_pw' NOBYPASSRLS;
CREATE ROLE audit_ro NOLOGIN;
GRANT CONNECT ON DATABASE branch_pulse TO app_rw;
GRANT USAGE ON SCHEMA public TO app_rw;
SQL
