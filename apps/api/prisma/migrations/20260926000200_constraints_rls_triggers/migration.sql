-- LLD s7: constraints, indexes, row-level security, lock triggers and privileges.
-- Everything Prisma's schema language cannot express lives here.

-- The application role must exist (see infra/postgres-init.sql for local dev).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    RAISE EXCEPTION 'Role app_rw does not exist. Create it before running migrations (see infra/postgres-init.sql).';
  END IF;
END $$;

-- ------------------------------------------------------------------ CHECK constraints
ALTER TABLE roles ADD CONSTRAINT ck_roles_scope_mode CHECK (scope_mode IN ('ALL','ASSIGNED'));
ALTER TABLE users ADD CONSTRAINT ck_users_lang CHECK (preferred_language IN ('en','ta'));
ALTER TABLE daily_sales
  ADD CONSTRAINT ck_daily_sales_total CHECK (total_sales >= 0),
  ADD CONSTRAINT ck_daily_sales_cash CHECK (cash_sales >= 0),
  ADD CONSTRAINT ck_daily_sales_upi CHECK (upi_sales >= 0),
  ADD CONSTRAINT ck_daily_sales_card CHECK (card_sales >= 0),
  ADD CONSTRAINT ck_daily_sales_credit CHECK (credit_sales >= 0);
ALTER TABLE cash_transactions
  ADD CONSTRAINT ck_cash_txn_direction CHECK (direction IN (1, -1)),
  ADD CONSTRAINT ck_cash_txn_amount CHECK (amount > 0);
ALTER TABLE expenses ADD CONSTRAINT ck_expenses_amount CHECK (amount > 0);
ALTER TABLE purchases
  ADD CONSTRAINT ck_purchases_total CHECK (total_amount >= 0),
  ADD CONSTRAINT ck_purchases_paid CHECK (paid_amount >= 0 AND paid_amount <= total_amount);
ALTER TABLE purchase_items
  ADD CONSTRAINT ck_purchase_items_qty CHECK (quantity > 0),
  ADD CONSTRAINT ck_purchase_items_rate CHECK (rate >= 0);
ALTER TABLE supplier_payments
  ADD CONSTRAINT ck_supplier_payments_amount CHECK (amount > 0),
  ADD CONSTRAINT ck_supplier_payments_mode CHECK (payment_mode <> 'CREDIT');
ALTER TABLE supplier_ledger
  ADD CONSTRAINT ck_supplier_ledger_type CHECK (entry_type IN ('OPENING','PURCHASE','PAYMENT','REVERSAL','ADJUSTMENT')),
  ADD CONSTRAINT ck_supplier_ledger_side CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0));
ALTER TABLE inventory_transactions ADD CONSTRAINT ck_invtxn_qty CHECK (quantity <> 0);
ALTER TABLE stock_transfers ADD CONSTRAINT ck_transfer_from_to CHECK (from_location_id <> to_location_id);
ALTER TABLE stock_transfer_items ADD CONSTRAINT ck_transfer_items_qty CHECK (sent_qty > 0);
ALTER TABLE stock_counts ADD CONSTRAINT ck_stock_counts_type CHECK (count_type IN ('OPENING','CLOSING','ADHOC'));
ALTER TABLE stock_count_items ADD CONSTRAINT ck_count_items_qty CHECK (physical_qty >= 0);
ALTER TABLE wastage ADD CONSTRAINT ck_wastage_qty CHECK (quantity > 0);
ALTER TABLE attachments ADD CONSTRAINT ck_attachments_size CHECK (size_bytes <= 5242880);
ALTER TABLE employees
  ADD CONSTRAINT ck_employees_salary_type CHECK (salary_type IN ('MONTHLY','DAILY')),
  ADD CONSTRAINT ck_employees_pay_method CHECK (payment_method IN ('CASH','BANK','UPI'));
ALTER TABLE salary ADD CONSTRAINT ck_salary_pay_status CHECK (payment_status IN ('UNPAID','PARTIAL','PAID'));
ALTER TABLE employee_advances ADD CONSTRAINT ck_advances_amount CHECK (amount > 0);
ALTER TABLE advance_repayments
  ADD CONSTRAINT ck_repayments_amount CHECK (amount > 0),
  ADD CONSTRAINT ck_repayments_mode CHECK (mode IN ('SALARY','CASH'));
ALTER TABLE expense_categories
  ADD CONSTRAINT ck_expense_categories_bucket CHECK (pl_bucket IN
    ('RAW_MATERIAL','SALARY','RENT','ELECTRICITY','TRANSPORT','MAINTENANCE','OTHER','NON_PL'));
ALTER TABLE notifications
  ADD CONSTRAINT ck_notifications_status CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','AUTO_RESOLVED'));
ALTER TABLE report_exports ADD CONSTRAINT ck_report_exports_format CHECK (format IN ('XLSX','PDF'));

-- ------------------------------------------------------------------ partial unique indexes
CREATE UNIQUE INDEX uq_daily_sales ON daily_sales (location_id, business_date) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_notifications_open ON notifications (dedupe_key) WHERE status IN ('OPEN','ACKNOWLEDGED');
CREATE INDEX ix_expenses_loc_date_incl ON expenses (location_id, business_date) INCLUDE (amount, category_id, approval_status);

-- ------------------------------------------------------------------ foreign keys
-- Prisma models only declare parent -> child relations; every other FK is created here.
-- Format: 'table.column>referenced_table'  (referenced column is always id, except where noted)
DO $$
DECLARE
  fk text;
  parts text[];
  tbl text; col text; ref text;
BEGIN
  FOREACH fk IN ARRAY ARRAY[
    -- location scope
    'daily_sales.location_id>locations', 'cash_transactions.location_id>locations',
    'cash_reconciliation.location_id>locations', 'daily_closing.location_id>locations',
    'attendance.location_id>locations', 'expenses.location_id>locations', 'purchases.location_id>locations',
    'supplier_payments.location_id>locations', 'supplier_ledger.location_id>locations',
    'inventory_transactions.location_id>locations', 'inventory_transactions.counterparty_location_id>locations',
    'stock_balances.location_id>locations', 'stock_counts.location_id>locations', 'wastage.location_id>locations',
    'employees.location_id>locations', 'salary.location_id>locations', 'employee_advances.location_id>locations',
    'profit_loss.location_id>locations', 'attachments.location_id>locations', 'notifications.location_id>locations',
    'user_locations.location_id>locations', 'item_location_settings.location_id>locations',
    'stock_transfers.from_location_id>locations', 'stock_transfers.to_location_id>locations',
    'locations.manager_user_id>users',
    -- actors
    'daily_sales.submitted_by>users', 'daily_closing.submitted_by>users', 'daily_closing.reviewed_by>users',
    'daily_closing_events.actor_id>users', 'cash_reconciliation.approved_by>users',
    'expenses.entered_by>users', 'expenses.approved_by>users',
    'purchases.entered_by>users', 'purchases.approved_by>users',
    'wastage.entered_by>users', 'wastage.approved_by>users',
    'attendance.marked_by>users', 'attachments.created_by>users',
    'employee_advances.requested_by>users', 'stock_transfers.requested_by>users',
    -- links between records
    'daily_closing.daily_sales_id>daily_sales', 'daily_closing.cash_reconciliation_id>cash_reconciliation',
    'cash_transactions.reversal_of_id>cash_transactions', 'expenses.reversal_of_id>expenses',
    'purchases.reversal_of_id>purchases', 'supplier_payments.reversal_of_id>supplier_payments',
    'inventory_transactions.reversal_of_id>inventory_transactions',
    'supplier_payments.purchase_id>purchases', 'advance_repayments.salary_id>salary',
    -- master data
    'expenses.category_id>expense_categories', 'expenses.sub_category_id>expense_categories',
    'expense_categories.parent_id>expense_categories',
    'expenses.supplier_id>suppliers', 'purchases.supplier_id>suppliers',
    'supplier_payments.supplier_id>suppliers', 'supplier_ledger.supplier_id>suppliers',
    'supplier_items.supplier_id>suppliers', 'supplier_items.item_id>inventory_items',
    'expenses.employee_id>employees', 'attendance.employee_id>employees', 'salary.employee_id>employees',
    'employee_advances.employee_id>employees', 'users.employee_id>employees',
    'purchase_items.item_id>inventory_items', 'inventory_transactions.item_id>inventory_items',
    'stock_balances.item_id>inventory_items', 'stock_transfer_items.item_id>inventory_items',
    'stock_count_items.item_id>inventory_items', 'wastage.item_id>inventory_items',
    'recipe_items.item_id>inventory_items', 'item_location_settings.item_id>inventory_items',
    'inventory_items.base_unit_id>units', 'inventory_items.purchase_unit_id>units',
    'purchase_items.unit_id>units', 'wastage.unit_id>units', 'recipe_items.unit_id>units',
    'units.base_unit_id>units',
    'recipe_cost_snapshots.recipe_id>recipes', 'approval_limits.role_id>roles',
    'notifications.rule_code>alert_rules(code)',
    'notification_deliveries.notification_id>notifications'
  ]
  LOOP
    parts := regexp_split_to_array(fk, '[.>]');
    tbl := parts[1]; col := parts[2]; ref := parts[3];
    IF ref LIKE '%(code)' THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (code)',
        tbl, 'fk_' || tbl || '_' || col, col, replace(ref, '(code)', ''));
    ELSE
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (id)',
        tbl, 'fk_' || tbl || '_' || col, col, ref);
    END IF;
  END LOOP;
END $$;

-- user_locations rows may point at a location; item_location_settings/stock_balances at both item and location.

-- ------------------------------------------------------------------ supplier balance view
CREATE VIEW v_supplier_balance AS
SELECT s.id AS supplier_id,
       SUM(l.debit)  FILTER (WHERE l.entry_type IN ('OPENING','PURCHASE')) AS total_purchases,
       SUM(l.credit) FILTER (WHERE l.entry_type = 'PAYMENT')               AS total_paid,
       COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)              AS outstanding
FROM suppliers s LEFT JOIN supplier_ledger l ON l.supplier_id = s.id
GROUP BY s.id;

-- ------------------------------------------------------------------ row-level security
-- The API sets, per transaction:
--   SET LOCAL app.all_locations = 'true' | 'false';
--   SET LOCAL app.allowed_locations = '<uuid>,<uuid>';
-- Unset variables deny access (deny by default).
CREATE FUNCTION app_scope_ok(loc uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.all_locations', true), '') = 'true'
      OR loc = ANY (string_to_array(nullif(current_setting('app.allowed_locations', true), ''), ',')::uuid[])
$$;

DO $$
DECLARE r record;
BEGIN
  -- every table that carries location_id (rows with NULL location are shared, e.g. login audit rows)
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'location_id'
      AND table_name NOT IN ('user_locations')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format(
      'CREATE POLICY p_scope ON %I USING (location_id IS NULL OR app_scope_ok(location_id)) '
      'WITH CHECK (location_id IS NULL OR app_scope_ok(location_id))', r.table_name);
  END LOOP;
END $$;

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_scope ON locations USING (app_scope_ok(id)) WITH CHECK (app_scope_ok(id));

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_scope ON stock_transfers
  USING (app_scope_ok(from_location_id) OR app_scope_ok(to_location_id))
  WITH CHECK (app_scope_ok(from_location_id) OR app_scope_ok(to_location_id));

-- child tables without their own location_id inherit through the parent
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_scope ON stock_transfer_items
  USING (EXISTS (SELECT 1 FROM stock_transfers t WHERE t.id = transfer_id))
  WITH CHECK (EXISTS (SELECT 1 FROM stock_transfers t WHERE t.id = transfer_id));

ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_scope ON purchase_items
  USING (EXISTS (SELECT 1 FROM purchases p WHERE p.id = purchase_id))
  WITH CHECK (EXISTS (SELECT 1 FROM purchases p WHERE p.id = purchase_id));

ALTER TABLE stock_count_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_scope ON stock_count_items
  USING (EXISTS (SELECT 1 FROM stock_counts c WHERE c.id = stock_count_id))
  WITH CHECK (EXISTS (SELECT 1 FROM stock_counts c WHERE c.id = stock_count_id));

ALTER TABLE daily_closing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_scope ON daily_closing_events
  USING (EXISTS (SELECT 1 FROM daily_closing c WHERE c.id = daily_closing_id))
  WITH CHECK (EXISTS (SELECT 1 FROM daily_closing c WHERE c.id = daily_closing_id));

-- ------------------------------------------------------------------ lock triggers
-- No insert/update of rows that belong to a branch-day whose closing is APPROVED.
-- SECURITY DEFINER so the check sees the closing row regardless of the caller's scope.
CREATE FUNCTION trg_block_locked() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE loc uuid; d date;
BEGIN
  IF TG_OP = 'INSERT' THEN loc := NEW.location_id; d := NEW.business_date;
  ELSE loc := OLD.location_id; d := OLD.business_date; END IF;
  -- Reversal of an approved record only flips record status (mirror postings are dated today),
  -- so a status-only change to REVERSED is allowed on a locked day.
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW)->>'status' = 'REVERSED' AND to_jsonb(OLD)->>'status' = 'ACTIVE'
     AND (to_jsonb(NEW) - 'status' - 'updated_at' - 'updated_by' - 'version')
       = (to_jsonb(OLD) - 'status' - 'updated_at' - 'updated_by' - 'version') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM daily_closing dc
             WHERE dc.location_id = loc AND dc.business_date = d AND dc.status = 'APPROVED') THEN
    RAISE EXCEPTION 'DAY_LOCKED: % % is approved; reopen required', loc, d;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses','daily_sales','cash_transactions','cash_reconciliation',
                           'purchases','wastage','stock_counts']
  LOOP
    EXECUTE format('CREATE TRIGGER t_lock_%1$s BEFORE INSERT OR UPDATE ON %1$I '
                   'FOR EACH ROW EXECUTE FUNCTION trg_block_locked()', t);
  END LOOP;
END $$;

-- After APPROVED only status/reversal columns may change; amounts and identity are immutable.
CREATE FUNCTION trg_block_approved_expense_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approval_status = 'APPROVED' AND (
       NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.business_date IS DISTINCT FROM OLD.business_date
    OR NEW.location_id IS DISTINCT FROM OLD.location_id
    OR NEW.category_id IS DISTINCT FROM OLD.category_id) THEN
    RAISE EXCEPTION 'APPROVED_IMMUTABLE: reverse and re-enter instead';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t_approved_expenses BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_block_approved_expense_edit();

CREATE FUNCTION trg_block_approved_purchase_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approval_status = 'APPROVED' AND (
       NEW.total_amount IS DISTINCT FROM OLD.total_amount
    OR NEW.business_date IS DISTINCT FROM OLD.business_date
    OR NEW.location_id IS DISTINCT FROM OLD.location_id
    OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id) THEN
    RAISE EXCEPTION 'APPROVED_IMMUTABLE: reverse and re-enter instead';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t_approved_purchases BEFORE UPDATE ON purchases
  FOR EACH ROW EXECUTE FUNCTION trg_block_approved_purchase_edit();

-- ------------------------------------------------------------------ privileges
GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_rw;

-- No hard deletes of financial/stock rows: app_rw has no DELETE except on pure assignment tables.
GRANT DELETE ON user_roles, user_locations, role_permissions, supplier_items TO app_rw;

-- Append-only history.
REVOKE UPDATE ON audit_logs, inventory_transactions, supplier_ledger, daily_closing_events FROM app_rw;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_ro') THEN
    GRANT SELECT ON audit_logs TO audit_ro;
  END IF;
END $$;
