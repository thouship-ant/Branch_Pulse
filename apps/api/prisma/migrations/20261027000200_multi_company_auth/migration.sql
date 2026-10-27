-- Roles are per company: every company owns its own copy of ADMIN, ACCOUNTANT, STOCK_MANAGER, BRANCH_MANAGER and STAFF
-- (so one Admin can tune permissions without touching another company). Only SUPER_ADMIN has no company.
UPDATE roles SET company_id = (SELECT id FROM companies WHERE code = 'CMP001')
WHERE code <> 'SUPER_ADMIN' AND company_id IS NULL;

-- Sign-in resolves the caller's roles before the company is known (see PrismaService.runAuth), so roles are
-- readable in auth mode. Writes stay company-scoped.
DROP POLICY p_company_read ON roles;
DROP POLICY p_company_write ON roles;
CREATE POLICY p_company ON roles
  USING (app_company_ok(company_id) OR coalesce(current_setting('app.auth', true), '') = 'true')
  WITH CHECK (app_company_ok(company_id));

-- Sign-in name = mobile number for every user that has one (the seeded dev users got theirs in the previous migration).
UPDATE users SET username = mobile WHERE mobile IS NOT NULL AND company_id IS NOT NULL;

-- A fresh database has no data to move: drop the empty placeholder company so the first real company is CMP001.
DELETE FROM companies c
WHERE c.code = 'CMP001'
  AND NOT EXISTS (SELECT 1 FROM locations WHERE company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM users WHERE company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM inventory_items WHERE company_id = c.id);

-- company codes: CMP001, CMP002 ...
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE code = 'CMP001') THEN
    CREATE SEQUENCE seq_code_company START 2;
  ELSE
    CREATE SEQUENCE seq_code_company START 1;
  END IF;
END $$;
GRANT USAGE, SELECT ON SEQUENCE seq_code_company TO app_rw;
