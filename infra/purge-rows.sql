-- Shared by export-dev-data.sh and import-dev-data.sh. The database has almost no foreign keys (Prisma runs without
-- database-level relations), so "everything that belongs to a company" is found here by following the id columns.
--
--   1. delete the root rows of the companies to remove (companies, and every table with a company_id column)
--   2. SELECT pg_temp.bp_sweep();  -- delete every row whose branch / user / role / purchase ... no longer exists
--
-- Run it with session_replication_role = replica. The functions live only in the current session.
CREATE OR REPLACE FUNCTION pg_temp.bp_delete_company(cond text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE company_id IN (SELECT id FROM public.companies WHERE %s)', t, cond);
  END LOOP;
  EXECUTE format('DELETE FROM public.companies WHERE %s', cond);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.bp_sweep() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r record;
  pass int;
BEGIN
  FOR pass IN 1..3 LOOP -- parents can themselves be children (purchases -> purchase_items), so repeat
    -- every table with a location_id column
    FOR r IN
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'location_id'
    LOOP
      EXECUTE format('DELETE FROM public.%I WHERE location_id IS NOT NULL AND location_id NOT IN (SELECT id FROM public.locations)', r.table_name);
    END LOOP;
    -- child table, id column, parent table
    FOR r IN
      SELECT * FROM (VALUES
        ('stock_transfers', 'from_location_id', 'locations'), ('stock_transfers', 'to_location_id', 'locations'),
        ('user_roles', 'user_id', 'users'), ('user_roles', 'role_id', 'roles'), ('user_locations', 'user_id', 'users'),
        ('role_permissions', 'role_id', 'roles'), ('sessions', 'user_id', 'users'), ('sync_operations', 'user_id', 'users'),
        ('notification_deliveries', 'notification_id', 'notifications'), ('notification_deliveries', 'user_id', 'users'),
        ('purchase_items', 'purchase_id', 'purchases'), ('recipe_items', 'recipe_id', 'recipes'),
        ('recipe_cost_snapshots', 'recipe_id', 'recipes'), ('supplier_items', 'supplier_id', 'suppliers'),
        ('stock_count_items', 'stock_count_id', 'stock_counts'), ('stock_transfer_items', 'transfer_id', 'stock_transfers'),
        ('advance_repayments', 'advance_id', 'employee_advances'), ('daily_closing_events', 'daily_closing_id', 'daily_closing'),
        ('attendance', 'employee_id', 'employees'), ('salary', 'employee_id', 'employees'), ('employee_advances', 'employee_id', 'employees')
      ) AS m(child, col, parent)
    LOOP
      EXECUTE format('DELETE FROM public.%I WHERE %I IS NOT NULL AND %I NOT IN (SELECT id FROM public.%I)', r.child, r.col, r.col, r.parent);
    END LOOP;
  END LOOP;
END $$;
