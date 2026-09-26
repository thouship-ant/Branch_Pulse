-- Runs once when the dev Postgres container is first created.
-- The API connects as app_rw (no BYPASSRLS, no DELETE on history) so that row-level
-- security in migrations actually applies. Migrations/seed run as the owner (postgres).
CREATE ROLE app_rw LOGIN PASSWORD 'app_rw' NOBYPASSRLS;
CREATE ROLE audit_ro NOLOGIN;
GRANT CONNECT ON DATABASE branch_pulse TO app_rw;
GRANT USAGE ON SCHEMA public TO app_rw;
