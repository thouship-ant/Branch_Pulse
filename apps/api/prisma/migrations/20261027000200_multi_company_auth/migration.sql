-- Roles are per company: every company owns its own copy of ADMIN, ACCOUNTANT, STOCK_MANAGER, BRANCH_MANAGER and STAFF
-- (so one Admin can tune permissions without touching another company). Only SUPER_ADMIN has no company.
UPDATE roles SET company_id = (SELECT id FROM companies WHERE code = 'CMP000')
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

-- (a fresh database never gets the placeholder company any more; this stays for databases migrated by the earlier version)
DELETE FROM companies c
WHERE c.code = 'CMP000'
  AND NOT EXISTS (SELECT 1 FROM locations WHERE company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM users WHERE company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM inventory_items WHERE company_id = c.id);

-- company codes: CMP000 is the default company, new companies are CMP001, CMP002 ...
CREATE SEQUENCE seq_code_company START 1;
GRANT USAGE, SELECT ON SEQUENCE seq_code_company TO app_rw;
