-- Multi-company (tenancy). One database, many companies:
--   * companies table; company_id on every company-owned master table
--   * existing single-company data moves into one "Default Company"
--   * row-level security keeps companies apart (extends the branch-scope policies from migration 0200)
--   * roles: Owner -> Admin, new Super Admin; mobile + OTP sign-in table

-- ------------------------------------------------------------------ new tables
CREATE TABLE companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(12) NOT NULL UNIQUE,
  name       varchar(120) NOT NULL,
  address    text,
  gstin      varchar(15),
  fssai      varchar(14),
  email      varchar(120),
  status     record_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 1
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile      varchar(15) NOT NULL,
  code_hash   text NOT NULL,
  password_ok boolean NOT NULL DEFAULT false,
  attempts    smallint NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_mobile_created_at_idx ON otp_codes (mobile, created_at DESC);

-- everything that exists today belongs to one company
INSERT INTO companies (code, name)
SELECT 'CMP000', coalesce((SELECT value #>> '{}' FROM settings WHERE key = 'business.name'), 'Default Company');

-- ------------------------------------------------------------------ company_id columns
-- Nullable first, backfilled with the default company, then tightened. The column default reads the session variable
-- the API sets per transaction, so inserts made through PrismaService.runScoped need no code change.
DO $$
DECLARE
  t text;
  def uuid := (SELECT id FROM companies WHERE code = 'CMP000');
  expr text := $e$(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid$e$;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles','users','approval_limits','locations','inventory_items','suppliers','recipes',
                           'expense_categories','settings','audit_logs','notifications']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN company_id uuid', t);
    -- system roles stay NULL (shared by every company); users stay NULL only for Super Admin (none exist yet)
    IF t <> 'roles' THEN EXECUTE format('UPDATE %I SET company_id = %L', t, def); END IF;
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES companies (id)', t, 'fk_' || t || '_company');
    EXECUTE format('CREATE INDEX %I ON %I (company_id)', t || '_company_id_idx', t);
    IF t NOT IN ('users') THEN EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET DEFAULT %s', t, expr); END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['approval_limits','locations','inventory_items','suppliers','recipes','expense_categories','settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET NOT NULL', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------------ uniqueness is now per company
DROP INDEX roles_code_key;
CREATE UNIQUE INDEX uq_roles_system_code ON roles (code) WHERE company_id IS NULL;
CREATE UNIQUE INDEX uq_roles_company_code ON roles (company_id, code) WHERE company_id IS NOT NULL;

DROP INDEX locations_code_key;
CREATE UNIQUE INDEX uq_locations_company_code ON locations (company_id, code);
DROP INDEX inventory_items_code_key;
CREATE UNIQUE INDEX uq_items_company_code ON inventory_items (company_id, code);
DROP INDEX suppliers_code_key;
CREATE UNIQUE INDEX uq_suppliers_company_code ON suppliers (company_id, code);
DROP INDEX recipes_code_key;
CREATE UNIQUE INDEX uq_recipes_company_code ON recipes (company_id, code);

DROP INDEX IF EXISTS expense_categories_parent_id_name_en_key;
CREATE UNIQUE INDEX uq_expense_categories ON expense_categories (company_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name_en);

DROP INDEX IF EXISTS approval_limits_role_id_entity_type_key;
CREATE UNIQUE INDEX approval_limits_company_id_role_id_entity_type_key ON approval_limits (company_id, role_id, entity_type);

ALTER TABLE settings DROP CONSTRAINT settings_pkey;
ALTER TABLE settings ADD PRIMARY KEY (company_id, key);

-- ------------------------------------------------------------------ roles: Owner -> Admin, new Super Admin
UPDATE roles SET code = 'ADMIN', name = 'Admin' WHERE code = 'OWNER' AND company_id IS NULL;
UPDATE roles SET name = 'Stock Manager' WHERE code = 'STOCK_MANAGER' AND company_id IS NULL;
UPDATE users SET username = 'admin', full_name = CASE WHEN full_name = 'Owner' THEN 'Admin' ELSE full_name END WHERE username = 'owner';
UPDATE users SET username = 'StockManager', full_name = 'Stock Manager' WHERE username = 'stockmgr';

INSERT INTO permissions (id, code, module, description)
VALUES (gen_random_uuid(), 'company:manage', 'company', 'Create and manage companies (Super Admin only)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (id, code, name, is_system, scope_mode, company_id, updated_at)
SELECT gen_random_uuid(), 'SUPER_ADMIN', 'Super Admin', true, 'ALL', NULL, now()
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'SUPER_ADMIN' AND company_id IS NULL);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'SUPER_ADMIN' AND r.company_id IS NULL AND p.code = 'company:manage'
ON CONFLICT DO NOTHING;

-- dev convenience: give the seeded users a mobile number (sign-in is by mobile + OTP now)
UPDATE users SET mobile = '9000000001' WHERE username = 'admin' AND mobile IS NULL;
UPDATE users SET mobile = '9000000002' WHERE username = 'accountant' AND mobile IS NULL;
UPDATE users SET mobile = '9000000003' WHERE username = 'StockManager' AND mobile IS NULL;
UPDATE users SET mobile = '90000000' || (10 + substring(username from 8)::int)::text
  WHERE username ~ '^manager[0-9]$' AND mobile IS NULL;

-- ------------------------------------------------------------------ row-level security
-- The API sets per transaction (see PrismaService.runScoped):
--   app.super = 'true'            Super Admin: every company
--   app.company_id = '<uuid>'     the caller's company
--   app.all_locations / app.allowed_locations   as before, now limited to the caller's company
--   app.auth = 'true'             sign-in / session lookups, which happen before the company is known

CREATE FUNCTION app_is_super() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.super', true), '') = 'true'
$$;

CREATE FUNCTION app_company_ok(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app_is_super()
      OR (cid IS NOT NULL AND cid = nullif(current_setting('app.company_id', true), '')::uuid)
$$;

-- SECURITY DEFINER: it reads locations, whose own policy calls this function (no RLS recursion for the owner).
CREATE OR REPLACE FUNCTION app_scope_ok(loc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_super()
      OR (loc = ANY (string_to_array(nullif(current_setting('app.allowed_locations', true), ''), ',')::uuid[])
          AND EXISTS (SELECT 1 FROM locations l WHERE l.id = loc AND l.company_id = nullif(current_setting('app.company_id', true), '')::uuid))
      OR (coalesce(current_setting('app.all_locations', true), '') = 'true'
          AND EXISTS (SELECT 1 FROM locations l WHERE l.id = loc AND l.company_id = nullif(current_setting('app.company_id', true), '')::uuid))
$$;

-- company-owned masters
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['approval_limits','inventory_items','suppliers','recipes','expense_categories','settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY p_company ON %I USING (app_company_ok(company_id)) WITH CHECK (app_company_ok(company_id))', t);
  END LOOP;
END $$;

-- roles: system roles (company_id NULL) are visible to everyone, but only a Super Admin may change them
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_company_read ON roles FOR SELECT USING (company_id IS NULL OR app_company_ok(company_id));
CREATE POLICY p_company_write ON roles FOR ALL USING (app_company_ok(company_id)) WITH CHECK (app_company_ok(company_id));

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_company ON companies
  USING (app_is_super() OR id = nullif(current_setting('app.company_id', true), '')::uuid
         OR coalesce(current_setting('app.auth', true), '') = 'true')
  WITH CHECK (app_is_super());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_company ON users
  USING (app_company_ok(company_id) OR coalesce(current_setting('app.auth', true), '') = 'true')
  WITH CHECK (app_company_ok(company_id) OR coalesce(current_setting('app.auth', true), '') = 'true');

-- locations: the existing policy already goes through app_scope_ok(id), which is now company-aware

-- rows with no location (login audit, supplier opening balances, company-wide alerts) belong to a company, not to everyone
DROP POLICY p_scope ON audit_logs;
CREATE POLICY p_scope ON audit_logs
  USING ((location_id IS NULL AND (app_company_ok(company_id) OR coalesce(current_setting('app.auth', true), '') = 'true')) OR app_scope_ok(location_id))
  WITH CHECK ((location_id IS NULL AND (app_company_ok(company_id) OR coalesce(current_setting('app.auth', true), '') = 'true')) OR app_scope_ok(location_id));

DROP POLICY p_scope ON notifications;
CREATE POLICY p_scope ON notifications
  USING ((location_id IS NULL AND app_company_ok(company_id)) OR app_scope_ok(location_id))
  WITH CHECK ((location_id IS NULL AND app_company_ok(company_id)) OR app_scope_ok(location_id));

DROP POLICY p_scope ON supplier_ledger;
CREATE POLICY p_scope ON supplier_ledger
  USING ((location_id IS NULL AND EXISTS (SELECT 1 FROM suppliers s WHERE s.id = supplier_id)) OR app_scope_ok(location_id))
  WITH CHECK ((location_id IS NULL AND EXISTS (SELECT 1 FROM suppliers s WHERE s.id = supplier_id)) OR app_scope_ok(location_id));

-- the supplier balance view must respect the policies of the tables it reads
ALTER VIEW v_supplier_balance SET (security_invoker = true);

GRANT SELECT, INSERT, UPDATE ON companies, otp_codes TO app_rw;
GRANT DELETE ON otp_codes TO app_rw;
